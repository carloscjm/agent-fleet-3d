// Shared helpers for hook scripts. Hooks must never fail loudly: every caller wraps in try/catch.
import { mkdirSync, appendFileSync, statSync, renameSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';

export const HOME = process.env.AGENT_FLEET_HOME || join(homedir(), '.agent-fleet');
export const EVENTS = join(HOME, 'events.jsonl');
const MAX_BYTES = 20 * 1024 * 1024;

export async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function appendEvent(ev) {
  mkdirSync(HOME, { recursive: true });
  try {
    if (statSync(EVENTS).size > MAX_BYTES) renameSync(EVENTS, EVENTS + '.1');
  } catch {}
  appendFileSync(EVENTS, JSON.stringify(ev) + '\n');
}

const rootCache = new Map();
/** Nearest git root (or cwd) → stable project identity. */
export function projectOf(cwd) {
  if (!cwd) return { id: 'unknown', name: 'unknown', root: '' };
  if (rootCache.has(cwd)) return rootCache.get(cwd);
  let dir = cwd;
  let root = cwd;
  for (let i = 0; i < 25; i++) {
    if (existsSync(join(dir, '.git'))) {
      root = dir;
      break;
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const p = { id: createHash('sha1').update(root).digest('hex').slice(0, 10), name: basename(root) || root, root };
  rootCache.set(cwd, p);
  return p;
}

// Per-session memory of which skills the router already suggested (avoids paying for repeats).
const SESS = join(HOME, 'router-sessions.json');
export function loadSessions() {
  try {
    return JSON.parse(readFileSync(SESS, 'utf8'));
  } catch {
    return {};
  }
}
export function saveSessions(s) {
  const now = Date.now();
  for (const k of Object.keys(s)) if (now - (s[k].ts || 0) > 24 * 3600e3) delete s[k];
  mkdirSync(HOME, { recursive: true });
  writeFileSync(SESS, JSON.stringify(s));
}
