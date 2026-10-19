// Isomorphic state reducer for agent telemetry events (runs in Node and in the browser).
export const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // project stays listed for 1h after last activity
export const STALE_MS = 15 * 60 * 1000; // agent with no events for 15 min shows as stale
const MAX_STEPS = 40;
export const SUB_LINGER_MS = 2 * 60 * 1000;

export function createState() {
  return { projects: new Map(), routes: { total: 0, injected: 0, tokens: 0, bySkill: {} }, version: 0 };
}

function project(state, p) {
  let pr = state.projects.get(p.id);
  if (!pr) {
    pr = { id: p.id, name: p.name, root: p.root, last: 0, agents: new Map() };
    state.projects.set(p.id, pr);
  }
  return pr;
}

function agent(pr, id, init) {
  let a = pr.agents.get(id);
  if (!a) {
    a = {
      id,
      parent: null,
      kind: 'main',
      type: 'main',
      label: 'Sessão principal',
      status: 'ready',
      step: 'Sessão iniciada',
      tool: null,
      skill: null,
      steps: [],
      started: init.t,
      last: init.t,
      tools: 0,
      errors: 0,
      pending: [],
      ...init.fields,
    };
    pr.agents.set(id, a);
  }
  return a;
}

function pushStep(a, s) {
  a.steps.push(s);
  if (a.steps.length > MAX_STEPS) a.steps.splice(0, a.steps.length - MAX_STEPS);
}

/** Apply one raw hook event. Returns the touched project id (or null). */
export function apply(state, ev) {
  if (!ev || !ev.proj || !ev.sid) return null;
  const pr = project(state, ev.proj);
  pr.last = Math.max(pr.last, ev.t);
  const main = agent(pr, ev.sid, { t: ev.t, fields: { label: `Sessão ${ev.sid.slice(0, 4)}` } });

  let a = main;
  if (ev.aid && ev.aid !== ev.sid) {
    a = agent(pr, ev.aid, {
      t: ev.t,
      fields: { parent: ev.sid, kind: 'sub', type: ev.at || 'subagent', label: ev.at || 'subagent' },
    });
  }
  a.last = Math.max(a.last, ev.t);
  state.version++;

  switch (ev.e) {
    case 'SessionStart':
      a.status = 'ready';
      a.step = ev.source === 'resume' ? 'Sessão retomada' : 'Sessão iniciada';
      break;
    case 'UserPromptSubmit':
      a.status = 'thinking';
      a.step = ev.step || 'Novo prompt';
      pushStep(a, { t: ev.t, tool: 'Prompt', step: a.step, st: 'done' });
      break;
    case 'Route': {
      state.routes.total++;
      if (ev.mode === 'single' || ev.mode === 'shortlist') {
        state.routes.injected++;
        state.routes.tokens += ev.tokens || 0;
        for (const s of ev.skills || []) state.routes.bySkill[s] = (state.routes.bySkill[s] || 0) + 1;
        a.skill = ev.skills?.[0] || a.skill;
        pushStep(a, { t: ev.t, tool: 'Router', step: `Skill → ${(ev.skills || []).join(', ')}`, st: 'done' });
      }
      break;
    }
    case 'PreToolUse':
      a.status = 'running';
      a.step = ev.step || ev.tool;
      a.tool = ev.tool;
      a.tools++;
      if (ev.skill) a.skill = ev.skill;
      if (ev.delegate) a.pending.push(ev.delegate);
      pushStep(a, { t: ev.t, id: ev.tuid, tool: ev.tool, step: a.step, st: 'running' });
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const s = [...a.steps].reverse().find((x) => (ev.tuid ? x.id === ev.tuid : x.st === 'running'));
      const failed = ev.e === 'PostToolUseFailure';
      if (s) {
        s.st = failed ? 'error' : 'done';
        s.dur = ev.t - s.t;
        if (failed) s.err = ev.err;
      }
      if (failed) a.errors++;
      a.status = failed ? 'error' : 'thinking';
      if (!a.steps.some((x) => x.st === 'running')) a.tool = null;
      break;
    }
    case 'Notification':
    case 'PermissionRequest':
      a.status = 'waiting';
      a.step = ev.step || 'Aguardando entrada';
      break;
    case 'SubagentStart': {
      // The subagent itself (ev.aid) was created above; label it from the parent's pending delegation.
      const i = main.pending.findIndex((d) => d.type === ev.at);
      const d = i >= 0 ? main.pending.splice(i, 1)[0] : main.pending.shift();
      if (a !== main) {
        a.status = 'thinking';
        a.step = d?.desc ? `Iniciando: ${d.desc}` : 'Iniciando';
        if (d?.desc) a.label = `${a.type}: ${d.desc}`;
      }
      break;
    }
    case 'SubagentStop':
      a.status = 'done';
      a.step = 'Concluído';
      break;
    case 'Stop':
      a.status = a.kind === 'main' ? 'idle' : 'done';
      a.step = a.kind === 'main' ? 'Aguardando você' : 'Concluído';
      a.tool = null;
      break;
    case 'SessionEnd':
      for (const x of pr.agents.values()) if (x.id === ev.sid || x.parent === ev.sid) x.status = 'ended';
      break;
    default:
      break;
  }
  return pr.id;
}

export function effectiveStatus(a, now) {
  if (['done', 'ended', 'idle'].includes(a.status)) return a.status;
  return now - a.last > STALE_MS ? 'stale' : a.status;
}

const LIVE = new Set(['running', 'thinking', 'waiting', 'error', 'ready']);

export function listProjects(state, now = Date.now(), { includeInactive = false } = {}) {
  const out = [];
  for (const pr of state.projects.values()) {
    const counts = { running: 0, thinking: 0, waiting: 0, error: 0, idle: 0, done: 0, stale: 0, ready: 0, ended: 0 };
    let live = 0;
    for (const a of pr.agents.values()) {
      const st = effectiveStatus(a, now);
      counts[st] = (counts[st] || 0) + 1;
      if (LIVE.has(st)) live++;
    }
    const active = live > 0 || now - pr.last < ACTIVE_WINDOW_MS;
    if (!active && !includeInactive) continue;
    const lead = [...pr.agents.values()].sort((x, y) => y.last - x.last)[0];
    out.push({ id: pr.id, name: pr.name, root: pr.root, last: pr.last, total: pr.agents.size, live, counts, active, step: lead?.step || '' });
  }
  return out.sort((x, y) => y.live - x.live || y.last - x.last);
}

export function projectDetail(state, id, now = Date.now()) {
  const pr = state.projects.get(id);
  if (!pr) return null;
  const agents = [...pr.agents.values()]
    // finished subagents leave the view after 2 min; ended sessions after the active window
    .filter((a) => !(a.kind === 'sub' && (a.status === 'done' || a.status === 'ended') && now - a.last > SUB_LINGER_MS))
    .filter((a) => a.status !== 'ended' || now - a.last < ACTIVE_WINDOW_MS)
    .map(({ pending, ...a }) => ({ ...a, status: effectiveStatus(a, now), steps: a.steps.slice(-25) }));
  return { id: pr.id, name: pr.name, root: pr.root, last: pr.last, agents };
}

// ---------------------------------------------------------------------------
// Demo generator: plausible multi-agent activity, same event shape as the hooks.
const DEMO_PROJECTS = [
  { id: 'demo-checkout', name: 'checkout-api', root: '~/code/checkout-api' },
  { id: 'demo-mobile', name: 'mobile-app', root: '~/code/mobile-app' },
  { id: 'demo-data', name: 'data-pipeline', root: '~/code/data-pipeline' },
  { id: 'demo-site', name: 'landing-site', root: '~/code/landing-site' },
];
const SUBS = [
  ['Explore', 'Mapear módulos de pagamento'],
  ['general-purpose', 'Escrever testes de integração'],
  ['Plan', 'Desenhar estratégia de retry'],
  ['security-reviewer', 'Revisar mudanças de auth'],
  ['Explore', 'Encontrar código morto'],
];
const TOOLS = [
  ['Read', 'Read src/payments/service.ts'],
  ['Grep', 'Grep "processPayment"'],
  ['Edit', 'Edit retry-policy.ts'],
  ['Bash', 'Rodar testes unitários'],
  ['Bash', 'npm run lint'],
  ['Write', 'Write checkout.spec.ts'],
  ['WebSearch', 'Search "stripe idempotency keys"'],
  ['Glob', 'Glob src/**/*.tsx'],
  ['Read', 'Read SKILL.md'],
  ['mcp__github__create_pull_request', 'create_pull_request (github)'],
];
const SKILLS = ['tlc-spec-driven', 'security-best-practices', 'react-native-expert', 'core-web-vitals', 'mermaid-studio', 'the-judge'];

export function startDemo(emit, { speed = 1, rand = Math.random } = {}) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const sessions = [];
  let n = 0;
  const t0 = Date.now();
  DEMO_PROJECTS.forEach((p, i) => {
    const count = i === 0 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const sid = Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0') + i + k;
      sessions.push({ sid, proj: p, subs: [], main: { aid: null, at: null, open: null } });
      emit({ t: t0, e: 'SessionStart', sid, proj: p, source: 'startup' });
      emit({ t: t0, e: 'UserPromptSubmit', sid, proj: p, step: 'Prompt: implemente a próxima tarefa' });
      emit({ t: t0, e: 'Route', sid, proj: p, mode: 'single', skills: [SKILLS[(i + k) % SKILLS.length]], tokens: 62 });
    }
  });

  const tick = () => {
    const t = Date.now();
    const s = pick(sessions);
    const actors = [s.main, s.main, ...s.subs.filter((x) => !x.done)];
    const actor = pick(actors);
    const base = { t, sid: s.sid, proj: s.proj, aid: actor.aid, at: actor.at };
    const r = rand();
    if (actor.open) {
      emit({ ...base, e: r < 0.06 ? 'PostToolUseFailure' : 'PostToolUse', tool: actor.open[0], tuid: actor.open[2], err: 'exit code 1' });
      actor.open = null;
    } else if (!actor.aid && r < 0.1 && s.subs.filter((x) => !x.done).length < 3) {
      const [type, desc] = pick(SUBS);
      const aid = `a${(n++).toString(36)}${Math.floor(rand() * 1e5).toString(36)}`;
      emit({ ...base, e: 'PreToolUse', tool: 'Agent', step: `Delegando: ${desc}`, tuid: `d${aid}`, delegate: { type, desc } });
      emit({ t, sid: s.sid, proj: s.proj, aid, at: type, e: 'SubagentStart' });
      s.subs.push({ aid, at: type, done: false, born: t, parentTuid: `d${aid}` });
    } else if (actor.aid && t - actor.born > 25000 / speed && r < 0.25) {
      emit({ ...base, e: 'SubagentStop' });
      actor.done = true;
      emit({ t, sid: s.sid, proj: s.proj, e: 'PostToolUse', tool: 'Agent', tuid: actor.parentTuid });
      setTimeout(() => (s.subs = s.subs.filter((x) => x !== actor)), 20000 / speed);
    } else if (!actor.aid && r < 0.14) {
      emit({ ...base, e: 'Notification', step: 'Aguardando permissão: Bash' });
    } else {
      const [tool, step] = pick(TOOLS);
      const tuid = `t${(n++).toString(36)}`;
      actor.open = [tool, step, tuid];
      emit({ ...base, e: 'PreToolUse', tool, step, tuid });
    }
  };
  const id = setInterval(tick, Math.max(120, 700 / speed));
  return () => clearInterval(id);
}
