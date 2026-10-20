// Indexes every Claude Code session saved on this machine (~/.claude/projects/**/<session>.jsonl),
// including sessions that never ran this plugin. Summaries are cached by mtime+size so a rescan
// only re-reads files that changed.
import { readdirSync, statSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parseTranscript, pipelineOf } from '../shared/history-core.mjs';
import { projectOf, HOME } from '../telemetry/common.mjs';

export function claudeDirs() {
  const dirs = [];
  if (process.env.AGENT_FLEET_CLAUDE_DIR) dirs.push(...process.env.AGENT_FLEET_CLAUDE_DIR.split(/[;,]/).filter(Boolean));
  else {
    if (process.env.CLAUDE_CONFIG_DIR) dirs.push(process.env.CLAUDE_CONFIG_DIR);
    dirs.push(join(homedir(), '.claude'));
  }
  return [...new Set(dirs)].map((d) => join(d, 'projects')).filter((d) => existsSync(d));
}

const MAX_FILE_BYTES = 80 * 1024 * 1024;

function readLines(file) {
  const out = [];
  let text;
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return out;
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const l of text.split('\n')) {
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {}
  }
  return out;
}

function subagentFiles(file) {
  const dir = join(dirname(file), basename(file, '.jsonl'), 'subagents');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

export function createHistory({ cacheFile = join(HOME, 'history-index.json') } = {}) {
  let index = new Map(); // file → { mtimeMs, size, meta }
  try {
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (saved.v === 2) for (const e of saved.entries) index.set(e.file, e);
  } catch {}
  const details = new Map(); // id → { mtimeMs, size, data }
  let dirty = false;
  let lastScan = 0;

  function listFiles() {
    const files = [];
    for (const root of claudeDirs()) {
      let projects = [];
      try {
        projects = readdirSync(root);
      } catch {
        continue;
      }
      for (const p of projects) {
        const dir = join(root, p);
        let entries = [];
        try {
          entries = readdirSync(dir);
        } catch {
          continue;
        }
        for (const f of entries) if (f.endsWith('.jsonl') && !f.startsWith('agent-')) files.push(join(dir, f));
      }
    }
    return files;
  }

  function summarizeFile(file) {
    const lines = readLines(file);
    if (!lines.length) return null;
    const { meta } = parseTranscript(lines, { project: null });
    if (!meta.prompts && !meta.tools) return null; // empty or aborted session
    const proj = meta.cwd ? projectOf(meta.cwd) : meta.project;
    meta.project = { id: proj.id, name: proj.name, root: proj.root };
    if (!meta.id) meta.id = basename(file, '.jsonl');
    return meta;
  }

  function scan(force = false) {
    if (!force && Date.now() - lastScan < 10000) return;
    lastScan = Date.now();
    const seen = new Set();
    for (const file of listFiles()) {
      seen.add(file);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const cur = index.get(file);
      if (cur && cur.mtimeMs === st.mtimeMs && cur.size === st.size) continue;
      const meta = summarizeFile(file);
      index.set(file, { file, mtimeMs: st.mtimeMs, size: st.size, meta });
      dirty = true;
    }
    for (const f of [...index.keys()]) if (!seen.has(f)) {
      index.delete(f);
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      try {
        mkdirSync(dirname(cacheFile), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify({ v: 2, entries: [...index.values()] }));
      } catch {}
    }
  }

  function list() {
    scan();
    return [...index.values()].filter((e) => e.meta).map((e) => ({ ...e.meta, file: undefined, mtime: e.mtimeMs }));
  }

  function fileOf(id) {
    for (const e of index.values()) if (e.meta?.id === id) return e.file;
    scan(true);
    for (const e of index.values()) if (e.meta?.id === id) return e.file;
    return null;
  }

  function detail(id, now = Date.now()) {
    const file = fileOf(id);
    if (!file) return null;
    let st;
    try {
      st = statSync(file);
    } catch {
      return null;
    }
    const subs = subagentFiles(file);
    const subSig = subs.map((f) => {
      try {
        return statSync(f).mtimeMs;
      } catch {
        return 0;
      }
    });
    const sig = `${st.mtimeMs}:${st.size}:${subSig.join(',')}`;
    const cached = details.get(id);
    if (cached && cached.sig === sig) return cached.data;
    const lines = readLines(file);
    const head = lines.find((l) => l && l.cwd);
    const proj = head ? projectOf(head.cwd) : null;
    const parsed = parseTranscript(lines, { subagents: subs.map(readLines), project: proj ? { id: proj.id, name: proj.name, root: proj.root } : null });
    const data = { meta: parsed.meta, turns: parsed.turns, pipeline: parsed.meta.pipeline ? pipelineOf(parsed.events, parsed.meta.id, now) : null };
    details.set(id, { sig, data });
    if (details.size > 30) details.delete(details.keys().next().value);
    return data;
  }

  return { scan, list, detail, dirs: claudeDirs };
}
