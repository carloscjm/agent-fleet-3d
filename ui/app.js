import { createScene } from './scene.js';
import { createState, apply, listProjects, projectDetail, startDemo, STAGES } from '../shared/fleet-core.mjs';

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

// sel: null | { type: 'agent', id } | { type: 'stage', sid, key }
const ui = { projects: [], details: {}, routes: null, selected: null, sel: null, focusSid: null, filter: '', mode: 'connecting' };

const scene = createScene($('#scene'), {
  onSelect: (s) => select(s == null ? null : typeof s === 'string' ? { type: 'agent', id: s } : { type: 'stage', ...s }),
  onFocusRow: (sid) => {
    ui.focusSid = sid;
    scene.focusRow(sid);
  },
});

// ------------------------------------------------------------------ data
let es = null;
function connectLive() {
  return new Promise((resolve) => {
    if (!location.protocol.startsWith('http')) return resolve(false);
    let opened = false;
    es = new EventSource('/api/stream');
    const timer = setTimeout(() => {
      if (!opened) {
        es.close();
        resolve(false);
      }
    }, 2500);
    es.addEventListener('update', (m) => {
      const d = JSON.parse(m.data);
      if (!opened) {
        opened = true;
        clearTimeout(timer);
        ui.mode = d.demo ? 'demo' : 'live';
        resolve(true);
      }
      ui.projects = d.projects;
      ui.routes = d.routes;
      Object.assign(ui.details, d.details);
      render();
    });
    es.onerror = () => {
      if (!opened) {
        clearTimeout(timer);
        es.close();
        resolve(false);
      } else setConn('Reconectando…', '');
    };
  });
}

let local = null;
function startLocalDemo() {
  if (local) return;
  es?.close();
  const state = createState();
  local = state;
  ui.mode = 'demo';
  startDemo((ev) => apply(state, ev), { speed: 1.2 });
  const pull = () => {
    const now = Date.now();
    ui.projects = listProjects(state, now);
    ui.routes = state.routes;
    for (const p of ui.projects) ui.details[p.id] = projectDetail(state, p.id, now);
    render();
  };
  pull();
  setInterval(pull, 500);
}

async function ensureDetail(id) {
  if (ui.details[id] || ui.mode !== 'live') return;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (r.ok) ui.details[id] = await r.json();
  } catch {}
}

// ------------------------------------------------------------------ helpers
function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s}s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
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
function runSummary(run) {
  if (!run) return 'Sem pipeline nesta sessão';
  if (run.status === 'complete') return 'Entregue no git';
  if (run.status === 'blocked') return 'QA reprovou, aguardando decisão';
  const s = run.stages.find((x) => x.key === run.current);
  return s ? `${s.label}: ${s.status === 'active' ? s.verb.toLowerCase() : 'próxima etapa'}` : RUN_PT[run.status];
}

// ------------------------------------------------------------------ render
function renderProjects() {
  const list = $('#projects');
  const focusId = document.activeElement?.dataset?.pid;
  const q = ui.filter.trim().toLowerCase();
  const items = ui.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q));
  list.replaceChildren();
  if (!ui.projects.length) {
    const li = el('li', 'empty');
    li.append(el('div', null, 'Nenhum agente trabalhando agora. Rode /agent-fleet-3d:pipeline com uma tarefa e o projeto aparece aqui assim que o Tech Lead começar.'));
    if (ui.mode !== 'demo') li.append(button(null, startLocalDemo, 'Ver demonstração'));
    list.append(li);
    return;
  }
  if (!items.length) {
    list.append(el('li', 'empty', `Nenhum projeto corresponde a “${ui.filter}”.`));
    return;
  }
  for (const p of items) {
    const li = el('li');
    const row = el('div', 'row');
    row.append(el('span', 'name', p.name), el('span', 'when', ago(p.last)));
    const status = p.pipe
      ? `${RUN_PT[p.pipe.status]}${p.pipe.reworks ? `, ${p.pipe.reworks} retrabalho${p.pipe.reworks > 1 ? 's' : ''}` : ''}`
      : `${p.counts.running + p.counts.thinking} de ${p.total} agentes ativos`;
    const b = button('project', () => selectProject(p.id), row, pipeBar(p.pipe?.stages || [], true), el('div', 'pstatus ' + (p.pipe?.status || ''), status), el('div', 'step', p.step || ''));
    b.setAttribute('aria-current', String(p.id === ui.selected));
    b.setAttribute('aria-label', `${p.name}: ${status}`);
    b.dataset.pid = p.id;
    li.append(b);
    list.append(li);
    if (p.id === focusId) b.focus();
  }
}

function renderStage() {
  const det = ui.selected ? ui.details[ui.selected] : null;
  $('#placeholder').hidden = !!det;
  $('#title').hidden = !det;
  $('#drawer').hidden = !det;
  $('#recenter').hidden = !det;
  scene.setProject(det);
  scene.setInset(det ? $('#drawer').offsetWidth + 24 : 0);
  if (!det) return;
  if (!ui.focusSid || !det.flows.some((f) => f.sid === ui.focusSid)) {
    ui.focusSid = det.flows[0]?.sid || null;
    scene.focusRow(ui.focusSid);
  }
  $('#p-name').textContent = det.name;
  $('#p-root').textContent = det.root;
  const chips = $('#p-chips');
  chips.replaceChildren();
  const c = { running: 0, complete: 0, blocked: 0, waiting: 0 };
  let reworks = 0;
  for (const f of det.flows) if (f.run) {
    c[f.run.status]++;
    reworks += f.run.reworks;
  }
  const chip = (cls, n, text) => {
    if (!n) return;
    const ch = el('span', `chip ${cls}`);
    ch.append(el('b', null, String(n)), document.createTextNode(' ' + text));
    chips.append(ch);
  };
  chip('running', c.running + c.waiting, c.running + c.waiting > 1 ? 'pipelines em andamento' : 'pipeline em andamento');
  chip('done', c.complete, c.complete > 1 ? 'entregues' : 'entregue');
  chip('error', c.blocked, c.blocked > 1 ? 'bloqueados pelo QA' : 'bloqueado pelo QA');
  chip('waiting', reworks, reworks > 1 ? 'retrabalhos' : 'retrabalho');
  if (!det.flows.some((f) => f.run)) chip('', det.flows.length, det.flows.length > 1 ? 'sessões sem pipeline' : 'sessão sem pipeline');
  renderDrawer(det);
}

function renderFlowCard(det, f) {
  const box = el('section', 'flow' + (f.sid === ui.focusSid ? ' focus' : ''));
  const head = button('flow-head', () => {
    ui.focusSid = f.sid;
    scene.focusRow(f.sid);
    render();
  });
  head.append(el('span', 'n', f.label), el('span', 'pstatus ' + (f.run?.status || ''), f.run ? RUN_PT[f.run.status] : STATUS_PT[f.status] || ''));
  box.append(head);
  if (f.run?.task) box.append(el('p', 'task', f.run.task));
  if (!f.run) {
    box.append(el('p', 'hint', 'Esta sessão não usou o pipeline. Rode /agent-fleet-3d:pipeline <tarefa> para passar uma tarefa pelas quatro etapas.'));
    box.append(el('p', 'hint', `Agora: ${f.step}`));
  } else {
    const ol = el('ol', 'stages');
    for (const s of f.run.stages) {
      const li = el('li');
      const meta = [STAGE_PT[s.status], s.dur && s.status !== 'pending' ? dur(s.dur) : null, s.attempts > 1 ? `${s.attempts} tentativas` : null].filter(Boolean).join(', ');
      const b = button(`stage-btn ${s.status}`, () => select({ type: 'stage', sid: f.sid, key: s.key }), el('span', 'dot'), el('span', 'n', s.label), el('span', 'm', meta));
      if (s.status === 'active') b.append(el('span', 's', s.step || ''));
      if (s.key === 'test' && s.verdict) b.append(el('span', 's ' + s.verdict, s.verdict === 'pass' ? 'Veredito: aprovado' : 'Veredito: reprovado'));
      if (s.key === 'ship' && s.status === 'done' && s.result) b.append(el('span', 's', s.result.split('\n').pop()));
      li.append(b);
      ol.append(li);
    }
    box.append(ol);
    if (f.run.reworks) box.append(el('p', 'hint', `O QA devolveu para o Engenheiro ${f.run.reworks} vez${f.run.reworks > 1 ? 'es' : ''}.`));
  }
  const others = f.others.map((id) => det.agents.find((a) => a.id === id)).filter(Boolean);
  if (others.length) {
    box.append(el('p', 'sub-h', 'Outros agentes'));
    const ul = el('ul', 'agents');
    for (const a of others) ul.append(item(button('agent-btn sub', () => select({ type: 'agent', id: a.id }), el('span', `dot ${a.status}`), el('span', 'n', a.label), el('span', 's', a.step))));
    box.append(ul);
  }
  return box;
}

function renderTimeline(a) {
  const dl = el('dl', 'facts');
  const fact = (k, v) => v != null && v !== '' && dl.append(el('dt', null, k), el('dd', null, String(v)));
  fact('Agente', a.kind === 'main' ? 'Sessão principal (orquestrador)' : a.type);
  fact('Estado', STATUS_PT[a.status] || a.status);
  fact('Skill', a.skill || 'nenhuma');
  fact('Ferramentas', a.tools);
  if (a.errors) fact('Erros', a.errors);
  fact('Início', ago(a.started));
  fact('Último evento', ago(a.last));
  if (a.result) fact('Resultado', a.result);
  const tl = el('ol', 'timeline');
  tl.setAttribute('aria-label', 'Passos, do mais recente ao mais antigo');
  for (const s of [...a.steps].reverse()) {
    const li = el('li', s.st);
    li.append(el('div', 't', s.step));
    const meta = [s.tool, ago(s.t), s.dur != null ? `${(s.dur / 1000).toFixed(s.dur < 10000 ? 1 : 0)}s` : s.st === 'running' ? 'em andamento' : null].filter(Boolean).join(', ');
    li.append(el('div', 'm', meta));
    if (s.err) li.append(el('div', 'err', s.err));
    tl.append(li);
  }
  return [dl, tl];
}

function renderDrawer(det) {
  const head = $('#d-head');
  const body = $('#d-body');
  head.replaceChildren();
  body.replaceChildren();
  const back = () => button('back', () => select(null), 'Voltar ao pipeline');

  if (ui.sel?.type === 'stage') {
    const f = det.flows.find((x) => x.sid === ui.sel.sid);
    const s = f?.run?.stages.find((x) => x.key === ui.sel.key);
    const def = STAGES.find((x) => x.key === ui.sel.key);
    head.append(back(), el('h3', null, def.label), el('p', null, `${def.verb}. ${s ? STAGE_PT[s.status] : 'Aguardando'}${s?.dur && s.status !== 'pending' ? `, ${dur(s.dur)}` : ''}.`));
    const a = s?.agentId && det.agents.find((x) => x.id === s.agentId);
    if (!a) {
      body.append(el('p', 'hint pad', 'Esta etapa ainda não começou. Ela inicia quando a etapa anterior terminar.'));
      return;
    }
    if (s.history?.length > 1) {
      body.append(el('p', 'sub-h pad', 'Tentativas'));
      const ul = el('ul', 'agents');
      s.history.forEach((h, i) => ul.append(item(button('agent-btn', () => select({ type: 'agent', id: h.id }), el('span', `dot ${h.verdict === 'fail' ? 'error' : h.status}`), el('span', 'n', `${i + 1}ª tentativa`), el('span', 's', h.verdict ? (h.verdict === 'pass' ? 'aprovado' : 'reprovado') : STATUS_PT[h.status] || '')))));
      body.append(ul);
    }
    body.append(...renderTimeline(a));
    return;
  }

  if (ui.sel?.type === 'agent') {
    const a = det.agents.find((x) => x.id === ui.sel.id);
    if (a) {
      head.append(back(), el('h3', null, a.label), el('p', null, `${STATUS_PT[a.status] || a.status}: ${a.step}`));
      body.append(...renderTimeline(a));
      return;
    }
  }

  head.append(el('h3', null, 'Pipeline'), el('p', null, 'Tech Lead planeja, Engenheiro implementa, QA testa e DevOps sobe para o git. Clique numa etapa para ver os passos.'));
  for (const f of det.flows) body.append(renderFlowCard(det, f));
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

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!ui.selected && ui.projects.length && matchMedia('(min-width: 901px)').matches) ui.selected = ui.projects[0].id;
    renderProjects();
    renderStage();
    renderFooter();
  });
}

async function selectProject(id) {
  ui.selected = id;
  ui.sel = null;
  ui.focusSid = null;
  scene.select(null);
  await ensureDetail(id);
  render();
}
function select(sel) {
  ui.sel = sel;
  const det = ui.details[ui.selected];
  let agentId = sel?.type === 'agent' ? sel.id : null;
  if (sel?.type === 'stage') {
    ui.focusSid = sel.sid;
    scene.focusRow(sel.sid);
    agentId = det?.flows.find((f) => f.sid === sel.sid)?.run?.stages.find((s) => s.key === sel.key)?.agentId || null;
  }
  if (sel?.type === 'agent' && det?.flows.some((f) => f.sid === sel.id)) {
    ui.focusSid = sel.id;
    scene.focusRow(sel.id);
  }
  scene.select(agentId);
  render();
}

$('#filter').addEventListener('input', (e) => {
  ui.filter = e.target.value;
  renderProjects();
});
$('#recenter').addEventListener('click', () => scene.recenter());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.sel) select(null);
});

const params = new URLSearchParams(location.search);
if (params.has('demo')) startLocalDemo();
else if (!(await connectLive())) startLocalDemo();
setInterval(render, 5000); // keep relative times fresh
render();
