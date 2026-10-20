// 3D delivery flow for one project. Each main session is a row:
//   Sessão (orquestrador) → Tech Lead → Engenheiro → QA → DevOps → Git
// joined by a conveyor. The work packet travels to the active station, finished
// segments light up, and a rework arc links QA back to the Engineer when QA rejects.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const MAX_ROWS = 4;
const ROW_GAP = 9.5;
const NODE_X = [-14, -8.4, -2.8, 2.8, 8.4, 14]; // origin, plan, build, test, ship, git
const STAGE_KEYS = ['plan', 'build', 'test', 'ship'];
const MAX_SLABS = 8;
const STATUS_PT = {
  pending: 'Aguardando',
  active: 'Em andamento',
  done: 'Concluído',
  failed: 'Reprovado',
  stale: 'Sem atividade',
};

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function category(tool = '') {
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit';
  if (tool === 'Bash') return 'exec';
  if (/^Web/.test(tool)) return 'web';
  if (tool === 'Agent' || tool === 'Task') return 'delegate';
  return 'other';
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function fmtDur(ms) {
  if (!ms || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60}s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function createScene(host, { onSelect, onFocusRow } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 8;
  controls.maxDistance = 90;
  controls.maxPolarAngle = 1.45;

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(-8, 18, 12);
  scene.add(sun);
  const glow = glowTexture();

  // ------------------------------------------------------------ palette
  let pal = {};
  let light = false;
  function readPalette() {
    const keys = ['sky', 'panel', 'ink', 'ink-2', 'ink-3', 'running', 'thinking', 'waiting', 'error', 'idle', 'focus'];
    pal = Object.fromEntries(keys.map((k) => [k, new THREE.Color(css('--' + k))]));
    pal.line = new THREE.Color(css('--ink-3'));
    light = pal.sky.getHSL({}).l > 0.5;
    scene.background = pal.sky;
    scene.fog = new THREE.Fog(pal.sky, 45, 140);
  }
  readPalette();
  const stageColor = (s) =>
    ({ pending: pal.idle, active: s.agentStatus === 'waiting' ? pal.waiting : s.agentStatus === 'error' ? pal.error : pal.running, done: pal.thinking, failed: pal.error, stale: pal.idle })[s.status] || pal.idle;
  const slabColor = (st) =>
    st.st === 'error' ? pal.error : st.st === 'running' ? pal.running : { read: pal['ink-3'], edit: pal.thinking, exec: pal.running, web: pal.waiting, delegate: pal.ink, other: pal['ink-2'] }[category(st.tool)];

  // ------------------------------------------------------------ floor
  const floorMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18 });
  const floor = new THREE.Group();
  for (let x = -20; x <= 20; x += 2) floor.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, -40), new THREE.Vector3(x, 0, 12)]), floorMat));
  for (let z = -40; z <= 12; z += 2) floor.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-20, 0, z), new THREE.Vector3(20, 0, z)]), floorMat));
  floor.position.y = -0.62;
  scene.add(floor);

  function applyTheme() {
    floorMat.color.copy(pal.line);
    floorMat.opacity = light ? 0.22 : 0.16;
    for (const r of rows.values()) r.retheme();
  }
  const retheme = () => {
    readPalette();
    applyTheme();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ------------------------------------------------------------ shared geometry
  const geo = {
    pad: new THREE.CylinderGeometry(1.35, 1.5, 0.22, 6),
    plan: new THREE.OctahedronGeometry(0.62, 0),
    build: new THREE.BoxGeometry(0.85, 0.85, 0.85),
    test: new THREE.TorusGeometry(0.5, 0.13, 12, 40),
    testCore: new THREE.SphereGeometry(0.24, 20, 12),
    ship: new THREE.ConeGeometry(0.48, 1.1, 6),
    origin: new THREE.SphereGeometry(0.5, 32, 16),
    git: new THREE.CylinderGeometry(0.55, 0.55, 0.18, 32),
    slab: new THREE.BoxGeometry(0.55, 0.12, 0.55),
    packet: new THREE.BoxGeometry(0.42, 0.42, 0.42),
    ring: new THREE.TorusGeometry(1.75, 0.04, 8, 64),
    dot: new THREE.SphereGeometry(0.09, 10, 8),
    other: new THREE.SphereGeometry(0.2, 16, 10),
  };
  const NODE_Y = 0.55;

  // ------------------------------------------------------------ rows
  const rows = new Map(); // sid → row
  let focused = null;
  let selected = null;
  const pickables = [];

  function cardLabel(cls, onClick) {
    const holder = el('div');
    const card = el('div', 'fcard ' + cls);
    if (onClick) card.addEventListener('click', onClick);
    holder.appendChild(card);
    const obj = new CSS2DObject(holder);
    obj.center.set(0.5, 1);
    return { obj, card };
  }

  function makeRow(flow) {
    const group = new THREE.Group();
    scene.add(group);
    const curvePts = [];
    NODE_X.forEach((x, i) => {
      curvePts.push(new THREE.Vector3(x, NODE_Y, 0));
      if (i < NODE_X.length - 1) curvePts.push(new THREE.Vector3(x + 2.8, NODE_Y + 0.35, 0));
    });
    const curve = new THREE.CatmullRomCurve3(curvePts, false, 'centripetal');
    const nodeU = NODE_X.map((x) => (x - NODE_X[0]) / (NODE_X[NODE_X.length - 1] - NODE_X[0]));
    // u along curve is not linear in x; map by sampling
    const samples = 400;
    const xs = [];
    for (let i = 0; i <= samples; i++) xs.push(curve.getPointAt(i / samples).x);
    const uAtX = (x) => {
      let best = 0;
      for (let i = 0; i <= samples; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
      return best / samples;
    };
    for (let i = 0; i < nodeU.length; i++) nodeU[i] = uAtX(NODE_X[i]);

    // conveyor segments
    const segs = [];
    for (let i = 0; i < NODE_X.length - 1; i++) {
      const pts = [];
      for (let k = 0; k <= 24; k++) pts.push(curve.getPointAt(nodeU[i] + ((nodeU[i + 1] - nodeU[i]) * k) / 24));
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.075, 8, false);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, transparent: true }));
      group.add(m);
      segs.push(m);
    }

    // flow particles along lit part
    const particles = [];
    for (let i = 0; i < 18; i++) {
      const p = new THREE.Mesh(geo.dot, new THREE.MeshBasicMaterial({ transparent: true }));
      p.userData.offset = i / 18;
      group.add(p);
      particles.push(p);
    }

    // origin (session / orchestrator)
    const origin = new THREE.Mesh(geo.origin, new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.6 }));
    origin.position.set(NODE_X[0], NODE_Y + 0.15, 0);
    origin.userData.pick = { kind: 'main', sid: flow.sid };
    group.add(origin);
    pickables.push(origin);
    const originPad = new THREE.Mesh(geo.pad, new THREE.MeshStandardMaterial({ roughness: 0.8, transparent: true, opacity: 0.85 }));
    originPad.position.set(NODE_X[0], -0.5, 0);
    originPad.scale.setScalar(0.75);
    group.add(originPad);
    const originHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false }));
    originHalo.scale.setScalar(2.6);
    originHalo.position.copy(origin.position);
    group.add(originHalo);
    const originLabel = cardLabel('origin', () => onSelect?.(flow.sid));
    originLabel.obj.center.set(0.5, 0);
    originLabel.obj.position.set(NODE_X[0], -0.9, 0.6);
    group.add(originLabel.obj);

    // generic subagents next to the orchestrator
    const otherMeshes = [];

    // stations
    const stations = STAGE_KEYS.map((key, i) => {
      const x = NODE_X[i + 1];
      const sg = new THREE.Group();
      sg.position.set(x, 0, 0);
      group.add(sg);
      const pad = new THREE.Mesh(geo.pad, new THREE.MeshStandardMaterial({ roughness: 0.75, transparent: true }));
      pad.position.y = -0.5;
      sg.add(pad);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.15, emissiveIntensity: 0.6, transparent: true });
      const body = new THREE.Group();
      const main = new THREE.Mesh(geo[key], mat);
      body.add(main);
      if (key === 'test') {
        const core = new THREE.Mesh(geo.testCore, mat);
        body.add(core);
      }
      if (key === 'ship') main.position.y = 0.1;
      body.position.y = NODE_Y + 0.35;
      sg.add(body);
      for (const m of body.children) {
        m.userData.pick = { kind: 'stage', sid: flow.sid, key };
        pickables.push(m);
      }
      pad.userData.pick = { kind: 'stage', sid: flow.sid, key };
      pickables.push(pad);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false }));
      halo.scale.setScalar(3.4);
      halo.position.y = NODE_Y + 0.35;
      sg.add(halo);
      const ring = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ transparent: true }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.36;
      sg.add(ring);
      const slabs = [];
      for (let k = 0; k < MAX_SLABS; k++) {
        const s = new THREE.Mesh(geo.slab, new THREE.MeshBasicMaterial({ transparent: true }));
        s.position.set(0, -0.3 + k * 0.17, -1.85);
        s.visible = false;
        sg.add(s);
        slabs.push(s);
      }
      const label = cardLabel('stage', () => onSelect?.({ sid: flow.sid, key }));
      label.obj.position.set(0, NODE_Y + (i % 2 ? 2.9 : 1.6), 0);
      sg.add(label.obj);
      return { key, sg, pad, body, mat, halo, ring, slabs, label, data: null };
    });

    // git endpoint
    const git = new THREE.Group();
    git.position.set(NODE_X[5], 0, 0);
    group.add(git);
    const gitMat = new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.5 });
    for (let k = 0; k < 3; k++) {
      const d = new THREE.Mesh(geo.git, gitMat);
      d.position.y = -0.2 + k * 0.32;
      git.add(d);
    }
    const gitLabel = cardLabel('git');
    gitLabel.obj.center.set(0.5, 0);
    gitLabel.obj.position.set(0, -0.9, 0.6);
    git.add(gitLabel.obj);

    // rework path QA → Engenheiro: a loop on the floor, in front of the conveyor
    const ax0 = NODE_X[3];
    const ax1 = NODE_X[2];
    const arcCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ax0, -0.3, 1.3),
      new THREE.Vector3(ax0 - 1.2, -0.3, 2.7),
      new THREE.Vector3((ax0 + ax1) / 2, -0.3, 3.1),
      new THREE.Vector3(ax1 + 1.2, -0.3, 2.7),
      new THREE.Vector3(ax1 + 0.15, -0.3, 1.45),
    ]);
    const arcMat = new THREE.MeshBasicMaterial({ transparent: true });
    const arc = new THREE.Mesh(new THREE.TubeGeometry(arcCurve, 60, 0.07, 8, false), arcMat);
    group.add(arc);
    const arcHead = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 12), new THREE.MeshBasicMaterial({ transparent: true }));
    const endP = arcCurve.getPointAt(1);
    const endT = arcCurve.getTangentAt(1);
    arcHead.position.copy(endP);
    arcHead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), endT);
    group.add(arcHead);
    const arcDots = [];
    for (let i = 0; i < 5; i++) {
      const d = new THREE.Mesh(geo.dot, new THREE.MeshBasicMaterial({ transparent: true }));
      d.scale.setScalar(1.3);
      d.userData.offset = i / 5;
      group.add(d);
      arcDots.push(d);
    }
    const arcLabel = cardLabel('rework');
    arcLabel.obj.center.set(0.5, 0);
    arcLabel.obj.position.set((ax0 + ax1) / 2, -0.3, 3.3);
    group.add(arcLabel.obj);

    // work packet
    const packet = new THREE.Mesh(geo.packet, new THREE.MeshStandardMaterial({ roughness: 0.25, emissiveIntensity: 0.9 }));
    const packetHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false }));
    packetHalo.scale.setScalar(1.6);
    group.add(packet, packetHalo);

    const row = {
      sid: flow.sid,
      group,
      curve,
      nodeU,
      segs,
      particles,
      origin,
      originPad,
      originHalo,
      originLabel,
      otherMeshes,
      stations,
      git,
      gitMat,
      gitLabel,
      arc,
      arcMat,
      arcCurve,
      arcDots,
      arcHead,
      arcLabel,
      packet,
      packetHalo,
      packetU: 0,
      targetU: 0,
      data: flow,
      z: 0,
      zTarget: 0,
      born: performance.now(),
      dying: 0,
      retheme() {
        originPad.material.color.copy(pal.panel).lerp(pal.line, 0.25);
        for (const s of stations) s.pad.material.color.copy(pal.panel).lerp(pal.line, 0.3);
      },
    };
    row.retheme();
    group.scale.setScalar(0.01);
    return row;
  }

  function disposeRow(r) {
    scene.remove(r.group);
    r.group.traverse((o) => {
      if (o.isCSS2DObject) o.element.remove();
      if (o.material) o.material.dispose?.();
      if (o.geometry && !Object.values(geo).includes(o.geometry)) o.geometry.dispose();
    });
    for (let i = pickables.length - 1; i >= 0; i--) {
      let p = pickables[i];
      while (p && p !== r.group) p = p.parent;
      if (p === r.group) pickables.splice(i, 1);
    }
  }

  // ------------------------------------------------------------ data → row
  function fillCard(card, parts) {
    card.replaceChildren();
    for (const [cls, text] of parts) if (text) card.appendChild(el('div', cls, text));
  }

  function updateRow(row, flow, agentsById) {
    row.data = flow;
    const run = flow.run;
    const isFocus = focused === flow.sid;

    // origin card
    const runText = run ? `${run.task ? run.task : 'Pipeline'}${flow.runs > 1 ? ` · execução ${flow.runs}` : ''}` : 'Sem pipeline';
    fillCard(row.originLabel.card, [
      ['n', flow.label],
      ['t', isFocus ? runText : null],
      ['s', isFocus ? flow.step : null],
    ]);
    row.originLabel.card.className = `fcard origin ${flow.status} ${isFocus ? 'focus' : 'quiet'} ${selected === flow.sid ? 'sel' : ''}`;

    // stations
    row.stations.forEach((st, i) => {
      const s = run ? run.stages[i] : { key: st.key, status: 'pending', attempts: 0, label: ['Tech Lead', 'Engenheiro', 'QA', 'DevOps'][i] };
      st.data = s;
      const label = s.label || ['Tech Lead', 'Engenheiro', 'QA', 'DevOps'][i];
      let line2 = STATUS_PT[s.status];
      if (s.status === 'active') line2 = s.step || 'Em andamento';
      else if (s.status === 'done' && s.key === 'ship' && s.result) line2 = s.result.split('\n').pop();
      else if (s.status === 'done' || s.status === 'failed') line2 = `${STATUS_PT[s.status]} em ${fmtDur(s.dur)}`;
      const meta = [s.attempts > 1 ? (s.key === 'build' ? `retrabalho ${s.attempts - 1}` : `${s.attempts}ª tentativa`) : null, s.skill && isFocus ? `skill ${s.skill}` : null].filter(Boolean).join(' · ');
      fillCard(st.label.card, [
        ['n', label],
        ['s', isFocus ? line2 : null],
        ['m', isFocus ? meta : null],
      ]);
      st.label.obj.position.y = NODE_Y + (isFocus && i % 2 ? 2.9 : 1.6);
      st.label.card.className = `fcard stage ${s.status} ${s.agentStatus || ''} ${isFocus ? 'focus' : 'quiet'} ${selected && s.agentId === selected ? 'sel' : ''}`;
      // activity slabs: newest on top
      const steps = s.steps || [];
      st.slabs.forEach((slab, k) => {
        const step = steps[steps.length - MAX_SLABS + k] || null;
        slab.visible = !!step;
        if (step) {
          slab.material.color.copy(slabColor(step));
          slab.material.opacity = 0.35 + 0.65 * ((k + 1) / MAX_SLABS);
        }
      });
    });

    // git endpoint
    const ship = run?.stages[3];
    const shipped = ship?.status === 'done';
    fillCard(row.gitLabel.card, [
      ['n', 'Git'],
      ['s', shipped ? 'Entregue' : run?.status === 'blocked' ? 'Bloqueado pelo QA' : isFocus ? 'Aguardando DevOps' : null],
      ['m', isFocus && flow.completed ? `${flow.completed} entrega${flow.completed > 1 ? 's' : ''} nesta sessão` : null],
    ]);
    row.gitLabel.card.className = `fcard git ${shipped ? 'done' : 'pending'} ${isFocus ? 'focus' : 'quiet'}`;

    // rework arc
    const reworks = run?.reworks || 0;
    const testFailed = run?.stages[2].status === 'failed';
    row.arc.visible = row.arcHead.visible = reworks > 0 || testFailed;
    row.arcLabel.obj.visible = row.arc.visible && isFocus;
    fillCard(row.arcLabel.card, [['n', testFailed ? (run.stages[1].status === 'active' ? 'Retrabalho em andamento' : 'QA reprovou') : `Retrabalho ×${reworks}`]]);
    row.arcLabel.card.className = `fcard rework ${testFailed ? 'hot' : ''}`;

    // packet target
    const idx = run ? (run.current === 'complete' ? 5 : Math.max(0, STAGE_KEYS.indexOf(run.current)) + 1) : 0;
    row.targetU = row.nodeU[idx];
    row.packetIdx = idx;

    // other agents near the orchestrator
    const others = flow.others.map((id) => agentsById.get(id)).filter(Boolean);
    while (row.otherMeshes.length > others.length) {
      const m = row.otherMeshes.pop();
      row.group.remove(m);
      m.material.dispose();
    }
    while (row.otherMeshes.length < others.length) {
      const m = new THREE.Mesh(geo.other, new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.5 }));
      row.group.add(m);
      pickables.push(m);
      row.otherMeshes.push(m);
    }
    others.forEach((a, k) => {
      const m = row.otherMeshes[k];
      m.userData.pick = { kind: 'agent', id: a.id };
      m.userData.status = a.status;
      m.position.set(NODE_X[0] - 1.2 + (k % 5) * 0.6, -0.15, 1.6 + Math.floor(k / 5) * 0.6);
    });
  }

  function setProject(detail) {
    const flows = detail ? detail.flows.slice(0, MAX_ROWS) : [];
    const agentsById = new Map((detail?.agents || []).map((a) => [a.id, a]));
    const keep = new Set(flows.map((f) => f.sid));
    for (const [sid, r] of rows) if (!keep.has(sid) && !r.dying) r.dying = performance.now();
    if (!focused || !keep.has(focused)) focused = flows[0]?.sid || null;
    const projectChanged = detail?.id !== currentProject;
    if (projectChanged) {
      for (const r of rows.values()) disposeRow(r);
      rows.clear();
      currentProject = detail?.id || null;
      selected = null;
    }
    flows.forEach((f, i) => {
      let r = rows.get(f.sid);
      if (!r) {
        r = makeRow(f);
        rows.set(f.sid, r);
      }
      r.dying = 0;
      r.zTarget = -i * ROW_GAP;
      if (projectChanged) r.z = r.zTarget;
      updateRow(r, f, agentsById);
    });
    if (projectChanged || flows.length !== lastRowCount) frame(flows.length);
    lastRowCount = flows.length;
  }
  let currentProject = null;
  let lastRowCount = -1;
  let visible = true;

  function select(id) {
    selected = id;
  }
  function focusRow(sid) {
    focused = sid;
  }

  // ------------------------------------------------------------ camera
  let fly = null;
  let rightInset = 0;
  // Fit the whole flow (x from -17 to 17 plus labels) in the visible width, left of the drawer.
  function fitDistance(n) {
    const { clientWidth: w, clientHeight: h } = host;
    const visibleW = Math.max(200, w - (w > 900 ? rightInset : 0));
    const aspect = visibleW / Math.max(h, 1);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const halfW = 18.6;
    const depth = (Math.max(1, n) - 1) * ROW_GAP;
    // the front row sits closer to the camera than the target, so it needs the extra margin
    const dW = halfW / Math.tan(hfov / 2) + depth * 0.5 * 0.71;
    const dH = (depth * 0.55 + 6) / Math.tan(vfov / 2);
    return Math.max(dW, dH, 20);
  }
  function frame(n) {
    const depth = Math.max(1, n) - 1;
    const target = new THREE.Vector3(0, 0.8, -depth * ROW_GAP * 0.5);
    const dist = fitDistance(n);
    const pos = new THREE.Vector3(0, dist * 0.7, target.z + dist * 0.71);
    if (reduceMotion) {
      camera.position.copy(pos);
      controls.target.copy(target);
      return;
    }
    fly = { from: camera.position.clone(), fromT: controls.target.clone(), pos, target, t0: performance.now() };
  }
  function recenter() {
    frame(lastRowCount);
  }
  camera.position.set(0, 16, 22);

  // ------------------------------------------------------------ picking
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const hit = pick(e);
    if (!hit) return onSelect?.(null);
    const p = hit.object.userData.pick;
    if (p.sid) onFocusRow?.(p.sid);
    if (p.kind === 'main') onSelect?.(p.sid);
    else if (p.kind === 'stage') onSelect?.({ sid: p.sid, key: p.key });
    else if (p.kind === 'agent') onSelect?.(p.id);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    renderer.domElement.style.cursor = pick(e) ? 'pointer' : '';
  });
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return ray.intersectObjects(pickables, false).find((h) => h.object.userData.pick);
  }

  // ------------------------------------------------------------ loop
  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    if (rightInset && w > 900) camera.setViewOffset(w, h, rightInset / 2, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function setInset(px) {
    if (px === rightInset) return;
    rightInset = px;
    resize();
    frame(lastRowCount);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const clock = new THREE.Clock();
  let simT = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden || !visible) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!reduceMotion) simT += dt;
    const t = simT;
    const k = 1 - Math.exp(-dt * 4);

    if (fly) {
      const u = Math.min(1, (performance.now() - fly.t0) / 1000);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      camera.position.lerpVectors(fly.from, fly.pos, e);
      controls.target.lerpVectors(fly.fromT, fly.target, e);
      if (u >= 1) fly = null;
    }

    const now = performance.now();
    for (const [sid, r] of rows) {
      // enter / leave
      if (r.dying) {
        const u = (now - r.dying) / 600;
        r.group.scale.setScalar(Math.max(0.01, 1 - u));
        if (u >= 1) {
          disposeRow(r);
          rows.delete(sid);
          continue;
        }
      } else {
        const s = r.group.scale.x;
        r.group.scale.setScalar(s + (1 - s) * Math.min(1, k * 1.5));
      }
      r.z += (r.zTarget - r.z) * k;
      r.group.position.z = r.z;
      const isFocus = focused === sid;
      const run = r.data.run;

      // origin
      const ost = r.data.status;
      const oc = ost === 'waiting' ? pal.waiting : ost === 'running' ? pal.running : ost === 'thinking' ? pal.thinking : pal.idle;
      r.origin.material.color.copy(oc);
      r.origin.material.emissive.copy(oc).multiplyScalar(['idle', 'done', 'ended', 'stale'].includes(ost) ? 0.12 : 0.5);
      r.originHalo.material.color.copy(oc);
      r.originHalo.material.opacity = (ost === 'waiting' && !reduceMotion ? 0.35 + 0.35 * Math.sin(t * 4) : 0.3) * (light ? 0.6 : 1);
      r.originPad.material.opacity = isFocus ? 0.95 : 0.6;

      // conveyor segments: a segment lights once the station it leads to has started
      r.segs.forEach((seg, i) => {
        const nextStage = i < 4 ? run?.stages[i] : run?.stages[3];
        const lit = i < 4 ? nextStage && nextStage.status !== 'pending' : nextStage?.status === 'done';
        const failedSeg = i === 3 && run?.stages[2].status === 'failed';
        const c = failedSeg ? pal.error : lit ? pal.thinking : pal.idle;
        seg.material.color.copy(c);
        seg.material.emissive = seg.material.emissive || new THREE.Color();
        seg.material.emissive.copy(c).multiplyScalar(lit ? 0.35 : 0);
        seg.material.opacity = lit ? 0.95 : isFocus ? 0.45 : 0.3;
      });

      // particles flow from the session to the current station
      const uMax = r.nodeU[r.packetIdx ?? 0];
      r.particles.forEach((p) => {
        const has = uMax > 0.001 && !reduceMotion && run && run.status !== 'complete';
        p.visible = has;
        if (!has) return;
        const u = ((p.userData.offset + t * 0.12) % 1) * uMax;
        p.position.copy(r.curve.getPointAt(u));
        p.material.color.copy(pal.running);
        p.material.opacity = 0.35 + 0.65 * (u / uMax);
      });

      // stations
      r.stations.forEach((st, i) => {
        const s = st.data || { status: 'pending' };
        const c = stageColor(s);
        const quiet = s.status === 'pending';
        st.mat.color.copy(c);
        st.mat.emissive.copy(c).multiplyScalar(quiet ? 0.05 : s.status === 'active' ? 0.55 : 0.3);
        st.mat.opacity = quiet ? 0.45 : 1;
        st.halo.material.color.copy(c);
        let ho = quiet ? 0 : s.status === 'active' ? 0.6 : 0.25;
        if (!reduceMotion && s.status === 'active') {
          ho = s.agentStatus === 'waiting' ? 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4)) : 0.45 + 0.15 * Math.sin(t * 3 + i);
          st.body.rotation.y += dt * (s.agentStatus === 'running' ? 1.6 : 0.6);
          st.body.position.y = NODE_Y + 0.35 + Math.sin(t * 2.2 + i) * 0.08;
        } else if (!reduceMotion) st.body.rotation.y += dt * 0.1;
        if (selected && s.agentId === selected) ho = Math.max(ho, 0.85);
        st.halo.material.opacity = ho * (light ? 0.6 : 1);
        st.ring.visible = s.status === 'active';
        st.ring.material.color.copy(c);
        if (!reduceMotion) st.ring.rotation.z += dt * 1.8;
        st.pad.material.opacity = isFocus ? 0.95 : 0.6;
      });

      // git
      const shipped = run?.stages[3].status === 'done';
      r.gitMat.color.copy(shipped ? pal.thinking : pal.idle);
      r.gitMat.emissive.copy(shipped ? pal.thinking : pal.idle).multiplyScalar(shipped ? 0.4 : 0.05);

      // rework path
      const hot = run?.stages[2].status === 'failed';
      for (const d of r.arcDots) d.visible = r.arc.visible && hot && !reduceMotion;
      if (r.arc.visible) {
        const c = hot ? pal.error : pal.waiting;
        r.arcMat.color.copy(c);
        r.arcMat.opacity = hot ? 0.95 : 0.45;
        r.arcHead.material.color.copy(c);
        r.arcHead.material.opacity = r.arcMat.opacity;
        if (hot && !reduceMotion)
          for (const d of r.arcDots) {
            d.position.copy(r.arcCurve.getPointAt((d.userData.offset + t * 0.35) % 1));
            d.material.color.copy(pal.error);
          }
      }

      // packet travels along the conveyor to the current station
      r.packetU += (r.targetU - r.packetU) * Math.min(1, dt * 1.6);
      const pp = r.curve.getPointAt(Math.min(1, Math.max(0, r.packetU)));
      const bob = reduceMotion ? 0 : Math.sin(t * 3) * 0.08;
      r.packet.position.set(pp.x, pp.y + 0.55 + bob + (r.packetIdx > 0 && r.packetIdx < 5 ? 1.45 : 0.35), pp.z);
      if (!reduceMotion) r.packet.rotation.set(t * 0.9, t * 1.2, 0);
      const pc = run?.status === 'blocked' ? pal.error : run?.status === 'complete' ? pal.thinking : pal.focus;
      r.packet.material.color.copy(pc);
      r.packet.material.emissive.copy(pc).multiplyScalar(0.7);
      r.packet.visible = !!run;
      r.packetHalo.visible = !!run;
      r.packetHalo.position.copy(r.packet.position);
      r.packetHalo.material.color.copy(pc);
      r.packetHalo.material.opacity = light ? 0.4 : 0.7;

      // other agents
      for (const m of r.otherMeshes) {
        const st = m.userData.status;
        const c = st === 'running' ? pal.running : st === 'waiting' ? pal.waiting : st === 'error' ? pal.error : st === 'thinking' ? pal.thinking : pal.idle;
        m.material.color.copy(c);
        m.material.emissive.copy(c).multiplyScalar(0.4);
      }
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  applyTheme();
  loop();

  function setVisible(v) {
    visible = v;
    host.hidden = !v;
    if (v) {
      resize();
      frame(lastRowCount);
    }
  }

  return { setProject, select, focusRow, setInset, recenter, setVisible };
}
