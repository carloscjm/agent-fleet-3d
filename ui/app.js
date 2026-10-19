import { createScene } from './scene.js';
import { createState, apply, listProjects, projectDetail, startDemo } from '../shared/fleet-core.mjs';

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

const ui = { projects: [], details: {}, routes: null, selected: null, agent: null, filter: '', mode: 'connecting' };

const scene = createScene($('#scene'), { onSelect: (id) => selectAgent(id) });

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
  startDemo((ev) => apply(state, ev), { speed: 1.4 });
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
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function setConn(text, cls) {
  const c = $('#conn');
  c.textContent = text;
  c.className = 'conn ' + cls;
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
    li.append(el('div', null, 'Nenhum agente trabalhando agora. Abra o Claude Code em um projeto e ele aparece aqui assim que o primeiro agente agir.'));
    if (ui.mode !== 'demo') {
      const b = el('button', null, 'Ver demonstração');
      b.type = 'button';
      b.onclick = startLocalDemo;
      li.append(b);
    }
    list.append(li);
    return;
  }
  if (!items.length) {
    list.append(el('li', 'empty', `Nenhum projeto corresponde a “${ui.filter}”.`));
    return;
  }
  for (const p of items) {
    const li = el('li');
    const b = el('button', 'project');
    b.type = 'button';
    b.setAttribute('aria-current', String(p.id === ui.selected));
    const row = el('div', 'row');
    row.append(el('span', 'name', p.name), el('span', 'when', ago(p.last)));
    const dots = el('div', 'dots');
    const det = ui.details[p.id];
    const agents = det ? det.agents : [];
    for (const a of agents.slice(0, 14)) dots.append(el('span', `dot ${a.status} ${a.kind === 'main' ? '' : 'sub'}`));
    const busy = p.counts.running + p.counts.thinking;
    dots.append(el('span', 'count', `${busy} de ${p.total} ativos${p.counts.waiting ? `, ${p.counts.waiting} aguardando` : ''}`));
    b.append(row, dots, el('div', 'step', p.step || ''));
    b.setAttribute('aria-label', `${p.name}: ${busy} de ${p.total} agentes ativos`);
    b.onclick = () => selectProject(p.id);
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
  scene.setProject(det);
  scene.setInset(det ? $('#drawer').offsetWidth + 24 : 0);
  if (!det) return;
  $('#p-name').textContent = det.name;
  $('#p-root').textContent = det.root;
  const chips = $('#p-chips');
  chips.replaceChildren();
  const c = {};
  for (const a of det.agents) c[a.status] = (c[a.status] || 0) + 1;
  for (const st of ['running', 'thinking', 'waiting', 'error', 'idle', 'done']) {
    if (!c[st]) continue;
    const chip = el('span', `chip ${st}`);
    chip.append(el('b', null, String(c[st])), document.createTextNode(' ' + STATUS_PT[st].toLowerCase()));
    chips.append(chip);
  }
  renderDrawer(det);
}

function renderDrawer(det) {
  const head = $('#d-head');
  const body = $('#d-body');
  head.replaceChildren();
  body.replaceChildren();
  const a = ui.agent && det.agents.find((x) => x.id === ui.agent);
  if (!a) {
    head.append(el('h3', null, 'Agentes'), el('p', null, 'Clique em um agente na cena ou na lista para ver os passos.'));
    const ul = el('ul', 'agents');
    const mains = det.agents.filter((x) => x.kind === 'main');
    const order = [...mains.flatMap((m) => [m, ...det.agents.filter((x) => x.parent === m.id)]), ...det.agents.filter((x) => x.kind !== 'main' && !mains.some((m) => m.id === x.parent))];
    for (const x of order) {
      const li = el('li');
      const b = el('button', `agent-btn ${x.kind === 'main' ? '' : 'sub'}`);
      b.type = 'button';
      b.append(el('span', `dot ${x.status}`), el('span', 'n', x.label), el('span', 's', x.step));
      b.onclick = () => selectAgent(x.id);
      b.dataset.pid = 'agent:' + x.id;
      li.append(b);
      ul.append(li);
    }
    body.append(ul);
    return;
  }
  const back = el('button', 'back', 'Todos os agentes');
  back.type = 'button';
  back.onclick = () => selectAgent(null);
  head.append(back, el('h3', null, a.label), el('p', null, `${STATUS_PT[a.status] || a.status}: ${a.step}`));
  const dl = el('dl', 'facts');
  const fact = (k, v) => v != null && v !== '' && dl.append(el('dt', null, k), el('dd', null, String(v)));
  fact('Tipo', a.kind === 'main' ? 'Sessão principal' : a.type);
  fact('Skill', a.skill || 'nenhuma');
  fact('Ferramentas', a.tools);
  if (a.errors) fact('Erros', a.errors);
  fact('Início', ago(a.started));
  fact('Último evento', ago(a.last));
  body.append(dl);
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
  body.append(tl);
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
  ui.agent = null;
  scene.select(null);
  await ensureDetail(id);
  render();
}
function selectAgent(id) {
  ui.agent = id;
  scene.select(id);
  render();
}

$('#filter').addEventListener('input', (e) => {
  ui.filter = e.target.value;
  renderProjects();
});
for (const b of document.querySelectorAll('[data-layout]')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('[data-layout]')) x.setAttribute('aria-pressed', String(x === b));
    scene.setLayout(b.dataset.layout);
  });
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.agent) selectAgent(null);
});

const params = new URLSearchParams(location.search);
if (params.has('demo')) startLocalDemo();
else if (!(await connectLive())) startLocalDemo();
setInterval(render, 5000); // keep relative times fresh
render();
