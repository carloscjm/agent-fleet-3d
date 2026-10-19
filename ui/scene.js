// 3D view of one project's agents. Two layouts share the same objects:
//  - orbit: agents revolve around the project core, subagents orbit their parent,
//           the last steps trail behind each agent as small packets.
//  - lanes: one track per agent, steps laid out as bars (height = duration), newest at the head.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const QUIET = new Set(['idle', 'done', 'stale', 'ended', 'ready']);
const MAX_BEADS = 12;

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
  if (tool === 'Router' || tool === 'Skill' || tool === 'Prompt') return 'meta';
  return 'other';
}

export function createScene(el, { onSelect } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  el.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  camera.position.set(0, 9.5, 17);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 5;
  controls.maxDistance = 70;
  controls.maxPolarAngle = 1.48;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.25;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const coreLight = new THREE.PointLight(0xffffff, 40, 40, 1.6);
  scene.add(coreLight);
  const glow = glowTexture();

  // palette from CSS tokens (follows light/dark)
  let pal = {};
  let light = false;
  function readPalette() {
    const keys = ['sky', 'line-strong', 'ink', 'ink-2', 'ink-3', 'running', 'thinking', 'waiting', 'error', 'idle', 'focus'];
    pal = Object.fromEntries(keys.map((k) => [k, new THREE.Color(css('--' + k).startsWith('rgba') ? css('--ink-3') : css('--' + k))]));
    light = pal.sky.getHSL({}).l > 0.5;
    scene.background = pal.sky;
    scene.fog = new THREE.Fog(pal.sky, 30, 110);
  }
  readPalette();
  const statusColor = (st) => pal[st] || pal.idle;
  const beadColor = (s) =>
    s.st === 'error' ? pal.error : s.st === 'running' ? pal.running : { read: pal['ink-3'], edit: pal.thinking, exec: pal.running, web: pal.waiting, delegate: pal.ink, meta: pal.focus, other: pal['ink-2'] }[category(s.tool)];

  // star chart: polar rings and spokes
  const chart = new THREE.Group();
  const chartMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3 });
  for (const r of [3, 6, 9, 12]) {
    const pts = [];
    for (let i = 0; i <= 128; i++) pts.push(new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * r, 0, Math.sin((i / 128) * Math.PI * 2) * r));
    chart.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), chartMat));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    chart.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(Math.cos(a) * 1.6, 0, Math.sin(a) * 1.6), new THREE.Vector3(Math.cos(a) * 12.6, 0, Math.sin(a) * 12.6)]), chartMat));
  }
  chart.position.y = -1.4;
  scene.add(chart);

  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 900; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(70 + Math.random() * 60);
    v.y = Math.abs(v.y) * 0.8 - 8;
    sp.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ size: 0.35, transparent: true, opacity: 0.7, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // project core
  const core = new THREE.Group();
  const coreWire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.55 }));
  const coreBall = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), new THREE.MeshBasicMaterial());
  core.add(coreWire, coreBall);
  scene.add(core);
  const spokeMat = new THREE.LineDashedMaterial({ dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.5 });

  function applyThemeColors() {
    chartMat.color.copy(pal['line-strong']);
    starMat.color.copy(light ? pal['ink-3'] : pal.ink);
    starMat.opacity = light ? 0.35 : 0.7;
    coreWire.material.color.copy(pal['ink-2']);
    coreBall.material.color.copy(pal.focus);
    spokeMat.color.copy(pal['ink-3']);
  }
  applyThemeColors();
  const retheme = () => {
    readPalette();
    applyThemeColors();
    for (const o of objs.values()) o.halo.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', retheme);
  new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------- agents
  const objs = new Map();
  const beadGeo = new THREE.BoxGeometry(1, 1, 1);
  let layout = 'orbit';
  let selected = null;
  let projectId = null;

  function makeAgent(a, parentObj) {
    const main = a.kind === 'main';
    const r = main ? 0.55 : 0.32;
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, emissiveIntensity: 0.7 }));
    body.userData.agentId = a.id;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending }));
    halo.scale.setScalar(r * 5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.75, 0.035, 8, 64), new THREE.MeshBasicMaterial());
    ring.rotation.x = Math.PI / 2.4;
    group.add(halo, body, ring);

    const holder = document.createElement('div');
    const inner = document.createElement('div');
    inner.className = 'alabel' + (main ? '' : ' sub');
    inner.innerHTML = '<div class="n"></div><div class="s"></div>';
    inner.addEventListener('click', () => onSelect?.(a.id));
    holder.appendChild(inner);
    const label = new CSS2DObject(holder);
    label.center.set(0, 0.5);
    label.position.set(r * 0.9, 0, 0);
    group.add(label);

    const beads = [];
    for (let i = 0; i < MAX_BEADS; i++) {
      const m = new THREE.Mesh(beadGeo, new THREE.MeshBasicMaterial({ transparent: true }));
      m.visible = false;
      scene.add(m);
      beads.push(m);
    }
    const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), spokeMat);
    scene.add(tether);
    const lane = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), chartMat);
    scene.add(lane);

    const start = parentObj ? parentObj.group.position.clone() : new THREE.Vector3();
    group.position.copy(start);
    group.scale.setScalar(0.01);
    scene.add(group);
    return { group, body, halo, ring, label, inner, beads, tether, lane, r, data: a, target: new THREE.Vector3(), phase: Math.random() * Math.PI * 2, dying: 0 };
  }

  function disposeAgent(o) {
    scene.remove(o.group, o.tether, o.lane, ...o.beads);
    o.label.element.remove();
    o.body.geometry.dispose();
    o.ring.geometry.dispose();
    o.tether.geometry.dispose();
    o.lane.geometry.dispose();
    for (const b of o.beads) b.material.dispose();
  }

  function setProject(detail) {
    if (!detail) {
      for (const o of objs.values()) disposeAgent(o);
      objs.clear();
      projectId = null;
      core.visible = false;
      return;
    }
    if (detail.id !== projectId) {
      for (const o of objs.values()) disposeAgent(o);
      objs.clear();
      projectId = detail.id;
      selected = null;
      controls.autoRotate = !reduceMotion;
      flyTo(layout);
    }
    core.visible = layout === 'orbit';
    const seen = new Set();
    // parents first so children can spawn from them
    const ordered = [...detail.agents].sort((x, y) => (x.kind === 'main' ? 0 : 1) - (y.kind === 'main' ? 0 : 1));
    for (const a of ordered) {
      seen.add(a.id);
      let o = objs.get(a.id);
      if (!o) {
        o = makeAgent(a, a.parent ? objs.get(a.parent) : null);
        objs.set(a.id, o);
      }
      o.data = a;
      o.dying = 0;
      o.inner.querySelector('.n').textContent = a.kind === 'main' ? a.label : a.label;
      o.inner.querySelector('.s').textContent = (a.skill && a.kind === 'main' && QUIET.has(a.status) ? `skill ${a.skill}` : a.step) || '';
      o.inner.className = `alabel ${a.kind === 'main' ? '' : 'sub'} ${a.status} ${QUIET.has(a.status) && a.kind !== 'main' ? 'quiet' : ''} ${selected === a.id ? 'sel' : ''}`;
    }
    for (const [id, o] of objs) if (!seen.has(id) && !o.dying) o.dying = performance.now();
  }

  function select(id) {
    selected = id;
    for (const [aid, o] of objs) o.inner.classList.toggle('sel', aid === id);
  }

  // ---------------------------------------------------------------- layouts
  function ordering() {
    const list = [...objs.values()].filter((o) => !o.dying);
    const mains = list.filter((o) => o.data.kind === 'main').sort((a, b) => a.data.started - b.data.started);
    const subsOf = (id) => list.filter((o) => o.data.parent === id).sort((a, b) => a.data.started - b.data.started);
    const orphans = list.filter((o) => o.data.kind !== 'main' && !objs.get(o.data.parent));
    return { mains, subsOf, orphans };
  }

  const mainOrbit = (i, n, t) => {
    const R = n <= 3 ? 4.8 : n > 6 ? 6 + 0.45 * (n - 6) : 6;
    return { R, a: (i / Math.max(n, 1)) * Math.PI * 2 + t * 0.035 };
  };
  const subOffset = (k, kc, t, phase, r = 1.9) => {
    const a = (k / Math.max(kc, 1)) * Math.PI * 2 + t * 0.28 + phase;
    return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.42, Math.sin(a) * r * 0.9);
  };

  function computeTargets(t) {
    const { mains, subsOf, orphans } = ordering();
    if (layout === 'orbit') {
      mains.forEach((o, i) => {
        const { R, a } = mainOrbit(i, mains.length, t);
        o.target.set(Math.cos(a) * R, 0, Math.sin(a) * R);
        o.orbit = { kind: 'main', R, a };
        const subs = subsOf(o.data.id);
        subs.forEach((s, k) => {
          s.target.copy(o.target).add(subOffset(k, subs.length, t, o.phase));
          s.orbit = { kind: 'sub', parent: o, k, kc: subs.length };
        });
      });
      orphans.forEach((o, i) => {
        o.target.set(Math.cos(i) * 3, 1.5, Math.sin(i) * 3);
        o.orbit = null;
      });
    } else {
      const rows = [];
      for (const m of mains) rows.push(m, ...subsOf(m.data.id));
      rows.push(...orphans);
      const n = rows.length;
      if (n !== laneCount) {
        laneCount = n;
        flyTo('lanes');
      }
      rows.forEach((o, i) => {
        o.target.set(2.5, 0, (i - (n - 1) / 2) * 1.45);
        o.orbit = null;
      });
    }
  }

  function placeBeads(o, t) {
    const steps = (o.data.steps || []).slice(-MAX_BEADS).reverse(); // newest first
    o.beads.forEach((b, j) => {
      const s = steps[j];
      b.visible = !!s && !o.dying;
      if (!s) return;
      b.material.color.copy(beadColor(s));
      const age = j / MAX_BEADS;
      b.material.opacity = 1 - age * 0.75;
      let p;
      if (layout === 'lanes') {
        const h = Math.min(1.9, 0.25 + Math.log10(1 + (s.dur || (s.st === 'running' ? 1500 : 300)) / 150) * 0.55);
        const pulse = s.st === 'running' && !reduceMotion ? 1 + 0.15 * Math.sin(t * 6) : 1;
        b.scale.set(0.34, h * pulse, 0.34);
        b.rotation.set(0, 0, 0);
        p = new THREE.Vector3(o.group.position.x - 1 - j * 0.5, h / 2 - 0.45, o.group.position.z);
      } else {
        const sz = (o.data.kind === 'main' ? 0.2 : 0.13) * (1 - age * 0.5);
        b.scale.setScalar(sz);
        if (!reduceMotion) b.rotation.set(t * 0.8 + j, t * 0.6 + j, 0);
        if (o.orbit?.kind === 'main') {
          const a = o.orbit.a - (j + 1) * 0.12;
          p = new THREE.Vector3(Math.cos(a) * o.orbit.R, 0, Math.sin(a) * o.orbit.R);
        } else if (o.orbit?.kind === 'sub') {
          const par = o.orbit.parent;
          const off = subOffset(o.orbit.k, o.orbit.kc, t - (j + 1) * 0.55, par.phase);
          p = par.group.position.clone().add(off);
        } else p = o.group.position.clone().add(new THREE.Vector3(-(j + 1) * 0.4, 0, 0));
      }
      b.position.lerp(p, b.userData.placed ? 0.25 : 1);
      b.userData.placed = true;
    });
  }

  // ---------------------------------------------------------------- camera
  let fly = null;
  let laneCount = 0;
  function flyTo(name) {
    const n = Math.max(3, laneCount);
    const to = name === 'lanes' ? { pos: new THREE.Vector3(-2, 4 + n * 0.75, 6 + n * 1.05), target: new THREE.Vector3(-2, -0.3, 0) } : { pos: new THREE.Vector3(0, 9.5, 17), target: new THREE.Vector3(0, 0, 0) };
    if (reduceMotion) {
      camera.position.copy(to.pos);
      controls.target.copy(to.target);
      return;
    }
    fly = { from: camera.position.clone(), fromT: controls.target.clone(), ...to, t0: performance.now() };
  }

  function setLayout(name) {
    if (name === layout) return;
    layout = name;
    chart.visible = name === 'orbit';
    core.visible = name === 'orbit' && !!projectId;
    controls.autoRotate = name === 'orbit' && !reduceMotion;
    for (const o of objs.values()) for (const b of o.beads) b.userData.placed = false;
    flyTo(name);
  }

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
    const hit = pick(e);
    onSelect?.(hit ? hit.object.userData.agentId : null);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    renderer.domElement.style.cursor = pick(e) ? 'pointer' : '';
  });
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    return ray.intersectObjects([...objs.values()].map((o) => o.body))[0];
  }

  // ---------------------------------------------------------------- loop
  // Optical center sits left of the agent drawer so nothing important hides behind it.
  let rightInset = 0;
  function resize() {
    const { clientWidth: w, clientHeight: h } = el;
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
  }
  new ResizeObserver(resize).observe(el);
  resize();

  const clock = new THREE.Clock();
  let simT = 0;
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!reduceMotion) simT += dt;
    const t = simT;
    const k = 1 - Math.exp(-dt * 5);

    if (fly) {
      const u = Math.min(1, (performance.now() - fly.t0) / 900);
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      camera.position.lerpVectors(fly.from, fly.pos, e);
      controls.target.lerpVectors(fly.fromT, fly.target, e);
      if (u >= 1) fly = null;
    }

    core.rotation.y += dt * 0.25;
    coreWire.rotation.x += dt * 0.1;
    computeTargets(t);

    const now = performance.now();
    for (const [id, o] of objs) {
      const st = o.data.status;
      const col = statusColor(st);
      o.body.material.color.copy(col);
      o.body.material.emissive.copy(col).multiplyScalar(QUIET.has(st) ? 0.15 : 0.55);
      o.halo.material.color.copy(col);
      o.ring.material.color.copy(col);
      o.ring.visible = st === 'running';
      if (!reduceMotion) o.ring.rotation.z += dt * 2.4;

      let haloOp = QUIET.has(st) ? 0.18 : 0.55;
      let s = 1;
      if (!reduceMotion) {
        if (st === 'running') s = 1 + 0.07 * Math.sin(t * 7 + o.phase);
        if (st === 'waiting') haloOp = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4));
        if (st === 'thinking') haloOp = 0.4 + 0.15 * Math.sin(t * 2 + o.phase);
      }
      if (selected === id) haloOp = Math.max(haloOp, 0.85);
      o.halo.material.opacity = haloOp * (light ? 0.6 : 1);

      if (o.dying) {
        const u = (now - o.dying) / 700;
        o.group.scale.setScalar(Math.max(0.01, 1 - u));
        if (u >= 1) {
          disposeAgent(o);
          objs.delete(id);
          continue;
        }
      } else {
        const cur = o.group.scale.x;
        o.group.scale.setScalar(cur + (s - cur) * Math.min(1, k * 2));
        o.group.position.lerp(o.target, k);
      }

      // tether: core → main (orbit), parent → sub (both layouts)
      const pos = o.tether.geometry.attributes.position;
      const parent = o.data.parent ? objs.get(o.data.parent) : null;
      const from = parent ? parent.group.position : layout === 'orbit' ? core.position : null;
      o.tether.visible = !!from && !o.dying;
      if (from) {
        pos.setXYZ(0, from.x, from.y, from.z);
        pos.setXYZ(1, o.group.position.x, o.group.position.y, o.group.position.z);
        pos.needsUpdate = true;
        o.tether.computeLineDistances();
        o.tether.geometry.computeBoundingSphere();
      }
      const lp = o.lane.geometry.attributes.position;
      o.lane.visible = layout === 'lanes' && !o.dying;
      if (o.lane.visible) {
        lp.setXYZ(0, -7.5, -0.45, o.group.position.z);
        lp.setXYZ(1, o.group.position.x, -0.45, o.group.position.z);
        lp.needsUpdate = true;
        o.lane.geometry.computeBoundingSphere();
      }
      placeBeads(o, t);
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }
  core.visible = false;
  frame();

  return { setProject, setLayout, select, setInset };
}
