import { createScene } from './scene.js';
import { createHistoryScene } from './scene-history.js';
import { createState, apply, listProjects, projectDetail, startDemo, STAGES } from '../shared/fleet-core.mjs';
import { parseTranscript, pipelineOf, historyFromLive, filterChats, groupChats } from '../shared/history-core.mjs';
import { demoTranscripts } from '../shared/history-demo.mjs';

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
      h.append(el('span', 'chev', open ? '▾' : '▸'), el('span', 'gname', g.label), el('span', 'gcount', String(g.chats.length)));
      if (g.sub) h.title = g.sub;
      sec.append(h);
    }
    if (open) {
      const ul = el('ul', 'chat-ul');
      for (const c of g.chats) {
        const row = el('div', 'row');
        row.append(el('span', 'name', c.title), el('span', 'when', ago(c.updated)));
        const meta = el('div', 'cmeta');
        if (c.live) meta.append(el('span', `dot ${c.status || 'running'}`));
        if (ui.group !== 'project') meta.append(el('span', 'proj', c.project?.name || ''));
        if (c.branch) meta.append(el('span', 'branch', c.branch));
        meta.append(el('span', 'counts', `${plural(c.prompts, 'prompt', 'prompts')}${c.errors ? `, ${plural(c.errors, 'erro', 'erros')}` : ''}`));
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
  if (d.live) chip('running', '●', STATUS_PT[d.status] ? STATUS_PT[d.status].toLowerCase() : 'ativo agora');
  chip('', m.prompts, m.prompts === 1 ? 'prompt' : 'prompts');
  chip('', m.tools, m.tools === 1 ? 'ferramenta' : 'ferramentas');
  if (m.agents) chip('', m.agents, m.agents === 1 ? 'subagente' : 'subagentes');
  if (m.errors) chip('error', m.errors, m.errors === 1 ? 'erro' : 'erros');
  if (m.cost != null) chip('', money(m.cost), '');
}

function renderHistoryDrawer(d) {
  const head = $('#d-head');
  const body = $('#d-body');
  head.replaceChildren();
  body.replaceChildren();
  head.append(el('h3', null, 'Histórico'), el('p', null, 'Cada anel na esteira é um prompt; os cubos depois dele são as ferramentas usadas. Clique num prompt para ver os detalhes.'));
  if (d.meta.skills?.length) head.append(el('p', 'skills', `Skills usadas: ${d.meta.skills.join(', ')}`));
  const ol = el('ol', 'turns');
  const sel = ui.turn ?? d.turns[d.turns.length - 1]?.n;
  for (const t of d.turns) {
    const li = el('li');
    li.dataset.turn = t.n;
    const on = t.n === sel;
    const b = button('turn-btn' + (on ? ' on' : ''), () => selectTurn(t.n), el('span', 'tn', String(t.n + 1)), el('span', 'tp', t.prompt || '(início da sessão)'), el('span', 'tm', `${plural(t.tools.length, 'ferramenta', 'ferramentas')}${t.agents.length ? `, ${plural(t.agents.length, 'subagente', 'subagentes')}` : ''}, ${ago(t.t)}`));
    li.append(b);
    if (on) li.append(turnDetail(t));
    ol.append(li);
  }
  body.append(ol);
}

function turnDetail(t) {
  const box = el('div', 'turn-detail');
  if (t.prompt) box.append(el('p', 'full-prompt', t.prompt));
  if (t.reply) {
    box.append(el('p', 'sub-h', 'Resposta'));
    box.append(el('p', 'reply', t.reply));
  }
  if (t.agents.length) {
    box.append(el('p', 'sub-h', 'Subagentes'));
    const ul = el('ul', 'agents');
    for (const a of t.agents) {
      const name = a.stage ? STAGE_LABEL[a.stage] : a.type;
      const st = a.verdict === 'fail' || a.err ? 'error' : a.end ? 'done' : 'running';
      const b = el('div', 'agent-row');
      b.append(el('span', `dot ${st}`), el('span', 'n', name), el('span', 's', a.desc || ''));
      if (a.verdict) b.append(el('span', 's ' + a.verdict, a.verdict === 'pass' ? 'Veredito: aprovado' : 'Veredito: reprovado'));
      else if (a.result) b.append(el('span', 's', a.result));
      if (a.end && a.t) b.append(el('span', 'm', `${plural(a.tools.length, 'passo', 'passos')}, ${dur(a.end - a.t)}`));
      ul.append(item(b));
    }
    box.append(ul);
  }
  if (t.tools.length) {
    box.append(el('p', 'sub-h', 'Ferramentas'));
    const tl = el('ol', 'timeline');
    for (const s of t.tools) {
      const li = el('li', s.err ? 'error' : 'done');
      li.append(el('div', 't', s.step));
      li.append(el('div', 'm', [s.name, s.end && s.t ? `${((s.end - s.t) / 1000).toFixed(1)}s` : null].filter(Boolean).join(', ')));
      if (s.err) li.append(el('div', 'err', s.err));
      tl.append(li);
    }
    box.append(tl);
  }
  return box;
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
    head.append(back(), el('h3', null, def.label), el('p', null, `${def.verb}. ${s ? STAGE_PT[s.status] : 'Aguardando'}${s?.dur && s.status !== 'pending' ? `, ${dur(s.dur)}` : ''}.`));
    const a = s?.agentId && det.agents.find((x) => x.id === s.agentId);
    if (!a) return body.append(el('p', 'hint pad', 'Esta etapa ainda não começou.'));
    if (s.history?.length > 1) {
      body.append(el('p', 'sub-h pad', 'Tentativas'));
      const ul = el('ul', 'agents');
      s.history.forEach((h, i) => ul.append(item(button('agent-btn', () => selectStage({ type: 'agent', id: h.id }), el('span', `dot ${h.verdict === 'fail' ? 'error' : h.status}`), el('span', 'n', `${i + 1}ª tentativa`), el('span', 's', h.verdict ? (h.verdict === 'pass' ? 'aprovado' : 'reprovado') : STATUS_PT[h.status] || '')))));
      body.append(ul);
    }
    body.append(...agentTimeline(a));
    return;
  }
  if (ui.sel?.type === 'agent') {
    const a = det.agents.find((x) => x.id === ui.sel.id);
    if (a) {
      head.append(back(), el('h3', null, a.label), el('p', null, `${STATUS_PT[a.status] || a.status}: ${a.step}`));
      return body.append(...agentTimeline(a));
    }
  }
  head.append(el('h3', null, 'Pipeline'), el('p', null, 'Tech Lead planeja, Engenheiro implementa, QA testa e DevOps sobe para o git. Clique numa etapa para ver os passos.'));
  for (const f of det.flows) {
    if (!f.run) continue;
    const box = el('section', 'flow focus');
    const fh = el('div', 'flow-head static');
    fh.append(el('span', 'n', f.run.task || 'Execução'), el('span', 'pstatus ' + f.run.status, RUN_PT[f.run.status]));
    box.append(fh);
    const ol = el('ol', 'stages');
    for (const s of f.run.stages) {
      const meta = [STAGE_PT[s.status], s.dur && s.status !== 'pending' ? dur(s.dur) : null, s.attempts > 1 ? `${s.attempts} tentativas` : null].filter(Boolean).join(', ');
      const b = button(`stage-btn ${s.status}`, () => selectStage({ type: 'stage', sid: f.sid, key: s.key }), el('span', 'dot'), el('span', 'n', s.label), el('span', 'm', meta));
      if (s.status === 'active') b.append(el('span', 's', s.step || ''));
      if (s.key === 'test' && s.verdict) b.append(el('span', 's ' + s.verdict, s.verdict === 'pass' ? 'Veredito: aprovado' : 'Veredito: reprovado'));
      if (s.key === 'ship' && s.status === 'done' && s.result) b.append(el('span', 's', s.result.split('\n').pop()));
      ol.append(item(b));
    }
    box.append(ol);
    if (f.run.reworks) box.append(el('p', 'hint', `O QA devolveu para o Engenheiro ${f.run.reworks} vez${f.run.reworks > 1 ? 'es' : ''}.`));
    if (f.runs > 1) box.append(el('p', 'hint', `Este chat rodou o pipeline ${f.runs} vezes; a cena mostra a mais recente.`));
    body.append(box);
  }
}
function agentTimeline(a) {
  const dl = el('dl', 'facts');
  const fact = (k, v) => v != null && v !== '' && dl.append(el('dt', null, k), el('dd', null, String(v)));
  fact('Agente', a.kind === 'main' ? 'Sessão principal (orquestrador)' : a.type);
  fact('Estado', STATUS_PT[a.status] || a.status);
  fact('Skill', a.skill || 'nenhuma');
  fact('Ferramentas', a.tools);
  if (a.errors) fact('Erros', a.errors);
  fact('Início', ago(a.started));
  if (a.result) fact('Resultado', a.result);
  const tl = el('ol', 'timeline');
  for (const s of [...a.steps].reverse()) {
    const li = el('li', s.st);
    li.append(el('div', 't', s.step));
    li.append(el('div', 'm', [s.tool, ago(s.t), s.dur != null ? `${(s.dur / 1000).toFixed(1)}s` : null].filter(Boolean).join(', ')));
    if (s.err) li.append(el('div', 'err', s.err));
    tl.append(li);
  }
  return [dl, tl];
}

function renderStage() {
  const d = ui.detail;
  $('#placeholder').hidden = !!d;
  $('#title').hidden = !d;
  $('#drawer').hidden = !d;
  $('#recenter').hidden = !d;
  $('#views').hidden = !(d && hasPipeline());
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
    tip.append(el('b', null, p.tool.step), el('span', null, `${p.tool.name}${p.tool.err ? ', com erro' : ''}, no prompt ${p.turn.n + 1}`));
    if (p.tool.err) tip.append(el('span', 'err', p.tool.err));
  } else if (p.kind === 'agent') {
    const a = p.agent;
    tip.append(el('b', null, a.stage ? STAGE_LABEL[a.stage] : a.type), el('span', null, a.desc || ''));
    if (a.verdict) tip.append(el('span', null, a.verdict === 'pass' ? 'Veredito: aprovado' : 'Veredito: reprovado'));
  } else if (p.kind === 'turn') {
    tip.append(el('b', null, `Prompt ${p.turn.n + 1}`), el('span', null, (p.turn.prompt || '(início da sessão)').slice(0, 140)));
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
