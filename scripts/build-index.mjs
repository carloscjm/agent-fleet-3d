#!/usr/bin/env node
// Builds router/index.json from skills-library/**/SKILL.md.
// Runs offline (at install / sync time), so routing costs zero model tokens at runtime.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terms, phrase } from '../router/text.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lib = join(root, 'skills-library');

const W = { name: 3, trigger: 2.5, category: 1, desc: 1, when: 1, heading: 0.5 };

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === 'SKILL.md') out.push(p);
  }
  return out;
}

// Minimal YAML frontmatter reader: plain, quoted and folded (>, |) scalars.
function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const fm = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    if (/^[>|][-+]?$/.test(v.trim())) {
      const buf = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) buf.push(lines[++i].trim());
      v = buf.join(' ');
    } else if (/^["']/.test(v)) {
      const q = v[0];
      while (!v.trimEnd().endsWith(q) && i + 1 < lines.length) v += ' ' + lines[++i].trim();
      v = v.trim().slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
    }
    fm[k] = v.trim();
  }
  return fm;
}

const files = walk(lib).sort();
const skills = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const fm = frontmatter(src);
  const dir = dirname(f);
  const folder = dir.split('/').pop();
  const category = relative(lib, dir).split('/')[0];
  const name = fm.name || folder;
  const description = (fm.description || '').replace(/\s+/g, ' ');

  // Split positive vs. "Do NOT use ..." guidance.
  const negIdx = description.search(/\bdo not use\b/i);
  const pos = negIdx >= 0 ? description.slice(0, negIdx) : description;
  const neg = negIdx >= 0 ? description.slice(negIdx) : '';

  const triggers = [...pos.matchAll(/["“']([^"”']{3,80})["”']/g)].map((m) => m[1]);
  const triggerPhrases = [...new Set(triggers.map((t) => phrase(t)).filter((p) => p.trim()))];

  // "for SEO (use seo)" / "use create-rfc instead" → redirect rules.
  const redirects = [];
  for (const m of neg.matchAll(/([^,;()]+?)\s*\(\s*use ([a-z0-9-]+)[^)]*\)/gi)) {
    redirects.push([phrase(m[1].replace(/^(do not use|for|when|or)\s+/gi, '')), m[2].toLowerCase()]);
  }
  for (const m of neg.matchAll(/([^,;()]+?)\s*\buse ([a-z0-9-]+) instead/gi)) {
    if (!m[0].includes('(')) redirects.push([phrase(m[1].replace(/^(do not use|for|when|or)\s+/gi, '')), m[2].toLowerCase()]);
  }

  // Remaining "Do NOT use for a, b, or c" items without a redirect → soft penalties.
  const negatives = neg
    .replace(/\([^)]*\)/g, '')
    .replace(/\bdo not use\b\s*(for|when|to)?/gi, ',')
    .split(/,|;|\bor\b|\.\s/i)
    .map((x) => phrase(x))
    .filter((p) => p.trim().split(' ').length >= 2);

  const headings = [...src.slice(src.indexOf('---', 3) + 3).matchAll(/^#{1,3}\s+(.+)$/gm)]
    .slice(0, 15)
    .map((m) => m[1]);

  const tf = {};
  const add = (text, w) => {
    for (const t of terms(text)) tf[t] = (tf[t] || 0) + w;
  };
  add(name.replace(/-/g, ' '), W.name);
  add(folder.replace(/-/g, ' '), W.name / 2);
  add(category.replace(/-/g, ' '), W.category);
  for (const t of triggers) add(t, W.trigger);
  add(pos, W.desc);
  // The "Use when …" clause is the author's routing intent: weight it a bit more.
  const whenIdx = pos.search(/\b(use (it |this skill )?when|also use when|triggers? on)\b/i);
  if (whenIdx >= 0) add(pos.slice(whenIdx).replace(/["“”']/g, ' '), W.when);
  for (const h of headings) add(h, W.heading);

  for (const k of Object.keys(tf)) tf[k] = Math.round(tf[k] * 10) / 10;
  const len = Object.values(tf).reduce((a, b) => a + b, 0);

  const firstSentence = pos.split(/(?<=\.)\s/)[0].replace(/\s+/g, ' ').trim();
  skills.push({
    id: folder,
    name,
    cat: category,
    path: relative(root, f),
    summary: firstSentence.length > 110 ? firstSentence.slice(0, 107) + '…' : firstSentence,
    descChars: description.length,
    bytes: Buffer.byteLength(src),
    len: Math.round(len * 10) / 10,
    tf,
    trig: triggerPhrases,
    redir: redirects.filter(([p]) => p.trim().length > 1),
    neg: [...new Set(negatives)],
    text: phrase(pos.replace(/["“”']/g, ' ')),
    nameKeys: [...new Set([phrase(name.replace(/-/g, ' ')), phrase(folder.replace(/-/g, ' '))])],
  });
}

// Resolve redirect targets by name or folder id.
const byKey = new Map();
for (const s of skills) {
  byKey.set(s.name, s.id);
  byKey.set(s.id, s.id);
}
for (const s of skills) {
  s.redir = s.redir.map(([p, t]) => [p, byKey.get(t)]).filter(([, t]) => t && t !== s.id);
}

const df = {};
for (const s of skills) for (const t of Object.keys(s.tf)) df[t] = (df[t] || 0) + 1;
const avgdl = skills.reduce((a, s) => a + s.len, 0) / skills.length;

const sourceCommit = existsSync(join(lib, '.source-commit'))
  ? readFileSync(join(lib, '.source-commit'), 'utf8').trim()
  : null;

const index = { v: 1, built: new Date().toISOString(), source: sourceCommit, n: skills.length, avgdl, df, skills };
writeFileSync(join(root, 'router', 'index.json'), JSON.stringify(index));

const allDesc = skills.reduce((a, s) => a + s.descChars + s.name.length + 8, 0);
console.log(
  `index: ${skills.length} skills, ${Object.keys(df).length} terms, ` +
    `~${Math.round(allDesc / 4)} tokens if every description were preloaded`
);
