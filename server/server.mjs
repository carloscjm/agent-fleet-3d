#!/usr/bin/env node
// Agent Fleet local server: tails ~/.agent-fleet/events.jsonl, keeps live state, serves the 3D UI + SSE.
// Usage: node server/server.mjs [--port 4317] [--demo] [--open]
import http from 'node:http';
import { createReadStream, readFileSync, existsSync, statSync, openSync, readSync, closeSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, dirname, posix, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { createState, apply, listProjects, projectDetail, startDemo } from '../shared/fleet-core.mjs';
import { HOME, EVENTS } from '../telemetry/common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
let PORT = Number(opt('--port', process.env.AGENT_FLEET_PORT || 4317));
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version || 'dev';
  } catch {
    return 'dev';
  }
})();
const DEMO = flag('--demo');

const state = createState();
const changed = new Set();
const clients = new Set();

function ingest(ev) {
  const id = apply(state, ev);
  if (id) changed.add(id);
}

// --- tail the events file -------------------------------------------------
let offset = 0;
let carry = '';
function readNew() {
  if (!existsSync(EVENTS)) return;
  const size = statSync(EVENTS).size;
  if (size < offset) offset = 0; // rotated
  if (size === offset) return;
  const start = offset === 0 ? Math.max(0, size - 10 * 1024 * 1024) : offset; // replay at most 10MB
  const len = size - start;
  const buf = Buffer.alloc(len);
  const fd = openSync(EVENTS, 'r');
  readSync(fd, buf, 0, len, start);
  closeSync(fd);
  offset = size;
  const lines = (carry + buf.toString('utf8')).split('\n');
  carry = lines.pop();
  for (const l of lines) {
    if (!l) continue;
    try {
      ingest(JSON.parse(l));
    } catch {}
  }
}
readNew();
changed.clear();
setInterval(readNew, 400);

if (DEMO) startDemo(ingest, { speed: Number(opt('--speed', 1)) });

// --- push updates -----------------------------------------------------------
function payload(selectedAll = false) {
  const now = Date.now();
  return {
    now,
    demo: DEMO,
    projects: listProjects(state, now),
    routes: state.routes,
    details: Object.fromEntries([...(selectedAll ? state.projects.keys() : changed)].map((id) => [id, projectDetail(state, id, now)])),
  };
}
let lastPush = 0;
setInterval(() => {
  if (!clients.size) return changed.clear();
  // refresh every 5s even without events so stale/idle status and relative times stay correct
  if (!changed.size && Date.now() - lastPush < 5000) return;
  lastPush = Date.now();
  const data = `event: update\ndata: ${JSON.stringify(payload())}\n\n`;
  changed.clear();
  for (const res of clients) res.write(data);
}, 1000);

// --- http ------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/api/health') return json(res, 200, { ok: true, app: 'agent-fleet-3d', version: VERSION, demo: DEMO, events: EVENTS });
  if (p === '/api/projects') return json(res, 200, { now: Date.now(), demo: DEMO, projects: listProjects(state, Date.now(), { includeInactive: url.searchParams.has('all') }), routes: state.routes });
  if (p.startsWith('/api/projects/')) {
    const d = projectDetail(state, decodeURIComponent(p.slice(14)), Date.now());
    return d ? json(res, 200, d) : json(res, 404, { error: 'not found' });
  }
  if (p === '/api/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(`event: update\ndata: ${JSON.stringify(payload(true))}\n\n`);
    clients.add(res);
    const ka = setInterval(() => res.write(': ka\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ka);
      clients.delete(res);
    });
    return;
  }
  // static: / → /ui/ (so relative asset paths resolve), /ui/*, /shared/*
  if (p === '/') {
    res.writeHead(302, { location: '/ui/' });
    return res.end();
  }
  // URL paths always use "/", so normalize with posix rules (path.normalize would turn them into "\" on Windows).
  let file;
  try {
    file = posix.normalize(decodeURIComponent(p.endsWith('/') ? p + 'index.html' : p));
  } catch {
    return json(res, 400, { error: 'bad path' });
  }
  if (!file.startsWith('/ui/') && !file.startsWith('/shared/')) return json(res, 404, { error: 'not found' });
  const abs = join(root, ...file.split('/').filter(Boolean));
  if (!abs.startsWith(root + sep) || !existsSync(abs) || statSync(abs).isDirectory()) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': TYPES[extname(abs)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(abs).pipe(res);
});

// Port busy: reuse it if it is this same version, otherwise move to the next free port
// (an older copy of the server may still be running from a previous plugin version).
let tries = 0;
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    const h = await r.json();
    if (h.app === 'agent-fleet-3d' && h.version === VERSION) {
      console.log(`Agent Fleet 3D já está rodando: http://localhost:${PORT}`);
      process.exit(0);
    }
  } catch {}
  if (++tries > 10) {
    console.log('Não encontrei porta livre entre 4317 e 4327.');
    process.exit(1);
  }
  PORT++;
  server.listen(PORT, '127.0.0.1');
});

server.on('listening', () => {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(join(HOME, 'server.pid'), String(process.pid));
  const url = `http://localhost:${PORT}`;
  console.log(`Agent Fleet 3D: ${url}${DEMO ? ' (demo)' : ''}\nlendo eventos de ${EVENTS}`);
  if (flag('--open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${cmd} ${url}`);
  }
});

server.listen(PORT, '127.0.0.1');
