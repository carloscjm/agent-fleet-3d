// 3D history of one chat: a serpentine conveyor where time runs along the path.
// Each prompt is a gate, each tool call a cube on the belt (colored by kind), and each
// subagent a branch off the belt; pipeline stages use the station shapes of the flow view.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { iconGeometry, iconMaterial, iconFor } from './icons3d.js';
import { clip, agentLabel } from '../shared/steps.mjs';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const ROW_W = 28;
const ROW_GAP = 7;
const GAP = { turn: 2.4, tool: 0.82, agent: 3.4 };
const MAX_ITEMS = 1500;
const STAGE_LABEL = { plan: 'Tech Lead', build: 'Engenheiro', test: 'QA', ship: 'DevOps' };
const STAGE_DONE = { plan: 'planejou a tarefa', build: 'escreveu o código', test: 'testou o resultado', ship: 'enviou para o GitHub' };
const STAGE_DOING = { plan: 'planejando', build: 'escrevendo o código', test: 'testando', ship: 'enviando para o GitHub' };

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
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// arc-length position s → point on the serpentine
function posAt(s) {
  const row = Math.floor(s / ROW_W);
  const local = s - row * ROW_W;
  const x = row % 2 === 0 ? -ROW_W / 2 + local : ROW_W / 2 - local;
  return new THREE.Vector3(x, 0, -row * ROW_GAP);
}

export function createHistoryScene(host, { onSelectTurn, onHover } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 6;
  controls.maxDistance = 160;
  controls.maxPolarAngle = 1.45;
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(-10, 20, 12);
  scene.add(sun);
  const glow = glowTexture();

  let pal = {};
  let light = false;
  function readPalette() {
    const keys = ['sky', 'panel', 'ink', 'ink-2', 'ink-3', 'running', 'thinking', 'waiting', 'error', 'idle', 'focus', 'c-read', 'c-search', 'c-edit', 'c-write', 'c-exec', 'c-web', 'c-skill', 'c-task', 'c-mcp', 'c-agent'];
    pal = Object.fromEntries(keys.map((k) => [k, new THREE.Color(css('--' + k))]));
    light = pal.sky.getHSL({}).l > 0.5;
    scene.background = pal.sky;
    scene.fog = new THREE.Fog(pal.sky, 70, 220);
  }
  readPalette();
  const catColor = (cat, err) => (err ? pal.error : pal['c-' + cat] || pal['ink-2']);

  const geo = {
    tool: new THREE.BoxGeometry(0.32, 0.32, 0.32),
    mini: new THREE.BoxGeometry(0.16, 0.16, 0.16),
    gate: new THREE.TorusGeometry(0.62, 0.09, 10, 40),
    gateCore: new THREE.SphereGeometry(0.22, 18, 12),
    plan: new THREE.OctahedronGeometry(0.42, 0),
    build: new THREE.BoxGeometry(0.58, 0.58, 0.58),
    test: new THREE.TorusGeometry(0.34, 0.1, 10, 32),
    ship: new THREE.ConeGeometry(0.34, 0.8, 6),
    agent: new THREE.SphereGeometry(0.3, 18, 12),
    pad: new THREE.CylinderGeometry(0.75, 0.85, 0.12, 6),
  };

  let root = null; // THREE.Group for the current chat
  let model = null; // layout data
  let selectedTurn = null;
  let live = false;
  let visible = true;

  function clear() {
    if (!root) return;
    scene.remove(root);
    root.traverse((o) => {
      if (o.isCSS2DObject) o.element.remove();
      if (o.material) o.material.dispose?.();
      if (o.geometry && !Object.values(geo).includes(o.geometry)) o.geometry.dispose();
    });
    root = null;
    model = null;
  }

  function label(cls, parts) {
    const holder = el('div');
    const card = el('div', 'fcard ' + cls);
    for (const [c, t] of parts) if (t) card.appendChild(el('div', c, t));
    holder.appendChild(card);
    const o = new CSS2DObject(holder);
    o.center.set(0.5, 1);
    return { o, card };
  }

  /** Lay out a parsed history ({ meta, turns }) and build the meshes. */
  function setHistory(h, { isLive = false } = {}) {
    const sameChat = model && h && model.id === h.meta.id;
    const prevCount = model?.count;
    clear();
    live = isLive;
    if (!h) return;
    readPalette();
    root = new THREE.Group();
    scene.add(root);

    // flatten turns → positioned items; keep only the newest MAX_ITEMS tool calls
    let budget = MAX_ITEMS;
    const turns = h.turns;
    const keepFrom = (() => {
      let n = 0;
      for (let i = turns.length - 1; i >= 0; i--) {
        n += turns[i].items.length;
        if (n > budget) return i + 1;
      }
      return 0;
    })();
    const items = [];
    let s = 0.5;
    for (let ti = keepFrom; ti < turns.length; ti++) {
      const turn = turns[ti];
      items.push({ kind: 'turn', turn, s });
      s += GAP.turn * 0.7;
      for (const it of turn.items) {
        // avoid placing an item on the U-turn: push to next row start
        const room = ROW_W - (s % ROW_W);
        if (room < 0.6) s += room + 0.4;
        items.push({ kind: it.kind, ref: it.ref, turn, s });
        s += it.kind === 'agent' ? GAP.agent : GAP.tool;
      }
      s += GAP.turn * 0.3;
    }
    const length = Math.max(s, 4);
    const rows = Math.floor(length / ROW_W) + 1;

    // conveyor: straight segments + U-turns
    const beltMat = new THREE.MeshStandardMaterial({ color: pal['ink-3'], roughness: 0.6, transparent: true, opacity: light ? 0.55 : 0.45 });
    for (let r = 0; r < rows; r++) {
      const segLen = Math.min(ROW_W, length - r * ROW_W);
      if (segLen <= 0) break;
      const a = posAt(r * ROW_W);
      const b = posAt(r * ROW_W + segLen - 0.001);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(a.clone().setY(-0.12), b.clone().setY(-0.12)), 8, 0.06, 6, false), beltMat);
      root.add(tube);
      if (r < rows - 1 && segLen >= ROW_W - 0.01) {
        const end = posAt(r * ROW_W + ROW_W - 0.001);
        const side = r % 2 === 0 ? 1 : -1;
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const ang = (k / 16) * Math.PI;
          pts.push(new THREE.Vector3(end.x + side * Math.sin(ang) * (ROW_GAP / 2), -0.12, end.z - ROW_GAP / 2 + Math.cos(ang) * (ROW_GAP / 2)));
        }
        root.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.06, 6, false), beltMat));
      }
    }
    // faint floor under the whole path
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROW_W + 10, rows * ROW_GAP + 6),
      new THREE.MeshBasicMaterial({ color: pal.panel, transparent: true, opacity: light ? 0.55 : 0.35 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.5, -((rows - 1) * ROW_GAP) / 2);
    root.add(floor);

    // tools: one instanced mesh per icon (document, magnifier, pencil, terminal, globe…)
    const toolItems = items.filter((i) => i.kind === 'tool');
    const byIcon = new Map();
    for (const it of toolItems) {
      const key = iconFor(it.ref.cat);
      if (!byIcon.has(key)) byIcon.set(key, []);
      byIcon.get(key).push(it);
    }
    const toolMeshes = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1.2, 1.2, 1.2);
    for (const [key, list] of byIcon) {
      const mesh = new THREE.InstancedMesh(iconGeometry(key), iconMaterial(), list.length);
      list.forEach((it, k) => {
        const p = posAt(it.s);
        m4.compose(new THREE.Vector3(p.x, 0.2, p.z), q, one);
        mesh.setMatrixAt(k, m4);
        mesh.setColorAt(k, catColor(it.ref.cat, it.ref.err));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.items = list;
      root.add(mesh);
      toolMeshes.push(mesh);
    }

    // your messages: speech bubbles
    const gates = [];
    const turnItems = items.filter((i) => i.kind === 'turn');
    for (const it of turnItems) {
      const p = posAt(it.s);
      const g = new THREE.Group();
      g.position.copy(p);
      const bubble = new THREE.Mesh(iconGeometry('prompt'), iconMaterial({ color: pal.focus, emissive: pal.focus, emissiveIntensity: 0.25 }));
      bubble.position.y = 0.75;
      bubble.scale.setScalar(1.45);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, color: pal.focus, opacity: 0 }));
      halo.scale.setScalar(2.8);
      halo.position.y = 0.75;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), new THREE.MeshBasicMaterial({ color: pal.focus, transparent: true, opacity: 0.6 }));
      stem.position.y = 0.2;
      g.add(stem, bubble, halo);
      bubble.userData.pick = { kind: 'turn', turn: it.turn };
      root.add(g);
      gates.push({ g, bubble, halo, it });
    }

    // helper agents: a branch off the belt toward the camera, robot or pipeline-stage icon
    const agents = [];
    for (const it of items.filter((i) => i.kind === 'agent')) {
      const a = it.ref;
      const p = posAt(it.s);
      const node = new THREE.Vector3(p.x, 0.55, p.z + 2.2);
      const color = a.verdict === 'fail' || a.err ? pal.error : a.stage ? (a.end || !a.live ? pal.thinking : pal.running) : pal['c-agent'];
      const arm = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p.clone().setY(-0.12), new THREE.Vector3(p.x, -0.12, p.z + 1.2), node.clone().setY(-0.12)]), 10, 0.04, 6, false),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 })
      );
      root.add(arm);
      const pad = new THREE.Mesh(geo.pad, new THREE.MeshStandardMaterial({ color: pal.panel, roughness: 0.8, transparent: true, opacity: 0.9 }));
      pad.position.set(node.x, -0.42, node.z);
      root.add(pad);
      const shape = new THREE.Mesh(iconGeometry(a.stage || 'agent'), iconMaterial({ color, emissive: color, emissiveIntensity: 0.18 }));
      shape.position.copy(node);
      shape.scale.setScalar(1.7);
      shape.userData.pick = { kind: 'agent', agent: a, turn: it.turn };
      root.add(shape);
      // what this agent did, as small icons in front of it
      const n = Math.min(a.tools.length, 10);
      for (let k = 0; k < n; k++) {
        const tl = a.tools[a.tools.length - n + k];
        const c = new THREE.Mesh(iconGeometry(iconFor(tl.cat)), iconMaterial({ color: catColor(tl.cat, tl.err) }));
        c.scale.setScalar(0.5);
        c.position.set(node.x + (k - (n - 1) / 2) * 0.3, -0.2, node.z + 1.0);
        root.add(c);
      }
      const doing = !a.end && a.live;
      const title = a.stage ? STAGE_LABEL[a.stage] : agentLabel(a.type);
      const sub = a.stage ? (a.verdict === 'fail' ? 'reprovou: volta para o Engenheiro' : a.verdict === 'pass' ? 'aprovou o resultado' : doing ? STAGE_DOING[a.stage] : STAGE_DONE[a.stage]) : clip(a.desc || 'agente ajudante', 34);
      const lab = label(`stage ${a.verdict === 'fail' ? 'failed' : doing ? 'active' : 'done'} quiet`, [['n', title], ['m', sub]]);
      // alternate heights so neighbouring agent cards don't cover each other
      lab.o.position.set(node.x, node.y + (agents.length % 2 ? 2.35 : 1.05), node.z);
      root.add(lab.o);
      agents.push({ shape, it, lab });
    }

    // labels: first prompt, last prompt and the selected one (others on hover)
    const turnLabel = label('origin focus hist', []);
    root.add(turnLabel.o);
    const nowLabel = label('stage active quiet', [['n', 'agora']]);
    root.add(nowLabel.o);
    nowLabel.o.visible = false;
    const tail = posAt(length - 0.3);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 12), new THREE.MeshStandardMaterial({ color: pal.running, emissive: pal.running, emissiveIntensity: 0.8 }));
    head.position.set(tail.x, 0.12, tail.z);
    head.visible = isLive;
    root.add(head);
    nowLabel.o.position.set(tail.x, 0.9, tail.z);
    nowLabel.o.visible = isLive;

    model = { id: h.meta.id, items, gates, agents, toolMeshes, turnLabel, head, length, rows, count: items.length, firstTurn: keepFrom };
    const pickables = [...toolMeshes, ...gates.map((g) => g.bubble), ...agents.map((a) => a.shape)];
    model.pickables = pickables;
    if (selectedTurn != null && !turnItems.some((x) => x.turn.n === selectedTurn)) selectedTurn = null;
    applySelection();
    if (!sameChat) frame();
    else if (prevCount !== model.count && isLive) {
      /* keep the camera where the user left it while the chat grows */
    }
  }

  function applySelection() {
    if (!model) return;
    const sel = selectedTurn ?? model.gates[model.gates.length - 1]?.it.turn.n;
    for (const g of model.gates) {
      const on = g.it.turn.n === sel;
      g.halo.material.opacity = on ? (light ? 0.5 : 0.8) : 0;
      g.g.scale.setScalar(on ? 1.25 : 1);
    }
    const gate = model.gates.find((g) => g.it.turn.n === sel);
    const tl = model.turnLabel;
    tl.card.replaceChildren();
    if (gate) {
      const t = gate.it.turn;
      tl.card.appendChild(el('div', 'n', t.prompt ? `Seu pedido nº ${t.n + 1}` : 'Começo do chat'));
      tl.card.appendChild(el('div', 't', t.prompt ? t.prompt.slice(0, 90) : 'O Claude trabalhou antes do primeiro pedido'));
      const n = t.tools.length;
      tl.card.appendChild(el('div', 'm', `${n ? `O Claude fez ${n} ${n === 1 ? 'ação' : 'ações'}` : t.agents.length ? 'O Claude' : 'Só respondeu, sem usar ferramentas'}${t.agents.length ? ` ${n ? 'e ' : ''}chamou ${t.agents.length} ${t.agents.length > 1 ? 'agentes' : 'agente'}` : ''}`));
      tl.o.position.set(gate.g.position.x, 1.55, gate.g.position.z);
      tl.o.visible = true;
    } else tl.o.visible = false;
  }

  function selectTurn(n) {
    selectedTurn = n;
    applySelection();
  }

  // ------------------------------------------------------------ camera
  let fly = null;
  let rightInset = 0;
  function frame() {
    if (!model) return;
    const { clientWidth: w, clientHeight: h } = host;
    const visibleW = Math.max(200, w - (w > 900 ? rightInset : 0));
    const aspect = visibleW / Math.max(h, 1);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // bounds of what was actually drawn (short chats only use part of the first row)
    let minX = Infinity, maxX = -Infinity;
    for (const it of model.items) {
      const p = posAt(it.s);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
    }
    if (!Number.isFinite(minX)) (minX = -2), (maxX = 2);
    if (model.rows > 1) (minX = -ROW_W / 2), (maxX = ROW_W / 2);
    const halfW = Math.max(9, (maxX - minX) / 2 + 3);
    const depth = (model.rows - 1) * ROW_GAP + 4;
    const dW = halfW / Math.tan(hfov / 2) + depth * 0.35;
    const dH = (depth * 0.6 + 4) / Math.tan(vfov / 2);
    const dist = Math.max(dW, dH, 12);
    const target = new THREE.Vector3((minX + maxX) / 2, 0, -((model.rows - 1) * ROW_GAP) / 2 + 1);
    const pos = new THREE.Vector3(target.x, dist * 0.72, target.z + dist * 0.69);
    if (reduceMotion) {
      camera.position.copy(pos);
      controls.target.copy(target);
      return;
    }
    fly = { from: camera.position.clone(), fromT: controls.target.clone(), pos, target, t0: performance.now() };
  }
  camera.position.set(0, 20, 22);

  // ------------------------------------------------------------ picking + hover
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let down = null;
  function pick(e) {
    if (!model) return null;
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(model.pickables, false)[0];
    if (!hit) return null;
    if (hit.object.isInstancedMesh) {
      const it = hit.object.userData.items[hit.instanceId];
      return it ? { kind: 'tool', tool: it.ref, turn: it.turn } : null;
    }
    return hit.object.userData.pick;
  }
  renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const p = pick(e);
    if (p?.turn) onSelectTurn?.(p.turn.n, p);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    const p = pick(e);
    renderer.domElement.style.cursor = p ? 'pointer' : '';
    const r = host.getBoundingClientRect();
    onHover?.(p, { x: e.clientX - r.left, y: e.clientY - r.top });
  });
  renderer.domElement.addEventListener('pointerleave', () => onHover?.(null));

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
    frame();
  }
  new ResizeObserver(resize).observe(host);
  resize();

  const retheme = () => {
    readPalette();
    if (model) {
      // rebuild colors cheaply by re-running layout with the same data
      const h = lastData;
      if (h) setHistory(h, { isLive: live });
    }
  };
  let lastData = null;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const clock = new THREE.Clock();
  let simT = 0;
  function loop() {
    requestAnimationFrame(loop);
    if (document.hidden || !visible) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!reduceMotion) simT += dt;
    if (fly) {
      const u = Math.min(1, (performance.now() - fly.t0) / 1000);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      camera.position.lerpVectors(fly.from, fly.pos, e);
      controls.target.lerpVectors(fly.fromT, fly.target, e);
      if (u >= 1) fly = null;
    }
    if (model && !reduceMotion) {
      const sel = selectedTurn ?? model.gates[model.gates.length - 1]?.it.turn.n;
      for (const g of model.gates) g.bubble.position.y = 0.75 + (g.it.turn.n === sel ? Math.sin(simT * 2.5) * 0.08 : 0);
      if (model.head.visible) model.head.scale.setScalar(1 + 0.25 * Math.sin(simT * 5));
      for (const a of model.agents) if (!a.it.ref.end && live) a.shape.rotation.y = Math.sin(simT * 2) * 0.5;
    }
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  loop();

  return {
    setHistory(h, opts) {
      lastData = h;
      setHistory(h, opts);
    },
    selectTurn,
    setInset,
    recenter: frame,
    setVisible(v) {
      visible = v;
      host.hidden = !v;
      if (v) resize();
    },
  };
}
