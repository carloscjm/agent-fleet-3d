// Small 3D icons built from primitives, one merged geometry each, with a vertex-color "shade"
// so a single tint (instance or material color) gives a darker body and a lighter accent.
// All icons are about 0.5 units tall, centered on the origin and facing +z (toward the camera).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BODY = 0.55;
const MID = 0.8;
const ACCENT = 1.25;

function part(geo, shade, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1 } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3).fill(shade);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, seg = 16) => new THREE.CylinderGeometry(r1, r2, h, seg);
const sph = (r, a = 16, b = 12) => new THREE.SphereGeometry(r, a, b);
const tor = (r, t, a = 10, b = 32, arc = Math.PI * 2) => new THREE.TorusGeometry(r, t, a, b, arc);
const FRONT = Math.PI / 2; // rotate cylinders so their axis points at the camera

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const extrude = (shape, depth) => {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
};
// a check mark made of two bars
const check = (sz, z, shade = ACCENT, ox = 0, oy = 0) => [
  part(box(sz * 0.45, sz * 0.14, 0.04), shade, { x: ox - sz * 0.2, y: oy - sz * 0.05, z, rz: -Math.PI / 4 }),
  part(box(sz * 0.85, sz * 0.14, 0.04), shade, { x: ox + sz * 0.12, y: oy + sz * 0.08, z, rz: Math.PI / 4 }),
];

const BUILD = {
  // Leitura: uma folha com linhas de texto
  read: () => [
    part(box(0.34, 0.44, 0.05), BODY),
    part(box(0.12, 0.12, 0.052), MID, { x: 0.11, y: 0.16, z: 0.002, rz: Math.PI / 4 }),
    ...[0.1, 0.02, -0.06, -0.14].map((y, i) => part(box(i === 0 ? 0.14 : 0.22, 0.03, 0.02), ACCENT, { x: i === 0 ? -0.04 : 0, y, z: 0.035 })),
  ],
  // Busca: lupa
  search: () => [
    part(tor(0.13, 0.04), ACCENT, { x: -0.04, y: 0.06 }),
    part(cyl(0.11, 0.11, 0.02, 24), BODY, { x: -0.04, y: 0.06, rx: FRONT }),
    part(cyl(0.035, 0.035, 0.2), MID, { x: 0.1, y: -0.12, rz: Math.PI / 4 }),
  ],
  // Edição: lápis inclinado
  edit: () => {
    const p = { rz: -0.75 };
    const g = [part(cyl(0.06, 0.06, 0.34, 6), MID), part(cyl(0.0, 0.06, 0.12, 6), ACCENT, { y: -0.23 }), part(cyl(0.062, 0.062, 0.06, 6), BODY, { y: 0.2 })];
    const m = new THREE.Matrix4().makeRotationZ(p.rz);
    for (const x of g) x.applyMatrix4(m);
    return g;
  },
  // Arquivo novo: folha com um "+"
  write: () => [
    part(box(0.32, 0.42, 0.05), BODY, { x: -0.03, y: 0.02 }),
    ...[0.09, 0.01, -0.07].map((y) => part(box(0.2, 0.03, 0.02), MID, { x: -0.03, y, z: 0.035 })),
    part(cyl(0.11, 0.11, 0.04, 24), ACCENT, { x: 0.12, y: -0.15, z: 0.04, rx: FRONT }),
    part(box(0.12, 0.035, 0.03), BODY, { x: 0.12, y: -0.15, z: 0.07 }),
    part(box(0.035, 0.12, 0.03), BODY, { x: 0.12, y: -0.15, z: 0.07 }),
  ],
  // Comando: tela de terminal com ">_"
  exec: () => [
    part(extrude(roundedRect(0.48, 0.36, 0.05), 0.07), BODY),
    part(box(0.48, 0.06, 0.075), MID, { y: 0.15 }),
    part(box(0.12, 0.035, 0.03), ACCENT, { x: -0.11, y: 0.0, z: 0.045, rz: -0.6 }),
    part(box(0.12, 0.035, 0.03), ACCENT, { x: -0.11, y: -0.07, z: 0.045, rz: 0.6 }),
    part(box(0.12, 0.035, 0.03), ACCENT, { x: 0.05, y: -0.1, z: 0.045 }),
  ],
  // Web: globo com meridianos
  web: () => [
    part(sph(0.17, 20, 14), BODY),
    part(tor(0.18, 0.016, 6, 40), ACCENT, { rx: Math.PI / 2 }),
    part(tor(0.18, 0.016, 6, 40), ACCENT),
    part(tor(0.18, 0.016, 6, 40), ACCENT, { ry: Math.PI / 2 }),
  ],
  // Skill: livro aberto
  skill: () => [
    part(box(0.22, 0.32, 0.03), BODY, { x: -0.1, ry: 0.35 }),
    part(box(0.22, 0.32, 0.03), BODY, { x: 0.1, ry: -0.35 }),
    part(box(0.19, 0.29, 0.02), ACCENT, { x: -0.095, z: 0.03, ry: 0.35 }),
    part(box(0.19, 0.29, 0.02), ACCENT, { x: 0.095, z: 0.03, ry: -0.35 }),
    part(cyl(0.02, 0.02, 0.32, 8), MID, { z: -0.03 }),
  ],
  // Tarefas: prancheta com check
  task: () => [
    part(box(0.34, 0.44, 0.04), BODY),
    part(box(0.16, 0.06, 0.06), MID, { y: 0.22 }),
    ...check(0.16, 0.035, ACCENT, -0.08, 0.06),
    part(box(0.12, 0.03, 0.02), MID, { x: 0.08, y: 0.06, z: 0.03 }),
    part(box(0.24, 0.03, 0.02), MID, { y: -0.08, z: 0.03 }),
  ],
  // Conector: tomada
  mcp: () => [
    part(extrude(roundedRect(0.24, 0.22, 0.05), 0.18), MID),
    part(cyl(0.025, 0.025, 0.12), ACCENT, { x: -0.06, y: 0.16 }),
    part(cyl(0.025, 0.025, 0.12), ACCENT, { x: 0.06, y: 0.16 }),
    part(cyl(0.04, 0.04, 0.16), BODY, { y: -0.18 }),
  ],
  other: () => [part(new THREE.OctahedronGeometry(0.18, 0), MID)],
  // Seu pedido: balão de conversa com reticências
  prompt: () => {
    const s = roundedRect(0.6, 0.4, 0.12);
    const tail = new THREE.Shape();
    tail.moveTo(-0.16, -0.18);
    tail.lineTo(-0.24, -0.33);
    tail.lineTo(-0.04, -0.18);
    return [part(extrude(s, 0.08), MID), part(extrude(tail, 0.08), MID), ...[-0.15, 0, 0.15].map((x) => part(sph(0.04), ACCENT, { x, z: 0.05 }))];
  },
  // Agente ajudante: robô
  agent: () => [
    part(extrude(roundedRect(0.42, 0.32, 0.08), 0.3), MID),
    part(sph(0.05), ACCENT, { x: -0.09, y: 0.02, z: 0.16 }),
    part(sph(0.05), ACCENT, { x: 0.09, y: 0.02, z: 0.16 }),
    part(box(0.14, 0.025, 0.02), BODY, { y: -0.08, z: 0.155 }),
    part(cyl(0.015, 0.015, 0.12), BODY, { y: 0.22 }),
    part(sph(0.04), ACCENT, { y: 0.29 }),
    part(cyl(0.04, 0.04, 0.04, 12), BODY, { x: -0.23, rz: Math.PI / 2 }),
    part(cyl(0.04, 0.04, 0.04, 12), BODY, { x: 0.23, rz: Math.PI / 2 }),
  ],
  // Tech Lead: prancheta com o plano
  plan: () => [
    part(extrude(roundedRect(0.4, 0.52, 0.04), 0.05), BODY),
    part(extrude(roundedRect(0.18, 0.08, 0.02), 0.07), MID, { y: 0.26 }),
    ...[0.12, 0.0, -0.12].flatMap((y) => [...check(0.1, 0.04, ACCENT, -0.11, y), part(box(0.18, 0.03, 0.02), MID, { x: 0.06, y, z: 0.035 })]),
  ],
  // Engenheiro: engrenagem
  build: () => {
    const g = [part(cyl(0.2, 0.2, 0.1, 28), MID, { rx: FRONT }), part(cyl(0.08, 0.08, 0.13, 20), BODY, { rx: FRONT })];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.push(part(box(0.09, 0.09, 0.1), MID, { x: Math.cos(a) * 0.23, y: Math.sin(a) * 0.23, rz: a }));
    }
    g.push(part(tor(0.14, 0.015, 6, 32), ACCENT, { z: 0.055 }));
    return g;
  },
  // QA: escudo com check
  test: () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.26);
    s.quadraticCurveTo(0.14, 0.2, 0.22, 0.2);
    s.lineTo(0.22, 0.0);
    s.quadraticCurveTo(0.2, -0.18, 0, -0.28);
    s.quadraticCurveTo(-0.2, -0.18, -0.22, 0.0);
    s.lineTo(-0.22, 0.2);
    s.quadraticCurveTo(-0.14, 0.2, 0, 0.26);
    return [part(extrude(s, 0.08), MID), ...check(0.26, 0.05, ACCENT, 0, -0.01)];
  },
  // DevOps: foguete
  ship: () => {
    const prof = [
      [0.0, -0.2],
      [0.1, -0.18],
      [0.12, -0.05],
      [0.11, 0.08],
      [0.07, 0.18],
      [0.0, 0.26],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = [part(new THREE.LatheGeometry(prof, 20), MID), part(sph(0.045), ACCENT, { y: 0.06, z: 0.1 })];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      g.push(part(box(0.02, 0.13, 0.1), BODY, { x: Math.cos(a) * 0.12, y: -0.15, z: Math.sin(a) * 0.12, ry: -a }));
    }
    g.push(part(cyl(0.05, 0.0, 0.1, 10), ACCENT, { y: -0.26, rz: Math.PI }));
    return g;
  },
  // Git: ramificação com três commits
  git: () => {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.04, 0), new THREE.Vector3(0.16, 0.0, 0), new THREE.Vector3(0.16, 0.16, 0));
    return [
      part(cyl(0.025, 0.025, 0.44, 10), BODY),
      part(new THREE.TubeGeometry(curve, 12, 0.025, 8, false), BODY),
      part(sph(0.06), ACCENT, { y: -0.22 }),
      part(sph(0.06), ACCENT, { y: 0.22 }),
      part(sph(0.06), ACCENT, { x: 0.16, y: 0.16 }),
    ];
  },
};

const cache = new Map();
/** Merged geometry for an icon key (cached). */
export function iconGeometry(key) {
  const k = BUILD[key] ? key : 'other';
  if (!cache.has(k)) {
    const g = mergeGeometries(BUILD[k](), false);
    g.computeBoundingSphere();
    cache.set(k, g);
  }
  return cache.get(k);
}
export const ICON_KEYS = Object.keys(BUILD);

/** Material that shows the icon shading under any tint. */
export function iconMaterial(extra = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08, ...extra });
}

/** Icon key for a tool category or a pipeline stage. */
export function iconFor(cat) {
  return BUILD[cat] ? cat : cat === 'delegate' ? 'agent' : 'other';
}
