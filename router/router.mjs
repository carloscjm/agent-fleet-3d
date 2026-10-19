// Deterministic skill router: BM25 over a prebuilt index + trigger phrases,
// explicit-name boosts and "use X instead" redirects taken from each skill's own description.
// No model calls; the only tokens spent are the one or few lines it injects.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { terms, phrase, fold } from './text.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = join(here, '..');

let cached;
export function loadIndex(path = join(here, 'index.json')) {
  if (!cached) cached = JSON.parse(readFileSync(path, 'utf8'));
  return cached;
}

const K1 = 1.2;
const B = 0.6;

export const DEFAULTS = {
  minScore: 4.5, // below this nothing is injected
  clearMargin: 0.3, // (top - 2nd) / top ≥ margin → single, confident pick
  maxCandidates: 3,
};

export function score(prompt, index = loadIndex()) {
  const q = terms(prompt);
  if (!q.length) return [];
  const qp = ' ' + q.join(' ') + ' ';
  const raw = fold(prompt);
  const qset = [...new Set(q)];
  const N = index.n;
  const results = [];
  const bonus = new Map();

  for (const s of index.skills) {
    let sc = 0;
    for (const t of qset) {
      const f = s.tf[t];
      if (!f) continue;
      const df = index.df[t] || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      sc += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * s.len) / index.avgdl));
    }
    // Trigger phrases written by the skill author: full match is a strong signal.
    for (const tp of s.trig) {
      const toks = tp.trim().split(' ');
      if (toks.length === 0) continue;
      if (qp.includes(tp)) {
        if (toks.length === 1) {
          const df = index.df[toks[0]] || 1;
          sc += 1 + Math.log(1 + N / df) / 2; // single-word triggers count by rarity
        } else sc += 2 + 1.5 * Math.min(toks.length, 4);
      }
      else if (toks.length >= 2) {
        const hit = toks.filter((t) => qp.includes(' ' + t + ' ')).length / toks.length;
        if (hit >= 0.75) sc += 1.5 * toks.length * hit;
      }
    }
    // Adjacent query term pairs that also appear adjacent in the description.
    for (let i = 0; i + 1 < q.length; i++) {
      if (q[i] !== q[i + 1] && s.text.includes(' ' + q[i] + ' ' + q[i + 1] + ' ')) sc += 1.5;
    }
    // Skill named explicitly ("use tlc-spec-driven", "/accessibility").
    if (raw.includes(s.id) || raw.includes(s.name)) sc += s.id.length > 4 ? 12 : 4;
    else if (s.nameKeys.some((k) => k.trim().split(' ').length > 1 && qp.includes(k))) sc += 4;
    // Redirect rules: "Do NOT use for SEO (use seo)".
    for (const [p, target] of s.redir) {
      if (qp.includes(p)) {
        sc -= 3;
        bonus.set(target, (bonus.get(target) || 0) + 2);
      }
    }
    // Author-declared exclusions without a redirect ("Do NOT use for fixing CI failures").
    for (const p of s.neg || []) {
      const toks = p.trim().split(' ');
      const hit = toks.filter((t) => qp.includes(' ' + t + ' ')).length / toks.length;
      if (hit === 1) sc -= 4;
      else if (hit >= 0.66 && toks.length >= 3) sc -= 2;
    }
    if (sc > 0) results.push({ s, score: sc });
  }
  for (const r of results) r.score += bonus.get(r.s.id) || 0;
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Decide what (if anything) to tell the model.
 * mode: 'none' | 'single' | 'shortlist'
 */
export function route(prompt, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const index = opts.index || loadIndex();
  const trimmed = String(prompt || '').trim();
  if (trimmed.startsWith('/') && !opts.force) return { mode: 'none', reason: 'slash-command', ranked: [] };
  if (terms(trimmed).length < 2 && !opts.force) return { mode: 'none', reason: 'too-short', ranked: [] };

  const ranked = score(trimmed, index);
  const top = ranked[0];
  if (!top || top.score < o.minScore) return { mode: 'none', reason: 'low-confidence', ranked };
  const second = ranked[1]?.score || 0;
  const margin = (top.score - second) / top.score;
  if (margin >= o.clearMargin) return { mode: 'single', picks: [top], ranked, margin };
  const picks = ranked.filter((r) => r.score >= Math.max(o.minScore, top.score * 0.6)).slice(0, o.maxCandidates);
  return { mode: picks.length === 1 ? 'single' : 'shortlist', picks, ranked, margin };
}

/** Compact text injected next to the user prompt (factual phrasing, as the hooks docs recommend). */
export function render(decision, root = PLUGIN_ROOT) {
  if (decision.mode === 'none') return '';
  const abs = (p) => join(root, p);
  if (decision.mode === 'single') {
    const { s } = decision.picks[0];
    return `Skill router: the "${s.name}" skill matches this request. Its instructions are at ${abs(s.path)} (read that file only; open its references/ files only if a step needs them).`;
  }
  const lines = decision.picks.map(({ s }) => `- ${s.name}: ${s.summary} → ${abs(s.path)}`);
  return `Skill router: possible skills for this request (read only the one that fits, or none):\n${lines.join('\n')}`;
}

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}
