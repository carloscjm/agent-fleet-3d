// Isomorphic reader for Claude Code session transcripts (~/.claude/projects/<proj>/<session>.jsonl).
// Turns a transcript into: meta (for the chat list), turns (for the 3D history) and hook-shaped
// events (fed to the fleet reducer to rebuild the pipeline view of sessions that never ran our hooks).
import { clip, summarize, skillOf, category } from './steps.mjs';
import { stageOf, verdictOf, createState, apply, projectDetail } from './fleet-core.mjs';

export const MAX_TOOLS_PER_HISTORY = 1500;

/** Category for steps that only kept their text (live events). */
export function stepCategory(tool, step = '') {
  if (/instruções da skill|^Usou a skill/.test(step)) return 'skill';
  return category(tool);
}

const ts = (s) => {
  const n = typeof s === 'number' ? s : Date.parse(s);
  return Number.isFinite(n) ? n : null;
};

export function hashId(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

// Removes harness wrappers and returns the human-visible prompt, or null when the line is not a prompt.
export function promptText(line) {
  if (line.type !== 'user' || line.isMeta || line.isSidechain) return null;
  const c = line.message?.content;
  if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return null;
  if (line.origin && line.origin.kind && line.origin.kind !== 'human') return null;
  let t = textOf(c);
  if (!t) return null;
  t = t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
  const cmd = t.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
  if (cmd) {
    const args = (t.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
    t = `${cmd[1].startsWith('/') ? cmd[1] : '/' + cmd[1]} ${args}`;
  }
  if (/^\s*<(local-command-stdout|local-command-stderr|bash-stdout|bash-stderr)/.test(t)) return null;
  if (/^\s*Caveat: The messages below were generated/.test(t)) return null;
  t = t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

function resultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('\n');
  return '';
}

function parseSubagent(lines) {
  let prompt = null;
  const tools = [];
  const byId = new Map();
  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    const t = ts(l.timestamp);
    if (l.type === 'user' && prompt === null) {
      const c = l.message?.content;
      if (!(Array.isArray(c) && c.some((b) => b?.type === 'tool_result'))) prompt = textOf(c).trim();
    }
    if (l.type === 'assistant' && Array.isArray(l.message?.content)) {
      for (const b of l.message.content) {
        if (b?.type !== 'tool_use') continue;
        const tool = { id: b.id, name: b.name, step: summarize(b.name, b.input), cat: category(b.name, b.input), t, skill: skillOf(b.name, b.input) };
        tools.push(tool);
        byId.set(b.id, tool);
      }
    }
    if (l.type === 'user' && Array.isArray(l.message?.content)) {
      for (const b of l.message.content) {
        if (b?.type !== 'tool_result') continue;
        const tool = byId.get(b.tool_use_id);
        if (tool) {
          tool.end = t;
          if (b.is_error) tool.err = clip(resultText(b), 90) || 'erro';
        }
      }
    }
  }
  return { prompt: prompt || '', tools };
}

/**
 * @param lines   parsed JSONL objects of the main session file
 * @param options { subagents: Array<lines[]>, project: {id,name,root} }
 */
export function parseTranscript(lines, options = {}) {
  const meta = {
    id: null,
    cwd: null,
    branch: null,
    entrypoint: null,
    created: null,
    updated: null,
    title: null,
    aiTitle: null,
    firstPrompt: null,
    lastPrompt: null,
    cost: null,
    prompts: 0,
    tools: 0,
    agents: 0,
    errors: 0,
    pipeline: false,
    stages: [],
    skills: [],
  };
  const turns = [];
  const toolById = new Map();
  let turn = null;
  const skills = new Set();
  const newTurn = (t, prompt) => {
    turn = { n: turns.length, t, prompt, tools: [], agents: [], items: [], reply: null, end: t };
    turns.push(turn);
    return turn;
  };

  for (const l of lines) {
    if (!l || typeof l !== 'object') continue;
    if (l.sessionId && !meta.id) meta.id = l.sessionId;
    if (l.type === 'custom-title' && l.customTitle) meta.title = l.customTitle;
    if (l.type === 'ai-title' && l.aiTitle) meta.aiTitle = l.aiTitle;
    if (l.type === 'summary' && l.summary && !meta.aiTitle) meta.aiTitle = l.summary;
    if (l.type === 'cost-state' && typeof l.totalCostUSD === 'number') meta.cost = l.totalCostUSD;
    if (l.isSidechain) continue; // older versions keep subagent lines inline; their outcome is read from the main chain
    const t = ts(l.timestamp);
    if (t) {
      if (!meta.created || t < meta.created) meta.created = t;
      if (!meta.updated || t > meta.updated) meta.updated = t;
    }
    if (l.cwd && !meta.cwd) meta.cwd = l.cwd;
    if (l.gitBranch && l.gitBranch !== 'HEAD') meta.branch = l.gitBranch;
    if (l.entrypoint && !meta.entrypoint) meta.entrypoint = l.entrypoint;

    const p = promptText(l);
    if (p) {
      newTurn(t, clip(p, 400));
      meta.prompts++;
      if (!meta.firstPrompt) meta.firstPrompt = clip(p, 120);
      meta.lastPrompt = clip(p, 120);
      continue;
    }
    if (l.type === 'assistant' && Array.isArray(l.message?.content)) {
      if (!turn) newTurn(t, null);
      for (const b of l.message.content) {
        if (!b) continue;
        if (b.type === 'text' && b.text?.trim()) turn.reply = clip(b.text, 400);
        if (b.type !== 'tool_use') continue;
        const input = b.input || {};
        if (b.name === 'Agent' || b.name === 'Task') {
          const type = input.subagent_type || 'general-purpose';
          const stage = stageOf(type);
          const agent = { id: b.id, type, stage, desc: clip(input.description || input.prompt, 80), prompt: String(input.prompt || ''), t, end: null, err: null, result: null, verdict: null, tools: [] };
          turn.agents.push(agent);
          turn.items.push({ kind: 'agent', ref: agent });
          toolById.set(b.id, agent);
          meta.agents++;
          if (stage) {
            meta.pipeline = true;
            if (!meta.stages.includes(stage)) meta.stages.push(stage);
          }
        } else {
          const tool = { id: b.id, name: b.name, step: summarize(b.name, input), cat: category(b.name, input), t, end: null, err: null, skill: skillOf(b.name, input) };
          if (tool.skill) skills.add(tool.skill);
          turn.tools.push(tool);
          turn.items.push({ kind: 'tool', ref: tool });
          toolById.set(b.id, tool);
          meta.tools++;
        }
      }
      if (t) turn.end = Math.max(turn.end || 0, t);
    }
    if (l.type === 'user' && Array.isArray(l.message?.content)) {
      for (const b of l.message.content) {
        if (b?.type !== 'tool_result') continue;
        const ref = toolById.get(b.tool_use_id);
        if (!ref) continue;
        ref.end = t;
        if (ref.prompt !== undefined) {
          const txt = resultText(b);
          ref.result = clip(txt.trim().split('\n').slice(-3).join(' '), 240);
          if (ref.stage === 'test') ref.verdict = verdictOf(txt);
        }
        if (b.is_error) {
          ref.err = clip(resultText(b), 90) || 'erro';
          meta.errors++;
        }
        if (turn && t) turn.end = Math.max(turn.end || 0, t);
      }
    }
  }

  // Attach subagent transcripts (newer versions store them in <session>/subagents/*.jsonl).
  const allAgents = turns.flatMap((x) => x.agents);
  for (const subLines of options.subagents || []) {
    const sub = parseSubagent(subLines);
    const key = sub.prompt.slice(0, 160);
    const a = allAgents.find((x) => !x.tools.length && x.prompt && (x.prompt.trim().slice(0, 160) === key || (key && x.prompt.includes(key.slice(0, 80)))));
    if (a) {
      a.tools = sub.tools;
      for (const tl of sub.tools) if (tl.skill) skills.add(tl.skill);
    }
  }
  meta.skills = [...skills];
  meta.title = meta.title || meta.aiTitle || meta.firstPrompt || 'Chat sem título';
  Object.assign(meta, outcomeOf(turns));
  const project = options.project || { id: hashId(meta.cwd || meta.id || 'x'), name: (meta.cwd || '').split(/[/\\]/).filter(Boolean).pop() || 'sem pasta', root: meta.cwd || '' };
  meta.project = project;
  return { meta, turns, events: toEvents(meta, turns, project) };
}

/** How the chat ended: pipeline result (complete/blocked/partial) and errors in the last request. */
export function outcomeOf(turns) {
  const last = turns[turns.length - 1];
  const lastErrors = last ? last.tools.filter((x) => x.err).length + last.agents.filter((a) => a.err).length : 0;
  const staged = turns.flatMap((x) => x.agents).filter((a) => a.stage);
  let pipelineStatus = null;
  if (staged.length) {
    const end = staged[staged.length - 1];
    if (end.stage === 'ship' && !end.err) pipelineStatus = 'complete';
    else if (end.stage === 'test' && end.verdict === 'fail') pipelineStatus = 'blocked';
    else pipelineStatus = 'partial';
  }
  return { pipelineStatus, lastErrors };
}

/** Rebuilds the hook event stream so the fleet reducer can show the pipeline of any session. */
export function toEvents(meta, turns, proj) {
  const sid = meta.id || 'session';
  const out = [];
  const T = (t) => t || meta.updated || meta.created || 0;
  out.push({ t: T(meta.created), e: 'SessionStart', sid, proj, source: 'startup' });
  for (const turn of turns) {
    if (turn.prompt) out.push({ t: T(turn.t), e: 'UserPromptSubmit', sid, proj, step: `Prompt: ${clip(turn.prompt, 60)}` });
    for (const it of turn.items) {
      const r = it.ref;
      if (it.kind === 'tool') {
        out.push({ t: T(r.t), e: 'PreToolUse', sid, proj, tool: r.name, tuid: r.id, step: r.step, skill: r.skill || undefined });
        if (r.end) out.push({ t: T(r.end), e: r.err ? 'PostToolUseFailure' : 'PostToolUse', sid, proj, tool: r.name, tuid: r.id, err: r.err || undefined });
      } else {
        out.push({ t: T(r.t), e: 'PreToolUse', sid, proj, tool: 'Agent', tuid: r.id, step: `Chamou um agente: ${r.desc}`, delegate: { type: r.type, desc: r.desc } });
        out.push({ t: T(r.t), e: 'SubagentStart', sid, proj, aid: r.id, at: r.type });
        for (const tl of r.tools) {
          out.push({ t: T(tl.t), e: 'PreToolUse', sid, proj, aid: r.id, at: r.type, tool: tl.name, tuid: tl.id, step: tl.step, skill: tl.skill || undefined });
          if (tl.end) out.push({ t: T(tl.end), e: tl.err ? 'PostToolUseFailure' : 'PostToolUse', sid, proj, aid: r.id, at: r.type, tool: tl.name, tuid: tl.id, err: tl.err || undefined });
        }
        if (r.end) {
          out.push({ t: T(r.end), e: 'SubagentStop', sid, proj, aid: r.id, at: r.type, msg: r.result || '', verdict: r.verdict || undefined });
          out.push({ t: T(r.end), e: r.err ? 'PostToolUseFailure' : 'PostToolUse', sid, proj, tool: 'Agent', tuid: r.id });
        }
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Pipeline view (same shape as projectDetail) for one session, rebuilt from its events. */
export function pipelineOf(events, sid, now) {
  const st = createState();
  for (const ev of events) apply(st, ev);
  const pid = events[0]?.proj?.id;
  const d = pid ? projectDetail(st, pid, now) : null;
  if (!d) return null;
  // History is not "live": keep finished stages finished even when old.
  d.flows = d.flows.filter((f) => f.sid === sid).map((f) => ({ ...f, label: 'Seu pedido' }));
  return d;
}

/** History built from live reducer data, for sessions that only exist as hook events (demo, other dirs). */
export function historyFromLive(detail, sid) {
  const main = detail.agents.find((a) => a.id === sid);
  if (!main) return null;
  const turns = [];
  let turn = null;
  const newTurn = (t, prompt) => {
    turn = { n: turns.length, t, prompt, tools: [], agents: [], items: [], reply: null, end: t };
    turns.push(turn);
  };
  for (const s of main.steps) {
    if (s.tool === 'Prompt') {
      newTurn(s.t, s.step.replace(/^Prompt:\s*/, ''));
      continue;
    }
    if (s.tool === 'Router' || s.tool === 'Agent') continue;
    if (!turn) newTurn(s.t, null);
    const tool = { id: s.id || `${s.t}`, name: s.tool, step: s.step, cat: stepCategory(s.tool, s.step), t: s.t, end: s.dur != null ? s.t + s.dur : null, err: s.err || null };
    turn.tools.push(tool);
    turn.items.push({ kind: 'tool', ref: tool });
  }
  const subs = detail.agents.filter((a) => a.parent === sid).sort((a, b) => a.started - b.started);
  for (const a of subs) {
    const target = [...turns].reverse().find((x) => (x.t || 0) <= a.started) || turns[turns.length - 1];
    if (!target) continue;
    const agent = {
      id: a.id,
      type: a.type,
      stage: a.stage,
      desc: a.task || a.label,
      t: a.started,
      end: a.ended,
      err: null,
      result: a.result,
      verdict: a.verdict,
      live: a.status !== 'done' && a.status !== 'ended',
      tools: a.steps.map((s) => ({ id: s.id, name: s.tool, step: s.step, cat: stepCategory(s.tool, s.step), t: s.t, err: s.err || null })),
    };
    target.agents.push(agent);
    // insert by time among items
    const idx = target.items.findIndex((it) => (it.ref.t || 0) > a.started);
    target.items.splice(idx < 0 ? target.items.length : idx, 0, { kind: 'agent', ref: agent });
  }
  const tools = turns.reduce((n, x) => n + x.tools.length, 0);
  const flow = detail.flows.find((f) => f.sid === sid);
  const stages = [...new Set(subs.map((a) => a.stage).filter(Boolean))];
  const meta = {
    id: sid,
    cwd: detail.root,
    branch: null,
    entrypoint: 'live',
    created: main.started,
    updated: main.last,
    title: null,
    firstPrompt: turns.find((x) => x.prompt)?.prompt || null,
    lastPrompt: [...turns].reverse().find((x) => x.prompt)?.prompt || null,
    cost: null,
    prompts: turns.filter((x) => x.prompt).length,
    tools,
    agents: subs.length,
    errors: main.errors,
    pipeline: stages.length > 0,
    stages,
    skills: main.skill ? [main.skill] : [],
    project: { id: detail.id, name: detail.name, root: detail.root },
  };
  Object.assign(meta, outcomeOf(turns));
  if (flow?.run) meta.pipelineStatus = flow.run.status === 'complete' ? 'complete' : flow.run.status === 'blocked' ? 'blocked' : 'partial';
  meta.title = flow?.run?.task || meta.firstPrompt || main.label;
  return { meta, turns };
}

// ---------------------------------------------------------------------------
// Chat list: filter and grouping (used by the UI, kept here so it is testable).
const DAY = 86400000;
export function dateGroup(t, now = Date.now()) {
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  const start = d0.getTime();
  if (t >= start) return { key: '0', label: 'Hoje' };
  if (t >= start - DAY) return { key: '1', label: 'Ontem' };
  if (t >= start - 7 * DAY) return { key: '2', label: 'Últimos 7 dias' };
  if (t >= start - 30 * DAY) return { key: '3', label: 'Últimos 30 dias' };
  const d = new Date(t);
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { key: `4-${String(9999 - d.getFullYear()).padStart(4, '0')}-${String(12 - d.getMonth()).padStart(2, '0')}`, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

export function filterChats(chats, { q = '', show = 'all' } = {}) {
  const words = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean);
  return chats.filter((c) => {
    if (show === 'active' && !c.live) return false;
    if (show === 'pipeline' && !c.pipeline) return false;
    if (show === 'plain' && c.pipeline) return false;
    if (show === 'errors' && !c.errors) return false;
    if (!words.length) return true;
    const hay = [c.title, c.project?.name, c.project?.root, c.branch, c.lastPrompt, c.firstPrompt, ...(c.skills || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    return words.every((w) => hay.includes(w));
  });
}

// Status groups, in the order they are listed (what needs you first).
export const CHAT_STATUS = [
  { key: 'waiting', label: 'Esperando sua resposta', hint: 'O Claude parou e está aguardando você' },
  { key: 'working', label: 'Trabalhando agora', hint: 'O Claude está executando neste momento' },
  { key: 'blocked', label: 'Barrado nos testes', hint: 'O QA reprovou e a entrega não foi para o Git' },
  { key: 'error', label: 'Terminou com erro', hint: 'O último pedido teve alguma ação que falhou' },
  { key: 'shipped', label: 'Entregue no Git', hint: 'Passou pelo pipeline inteiro e foi enviado' },
  { key: 'done', label: 'Concluído', hint: 'Conversa encerrada sem pendências' },
];
const STATUS_ORDER = Object.fromEntries(CHAT_STATUS.map((x, i) => [x.key, i]));

/** One status per chat, for the "Por status" grouping and the badge in the list. */
export function chatStatus(c) {
  if (c.live && c.status === 'waiting') return 'waiting';
  if (c.live) return 'working';
  if (c.pipelineStatus === 'blocked') return 'blocked';
  if (c.lastErrors > 0 || c.status === 'error') return 'error';
  if (c.pipelineStatus === 'complete') return 'shipped';
  return 'done';
}

export function groupChats(chats, by = 'date', now = Date.now()) {
  const groups = new Map();
  const sorted = [...chats].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  for (const c of sorted) {
    let g;
    if (by === 'project') g = { key: c.project?.root || c.project?.name || '-', label: c.project?.name || 'Sem pasta', sub: c.project?.root || '' };
    else if (by === 'none') g = { key: 'all', label: 'Todos os chats' };
    else if (by === 'status') {
      const st = CHAT_STATUS[STATUS_ORDER[chatStatus(c)]];
      g = { key: st.key, label: st.label, sub: st.hint };
    }
    else g = dateGroup(c.updated || c.created || 0, now);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, chats: [] });
    groups.get(g.key).chats.push(c);
  }
  const out = [...groups.values()];
  if (by === 'date') out.sort((a, b) => a.key.localeCompare(b.key));
  else if (by === 'status') out.sort((a, b) => STATUS_ORDER[a.key] - STATUS_ORDER[b.key]);
  else out.sort((a, b) => (b.chats[0].updated || 0) - (a.chats[0].updated || 0));
  return out;
}

