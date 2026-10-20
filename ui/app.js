import { createScene } from './scene.js';
import { createHistoryScene } from './scene-history.js';
import { createState, apply, listProjects, projectDetail, startDemo, STAGES } from '../shared/fleet-core.mjs';
import { parseTranscript, pipelineOf, historyFromLive, filterChats, groupChats, chatStatus, CHAT_STATUS, stepCategory } from '../shared/history-core.mjs';
import { demoTranscripts } from '../shared/history-demo.mjs';
import { KIND_PT, agentLabel } from '../shared/steps.mjs';
import { icon2d } from './icons2d.js';

const $ = (s) => document.querySelector(s);
const STATUS_PT = {
  running: 'Executando',
  thinking: 'Pensando',
  waiting: 'Aguardando você',
  error: 'Erro no último passo',
  idle: 'Ocioso',
  ready: 'Pronto',
  done: 'Concluído',
  stale: 'Sem atividade',
  ended: 'Encerrado',
};
const STAGE_PT = { pending: 'Aguardando', active: 'Em andamento', done: 'Concluído', failed: 'Reprovado', stale: 'Sem atividade' };
const RUN_PT = { running: 'Em andamento', complete: 'Entregue', blocked: 'Bloqueado pelo QA', waiting: 'Aguardando próxima etapa' };
const STAGE_LABEL = { plan: 'Tech Lead', build: 'Engenheiro', test: 'QA', ship: 'DevOps' };
// what each stage does, in plain words
const STAGE_DESC = {
  plan: 'Lê o seu pedido e o código, e escreve um plano: o que mudar e como saber se ficou certo.',
  build: 'Segue o plano e faz as mudanças no código.',
  test: 'Confere se cada item do plano foi atendido e dá o veredito: aprovado ou reprovado.',
  ship: 'Salva as mudanças (commit), envia para o Git e abre o pedido de revisão (pull request).',
};
/** Friendly name for a subagent: "Tech Lead" instead of "agent-fleet-3d:tech-lead". */
const agentName = (a) => (a.stage ? STAGE_LABEL[a.stage] : agentLabel(a.type));
// all actions in a turn, including the ones its helper agents did
const turnActions = (t) => t.tools.length + t.agents.reduce((n, a) => n + (a.tools?.length || 0), 0);
const VERDICT_PT = { pass: 'O QA aprovou', fail: 'O QA reprovou' };
// short badge for the chat list, by chatStatus()
const BADGE = { waiting: ['waiting', 'esperando você'], working: ['running', 'trabalhando'], blocked: ['error', 'barrado no QA'], error: ['error', 'terminou com erro'], shipped: ['thinking', 'entregue no Git'] };
const iconEl = (key, cls = '') => {
  const s = document.createElement('span');
  s.className = `ic c-${key} ${cls}`;
  s.innerHTML = icon2d(key);
  return s;
};
const iconKey = (cat) => (cat === 'delegate' ? 'agent' : cat);
const COUNT_PT = {
  read: ['leu 1 arquivo', 'leu # arquivos'],
  search: ['fez 1 busca no código', 'fez # buscas no código'],
  edit: ['editou 1 arquivo', 'editou # arquivos'],
  write: ['criou 1 arquivo', 'criou # arquivos'],
  exec: ['rodou 1 comando', 'rodou # comandos'],
  web: ['pesquisou 1 vez na web', 'pesquisou # vezes na web'],
  skill: ['consultou 1 skill', 'consultou # skills'],
  task: ['atualizou a lista de tarefas', 'atualizou a lista de tarefas'],
  mcp: ['usou 1 conector', 'usou # conectores'],
  other: ['fez mais 1 ação', 'fez mais # ações'],
};
/** "Leu 3 arquivos, editou 2 arquivos e rodou 1 comando." */
function actionSummary(tools) {
  const n = {};
  for (const t of tools) n[t.cat || 'other'] = (n[t.cat || 'other'] || 0) + 1;
  const parts = Object.keys(COUNT_PT).filter((k) => n[k]).map((k) => COUNT_PT[k][n[k] > 1 ? 1 : 0].replace('#', n[k]));
  if (!parts.length) return '';
  const txt = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1] : parts[0];
  return txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
}
const secs = (ms) => (ms < 60000 ? `${Math.max(0.1, ms / 1000).toFixed(1).replace('.', ',')}s` : dur(ms));

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('fleet:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('fleet:' + k, JSON.stringify(v));
    } catch {}
  },
};

const ui = {
  mode: 'connecting',
  chats: [],
  chatId: null,
  detail: null,
  detailSig: '',
  view: 'history',
  turn: null,
  sel: null, // pipeline selection: { type: 'agent', id } | { type: 'stage', sid, key }
  q: '',
  group: store.get('group', 'date'),
  show: store.get('show', 'all'),
  collapsed: new Set(store.get('collapsed', [])),
  routes: null,
  dirs: [],
};

// ------------------------------------------------------------------ scenes
const history = createHistoryScene($('#scene-history'), {
  onSelectTurn: (n) => selectTurn(n),
  onHover: (p, at) => showTip(p, at),
});
const pipeline = createScene($('#scene'), {
  onSelect: (s) => selectStage(s == null ? null : typeof s === 'string' ? { type: 'agent', id: s } : { type: 'stage', ...s }),
  onFocusRow: () => {},
});
pipeline.setVisible(false);

// ------------------------------------------------------------------ helpers
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  if (s < 86400 * 7) return `há ${Math.round(s / 86400)} d`;
  return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function dur(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60}s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(cls, onClick, ...children) {
  const b = el('button', cls);
  b.type = 'button';
  b.onclick = onClick;
  b.append(...children);
  return b;
}
function item(child) {
  const li = el('li');
  li.append(child);
  return li;
}
function setConn(text, cls) {
  const c = $('#conn');
  c.textContent = text;
  c.className = 'conn ' + cls;
}
function pipeBar(stages, compact) {
  const bar = el('div', 'pipe' + (compact ? ' compact' : ''));
  STAGES.forEach((def, i) => {
    const seg = el('span', `seg ${stages[i] || 'pending'}`);
    seg.append(el('i'), el('span', null, def.label));
    bar.append(seg);
  });
  return bar;
}
const money = (v) => (v == null ? null : `US$ ${v.toFixed(2).replace('.', ',')}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ data: live server
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

let pollTimer = null;
async function connectLive() {
  if (!location.protocol.startsWith('http')) return false;
  try {
    const h = await getJSON('/api/health');
    if (h.demo) return false;
    ui.mode = 'live';
    await refreshList();
    pollTimer = setInterval(refreshList, 5000);
    setInterval(refreshDetail, 3000);
    return true;
  } catch {
    return false;
  }
}
async function refreshList() {
  if (ui.mode !== 'live') return;
  try {
    const d = await getJSON('/api/chats');
    ui.chats = d.chats;
    ui.routes = d.routes;
    ui.dirs = d.dirs || [];
    render();
  } catch {
    setConn('Reconectando…', '');
  }
}
async function refreshDetail() {
  if (!ui.chatId) return;
  if (ui.mode === 'demo') return setDetail(demoDetail(ui.chatId));
  try {
    setDetail(await getJSON(`/api/chats/${encodeURIComponent(ui.chatId)}`));
  } catch {}
}

// ------------------------------------------------------------------ data: demo (no server)
let demo = null;
function startLocalDemo() {
  if (demo) return;
  clearInterval(pollTimer);
  ui.mode = 'demo';
  const now = Date.now();
  const parsed = demoTranscripts(now).map((t) => parseTranscript(t.lines, { subagents: t.subagents }));
  const state = createState();
  startDemo((ev) => apply(state, ev), { speed: 1.2 });
  demo = { parsed, state };
  const pull = () => {
    const now = Date.now();
    const live = [];
    for (const p of listProjects(state, now)) {
      const d = projectDetail(state, p.id, now);
      for (const f of d.flows) {
        const h = historyFromLive(d, f.sid);
        if (h) live.push({ ...h.meta, live: f.status !== 'idle', status: f.status, step: f.step, _live: { pid: p.id } });
      }
    }
    ui.chats = [...live, ...parsed.map((p) => ({ ...p.meta, live: false }))];
    ui.routes = state.routes;
    render();
    if (ui.chatId && live.some((c) => c.id === ui.chatId)) setDetail(demoDetail(ui.chatId));
  };
  pull();
  setInterval(pull, 1500);
}
function demoDetail(id) {
  const now = Date.now();
  const p = demo.parsed.find((x) => x.meta.id === id);
  if (p) return { meta: p.meta, turns: p.turns, pipeline: p.meta.pipeline ? pipelineOf(p.events, id, now) : null, live: false };
  const c = ui.chats.find((x) => x.id === id);
  if (!c?._live) return null;
  const d = projectDetail(demo.state, c._live.pid, now);
  const h = historyFromLive(d, id);
  return h ? { ...h, pipeline: { ...d, flows: d.flows.filter((f) => f.sid === id) }, live: c.live, status: c.status } : null;
}

// ------------------------------------------------------------------ list
function visibleChats() {
  return filterChats(ui.chats, { q: ui.q, show: ui.show });
}

function chatStages(c) {
  if (!c.pipeline) return null;
  const st = STAGES.map((s) => (c.stages?.includes(s.key) ? 'done' : 'pending'));
  if (c.live) {
    const last = st.lastIndexOf('done');
    if (last >= 0 && last < 3) st[last] = 'active';
  }
  return st;
}

function renderList() {
  const box = $('#chats');
  const focusId = document.activeElement?.dataset?.cid;
  box.replaceChildren();
  const list = visibleChats();
  $('#count').textContent = ui.chats.length ? `${list.length} de ${plural(ui.chats.length, 'chat', 'chats')}` : '';
  if (!ui.chats.length) {
    const e = el('div', 'empty');
    e.append(el('p', null, ui.mode === 'live' ? 'Nenhum chat do Claude Code encontrado neste computador.' : 'Carregando chats…'));
    if (ui.mode === 'live' && ui.dirs.length === 0) e.append(el('p', 'hint', 'A pasta de histórico do Claude Code não foi encontrada. Use o Claude Code na aba Code ao menos uma vez.'));
    if (ui.mode !== 'demo') e.append(button(null, startLocalDemo, 'Ver demonstração'));
    box.append(e);
    return;
  }
  if (!list.length) {
    box.append(el('div', 'empty', 'Nenhum chat corresponde à busca e ao filtro.'));
    return;
  }
  for (const g of groupChats(list, ui.group)) {
    const sec = el('section', 'group');
    const open = !ui.collapsed.has(g.key);
    if (ui.group !== 'none') {
      const h = button('group-h', () => {
        if (ui.collapsed.has(g.key)) ui.collapsed.delete(g.key);
        else ui.collapsed.add(g.key);
        store.set('collapsed', [...ui.collapsed]);
        renderList();
      });
      h.setAttribute('aria-expanded', String(open));
      h.append(el('span', 'chev', open ? '▾' : '▸'));
      if (ui.group === 'status') h.append(el('span', `dot ${(BADGE[g.key] || ['idle'])[0]}`));
      h.append(el('span', 'gname', g.label), el('span', 'gcount', String(g.chats.length)));
      if (g.sub) h.title = g.sub;
      sec.append(h);
    }
    if (open) {
      const ul = el('ul', 'chat-ul');
      for (const c of g.chats) {
        const row = el('div', 'row');
        row.append(el('span', 'name', c.title), el('span', 'when', ago(c.updated)));
        const meta = el('div', 'cmeta');
        const badge = BADGE[chatStatus(c)];
        if (badge) {
          const bd = el('span', `cstat ${badge[0]}`);
          bd.append(el('span', `dot ${badge[0]}`), document.createTextNode(badge[1]));
          if (ui.group !== 'status') meta.append(bd);
          else meta.append(el('span', `dot ${badge[0]}`));
        }
        if (ui.group !== 'project') meta.append(el('span', 'proj', c.project?.name || ''));
        if (c.branch && !badge) meta.append(el('span', 'branch', c.branch));
        meta.append(el('span', 'counts', plural(c.prompts, 'pedido', 'pedidos')));
        const parts = [row, meta];
        const st = chatStages(c);
        if (st) parts.push(pipeBar(st, true));
        if (c.live && c.step) parts.push(el('div', 'step', c.step));
        const b = button('chat', () => selectChat(c.id), ...parts);
        b.dataset.cid = c.id;
        b.setAttribute('aria-current', String(c.id === ui.chatId));
        ul.append(item(b));
        if (c.id === focusId) queueMicrotask(() => b.focus());
      }
      sec.append(ul);
    }
    box.append(sec);
  }
}

// ------------------------------------------------------------------ detail
function sigOf(d) {
  if (!d) return '';
  const last = d.turns[d.turns.length - 1];
  return [d.meta.id, d.turns.length, d.meta.tools, last?.items.length, last?.end, d.live, JSON.stringify(d.pipeline?.flows?.[0]?.run?.stages?.map((s) => s.status + s.step) || '')].join('|');
}
function setDetail(d) {
  if (!d || d.meta?.id !== ui.chatId) return;
  const sig = sigOf(d);
  if (sig === ui.detailSig) return;
  ui.detailSig = sig;
  ui.detail = d;
  history.setHistory(d, { isLive: !!d.live });
  if (d.pipeline) pipeline.setProject(d.pipeline);
  if (ui.view === 'pipeline' && !hasPipeline()) setView('history');
  renderStage();
}
const hasPipeline = () => !!ui.detail?.pipeline?.flows?.some((f) => f.run);

async function selectChat(id) {
  if (id === ui.chatId) return;
  ui.chatId = id;
  ui.detail = null;
  ui.detailSig = '';
  ui.turn = null;
  ui.sel = null;
  history.selectTurn(null);
  render();
  await refreshDetail();
}
function selectTurn(n) {
  ui.turn = n;
  history.selectTurn(n);
  renderStage();
  const li = document.querySelector(`[data-turn="${n}"]`);
  li?.scrollIntoView({ block: 'nearest' });
}
function selectStage(sel) {
  ui.sel = sel;
  const f = ui.detail?.pipeline?.flows?.[0];
  let agentId = sel?.type === 'agent' ? sel.id : null;
  if (sel?.type === 'stage') agentId = f?.run?.stages.find((s) => s.key === sel.key)?.agentId || null;
  pipeline.select(agentId);
  renderStage();
}
function setView(v) {
  ui.view = v;
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === v));
  history.setVisible(v === 'history');
  pipeline.setVisible(v === 'pipeline');
  $('#legend-history').hidden = v !== 'history';
  $('#legend-pipeline').hidden = v !== 'pipeline';
  $('#tip').hidden = true;
  renderStage();
}

function renderTitle(d) {
  const m = d.meta;
  $('#p-name').textContent = m.title;
  const when = m.created ? new Date(m.created).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  $('#p-root').textContent = [m.project?.root || m.cwd, m.branch ? `branch ${m.branch}` : null, when ? `início ${when}` : null].filter(Boolean).join('   ');
  const chips = $('#p-chips');
  chips.replaceChildren();
  const chip = (cls, b, text) => {
    const ch = el('span', `chip ${cls}`);
    ch.append(el('b', null, String(b)), document.createTextNode(' ' + text));
    chips.append(ch);
  };
  const cs = CHAT_STATUS.find((x) => x.key === chatStatus({ ...m, live: d.live, status: d.status }));
  if (cs) chip(`st ${(BADGE[cs.key] || ['idle'])[0]}`, '●', cs.label.toLowerCase());
  chip('', m.prompts, m.prompts === 1 ? 'pedido seu' : 'pedidos seus');
  const acts = d.turns.reduce((n, t) => n + turnActions(t), 0);
  chip('', acts, acts === 1 ? 'ação' : 'ações');
  if (m.agents) chip('', m.agents, m.agents === 1 ? 'agente ajudante' : 'agentes ajudantes');
  if (m.errors) chip('error', m.errors, m.errors === 1 ? 'erro' : 'erros');
  if (m.cost != null) chip('', money(m.cost), '');
}

function renderHistoryDrawer(d) {
  const head = $('#d-head');
  const body = $('#d-body');
  head.replaceChildren();
  body.replaceChildren();
  const m = d.meta;
  head.append(
    el('h3', null, 'O que aconteceu neste chat'),
    el('p', null, `Você fez ${plural(m.prompts, 'pedido', 'pedidos')} e o Claude realizou ${plural(d.turns.reduce((n, t) => n + turnActions(t), 0), 'ação', 'ações')} para atender${m.agents ? `, com a ajuda de ${plural(m.agents, 'agente', 'agentes')}` : ''}.`),
    el('p', 'how', 'Na cena 3D, cada balão é um pedido seu. Os ícones que vêm depois mostram, em ordem, o que o Claude fez: ler um arquivo, editar, rodar um comando, pesquisar na web… Os robôs são agentes que ele chamou para ajudar. Clique num pedido para ver tudo o que aconteceu nele.'),
  );
  if (m.skills?.length) head.append(el('p', 'skills', `Skills (manuais de instruções) consultadas: ${m.skills.join(', ')}`));
  const ol = el('ol', 'turns');
  const sel = ui.turn ?? d.turns[d.turns.length - 1]?.n;
  for (const t of d.turns) {
    const li = el('li');
    li.dataset.turn = t.n;
    const on = t.n === sel;
    const errs = t.tools.filter((x) => x.err).length;
    const b = button('turn-btn' + (on ? ' on' : ''), () => selectTurn(t.n), el('span', 'tn', String(t.n + 1)), el('span', 'tp', t.prompt || '(início da conversa)'), el('span', 'tm', [plural(turnActions(t), 'ação', 'ações'), t.agents.length ? plural(t.agents.length, 'agente', 'agentes') : null, errs ? plural(errs, 'erro', 'erros') : null, ago(t.t)].filter(Boolean).join(' · ')));
    li.append(b);
    if (on) li.append(turnDetail(t));
    ol.append(li);
  }
  body.append(ol);
}

function turnDetail(t) {
  const box = el('div', 'turn-detail');
  if (t.prompt) {
    box.append(el('p', 'sub-h', 'O que você pediu'));
    box.append(el('p', 'full-prompt', t.prompt));
  }
  if (t.tools.length) {
    const sum = actionSummary(t.tools);
    if (sum) box.append(el('p', 'summary', sum));
  }
  if (t.reply) {
    box.append(el('p', 'sub-h', 'O que o Claude respondeu'));
    box.append(el('p', 'reply', t.reply));
  }
  if (t.agents.length) {
    box.append(el('p', 'sub-h', t.agents.length > 1 ? 'Agentes que ajudaram' : 'Agente que ajudou'));
    const ul = el('ul', 'agents');
    for (const a of t.agents) {
      const st = a.verdict === 'fail' || a.err ? 'error' : a.end ? 'done' : 'running';
      const b = el('div', `agent-row ${st}`);
      b.append(iconEl(a.stage || 'agent'), el('span', 'n', agentName(a)), el('span', 's', a.desc || ''));
      if (a.verdict) b.append(el('span', 's ' + a.verdict, VERDICT_PT[a.verdict]));
      else if (a.err) b.append(el('span', 's fail', `Deu erro: ${a.err}`));
      else if (a.result) b.append(el('span', 's', a.result));
      if (a.end && a.t) b.append(el('span', 'm', [plural(a.tools.length, 'ação', 'ações'), dur(a.end - a.t)].filter(Boolean).join(' em ')));
      else if (!a.end) b.append(el('span', 'm', 'Ainda trabalhando…'));
      ul.append(item(b));
    }
    box.append(ul);
  }
  if (t.tools.length) {
    box.append(el('p', 'sub-h', 'O que o Claude fez, passo a passo'));
    box.append(stepList(t.tools.map((s) => ({ ...s, ms: s.end && s.t ? s.end - s.t : null }))));
  }
  return box;
}

/** Step list with an icon per action: what it did (bold), what kind of action it is and how long it took. */
function stepList(steps) {
  const tl = el('ol', 'steps');
  for (const s of steps) {
    const cat = s.cat || stepCategory(s.tool || s.name, s.step);
    const li = el('li', s.err || s.st === 'error' ? 'error' : s.st === 'running' ? 'running' : 'done');
    li.append(iconEl(s.err || s.st === 'error' ? 'error' : iconKey(cat)));
    const txt = el('div', 'txt');
    txt.append(el('div', 't', s.step), el('div', 'm', [KIND_PT[cat] || 'Ação', s.st === 'running' ? 'agora' : null, s.ms != null ? secs(s.ms) : null].filter(Boolean).join(' · ')));
    if (s.err) txt.append(el('div', 'err', `Deu erro: ${s.err}`));
    li.append(txt);
    tl.append(li);
  }
  return tl;
}

// ----- pipeline drawer (same content as the project flow view)
function renderPipelineDrawer(det) {
  const head = $('#d-head');
  const body = $('#d-body');
  head.replaceChildren();
  body.replaceChildren();
  const back = () => button('back', () => selectStage(null), 'Voltar ao pipeline');
  if (ui.sel?.type === 'stage') {
    const f = det.flows[0];
    const s = f?.run?.stages.find((x) => x.key === ui.sel.key);
    const def = STAGES.find((x) => x.key === ui.sel.key);
    const h3 = el('h3', 'with-ic');
    h3.append(iconEl(def.key), document.createTextNode(def.label));
    head.append(back(), h3, el('p', null, STAGE_DESC[def.key]), el('p', 'how', `Situação: ${(s ? STAGE_PT[s.status] : 'Aguardando').toLowerCase()}${s?.dur && s.status !== 'pending' ? `, levou ${dur(s.dur)}` : ''}.`));
    const a = s?.agentId && det.agents.find((x) => x.id === s.agentId);
    if (!a) return body.append(el('p', 'hint pad', 'Esta etapa ainda não começou. Ela começa quando a etapa anterior terminar.'));
    if (s.history?.length > 1) {
      body.append(el('p', 'sub-h pad', 'Tentativas'));
      const ul = el('ul', 'agents');
      s.history.forEach((h, i) => ul.append(item(button('agent-btn', () => selectStage({ type: 'agent', id: h.id }), el('span', `dot ${h.verdict === 'fail' ? 'error' : h.status}`), el('span', 'n', `${i + 1}ª tentativa`), el('span', 's', h.verdict ? (h.verdict === 'pass' ? 'aprovada' : 'reprovada') : STATUS_PT[h.status] || '')))));
      body.append(ul);
    }
    body.append(...agentTimeline(a));
    return;
  }
  if (ui.sel?.type === 'agent') {
    const a = det.agents.find((x) => x.id === ui.sel.id);
    if (a) {
      head.append(back(), el('h3', null, a.kind === 'main' ? 'Claude (coordenador)' : agentName({ stage: a.stage, type: a.type || a.label })), el('p', null, `${STATUS_PT[a.status] || a.status}: ${a.step}`));
      return body.append(...agentTimeline(a));
    }
  }
  head.append(
    el('h3', null, 'Pipeline de entrega'),
    el('p', null, 'Seu pedido passa por 4 especialistas, um depois do outro: o Tech Lead planeja, o Engenheiro escreve o código, o QA testa e, se estiver tudo certo, o DevOps envia para o Git.'),
    el('p', 'how', 'Se o QA reprovar, o trabalho volta para o Engenheiro corrigir e depois é testado de novo. Clique numa etapa para ver o que ela fez.'),
  );
  for (const f of det.flows) {
    if (!f.run) continue;
    const box = el('section', 'flow focus');
    const fh = el('div', 'flow-head static');
    fh.append(el('span', 'n', f.run.task || 'Execução'), el('span', 'pstatus ' + f.run.status, RUN_PT[f.run.status]));
    box.append(fh);
    const ol = el('ol', 'stages');
    for (const s of f.run.stages) {
      const meta = [STAGE_PT[s.status], s.dur && s.status !== 'pending' ? dur(s.dur) : null, s.attempts > 1 ? `${s.attempts} tentativas` : null].filter(Boolean).join(', ');
      const b = button(`stage-btn ${s.status}`, () => selectStage({ type: 'stage', sid: f.sid, key: s.key }), iconEl(s.key), el('span', 'n', s.label), el('span', 'm', meta));
      if (s.status === 'pending') b.append(el('span', 's', STAGE_DESC[s.key]));
      if (s.status === 'active') b.append(el('span', 's', s.step || ''));
      if (s.key === 'test' && s.verdict) b.append(el('span', 's ' + s.verdict, VERDICT_PT[s.verdict]));
      if (s.key === 'ship' && s.status === 'done' && s.result) b.append(el('span', 's', s.result.split('\n').pop()));
      ol.append(item(b));
    }
    box.append(ol);
    if (f.run.reworks) box.append(el('p', 'hint', `O QA encontrou problemas e devolveu para o Engenheiro corrigir ${f.run.reworks === 1 ? '1 vez' : `${f.run.reworks} vezes`}.`));
    if (f.runs > 1) box.append(el('p', 'hint', `Este chat passou pelo pipeline ${f.runs} vezes; a cena mostra a última.`));
    body.append(box);
  }
}
function agentTimeline(a) {
  const dl = el('dl', 'facts');
  const fact = (k, v) => v != null && v !== '' && dl.append(el('dt', null, k), el('dd', null, String(v)));
  fact('Quem é', a.kind === 'main' ? 'O Claude, coordenando o trabalho' : agentName({ stage: a.stage, type: a.type }));
  fact('Situação', STATUS_PT[a.status] || a.status);
  if (a.skill) fact('Skill consultada', a.skill);
  fact('Ações feitas', a.tools);
  if (a.errors) fact('Erros', a.errors);
  fact('Começou', ago(a.started));
  if (a.result) fact('Resultado', a.result);
  const title = el('p', 'sub-h pad', 'Passo a passo (o mais recente primeiro)');
  return [dl, title, stepList([...a.steps].reverse().map((s) => ({ ...s, ms: s.dur })))];
}

function renderStage() {
  const d = ui.detail;
  $('#placeholder').hidden = !!d;
  $('#title').hidden = !d;
  $('#drawer').hidden = !d;
  $('#recenter').hidden = !d;
  $('#views').hidden = !(d && hasPipeline());
  $('#legend-history').hidden = !d || ui.view !== 'history';
  $('#legend-pipeline').hidden = !d || ui.view !== 'pipeline';
  const inset = d ? $('#drawer').offsetWidth + 24 : 0;
  history.setInset(inset);
  pipeline.setInset(inset);
  if (!d) {
    if (ui.chatId) $('#placeholder').firstElementChild.textContent = 'Carregando o histórico…';
    return;
  }
  renderTitle(d);
  if (ui.view === 'pipeline' && d.pipeline) renderPipelineDrawer(d.pipeline);
  else renderHistoryDrawer(d);
}

function renderFooter() {
  if (ui.mode === 'live') setConn('Ao vivo', 'live');
  else if (ui.mode === 'demo') setConn('Demonstração', 'demo');
  const r = ui.routes;
  const box = $('#router-stats');
  box.replaceChildren();
  if (r && r.total) {
    const avg = r.injected ? Math.round(r.tokens / r.injected) : 0;
    box.append(document.createTextNode('Roteador de skills: '), el('strong', null, `${r.injected} de ${r.total}`), document.createTextNode(` prompts com skill, ~${avg} tokens por sugestão`));
  }
}

function showTip(p, at) {
  const tip = $('#tip');
  if (!p || ui.view !== 'history') return (tip.hidden = true);
  tip.replaceChildren();
  if (p.kind === 'tool') {
    tip.append(el('b', null, p.tool.step), el('span', null, `${KIND_PT[p.tool.cat] || 'Ação'} · no seu pedido nº ${p.turn.n + 1}`));
    if (p.tool.err) tip.append(el('span', 'err', `Deu erro: ${p.tool.err}`));
  } else if (p.kind === 'agent') {
    const a = p.agent;
    tip.append(el('b', null, agentName(a)), el('span', null, a.desc || ''));
    if (a.verdict) tip.append(el('span', null, VERDICT_PT[a.verdict]));
  } else if (p.kind === 'turn') {
    tip.append(el('b', null, `Seu pedido nº ${p.turn.n + 1}`), el('span', null, (p.turn.prompt || '(início da conversa)').slice(0, 140)), el('span', null, 'Clique para ver os detalhes'));
  }
  tip.style.left = `${Math.min(at.x + 14, (tip.parentElement.clientWidth || 800) - 280)}px`;
  tip.style.top = `${at.y + 14}px`;
  tip.hidden = false;
}

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!ui.chatId && ui.chats.length && matchMedia('(min-width: 901px)').matches) {
      const first = groupChats(visibleChats(), ui.group)[0]?.chats[0];
      if (first) selectChat(first.id);
    }
    renderList();
    renderStage();
    renderFooter();
  });
}

// ------------------------------------------------------------------ legends (same icons as the 3D scene)
function fillLegends() {
  const add = (box, key, text, cls = '') => {
    const sp = el('span', cls);
    sp.append(iconEl(key), document.createTextNode(text));
    box.append(sp);
  };
  const lh = $('#legend-history');
  for (const [k, t] of [['prompt', 'Seu pedido'], ['read', 'Leu arquivo'], ['search', 'Buscou no código'], ['edit', 'Editou'], ['write', 'Criou arquivo'], ['exec', 'Rodou comando'], ['web', 'Web'], ['skill', 'Skill'], ['mcp', 'Conector'], ['agent', 'Agente ajudante'], ['error', 'Deu erro']]) add(lh, k, t);
  const lp = $('#legend-pipeline');
  for (const [k, t] of [['plan', 'Tech Lead planeja'], ['build', 'Engenheiro programa'], ['test', 'QA testa'], ['ship', 'DevOps envia'], ['git', 'Git']]) add(lp, k, t);
  const sep = el('span', 'sep');
  lp.append(sep);
  for (const [c, t] of [['idle', 'aguardando'], ['running', 'trabalhando'], ['thinking', 'concluído'], ['error', 'reprovado']]) {
    const sp = el('span');
    sp.append(el('i', `dot ${c}`), document.createTextNode(t));
    lp.append(sp);
  }
}
fillLegends();

// ------------------------------------------------------------------ controls
$('#filter').addEventListener('input', (e) => {
  ui.q = e.target.value;
  renderList();
});
$('#group').value = ui.group;
$('#show').value = ui.show;
$('#group').addEventListener('change', (e) => {
  ui.group = e.target.value;
  store.set('group', ui.group);
  renderList();
});
$('#show').addEventListener('change', (e) => {
  ui.show = e.target.value;
  store.set('show', ui.show);
  renderList();
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
$('#recenter').addEventListener('click', () => (ui.view === 'pipeline' ? pipeline.recenter() : history.recenter()));
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.view === 'pipeline' && ui.sel) selectStage(null);
});

const params = new URLSearchParams(location.search);
if (params.has('demo')) startLocalDemo();
else if (!(await connectLive())) startLocalDemo();
setInterval(() => {
  renderList();
  renderFooter();
}, 30000); // keep relative times fresh
render();
