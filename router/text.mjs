// Text normalization shared by the index builder and the runtime router.
// Zero dependencies, deterministic, fast (< 1 ms per prompt).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PT = JSON.parse(readFileSync(join(here, 'synonyms-pt.json'), 'utf8'));

const STOP = new Set(`
a an the and or of to in on for with by at from as is are be been being it its this that these those
i me my we our you your he she they them their what which who whom how when where why can could should
would will shall may might must do does did done doing not no yes use used using user users asked ask
want wants like also any all some more most such than then so if into out up down about over via
help please make get set new claude etc e g ie
o os um uma uns umas de do da dos das no na nos nas em para pra pro por com sem ao aos que se
eu meu minha nos nosso nossa voce voces ele ela eles elas isso isto esse essa este esta aquele
como quando onde porque qual quais quem ser estar ter fazer faz feito favor quero queria preciso
vamos tambem mais muito pouco ja ainda so ou e mas entao sobre ate cada todo toda todos todas
`.split(/\s+/).filter(Boolean));

export function fold(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('ments') && w.length > 9) return w.slice(0, -5);
  if (w.endsWith('ment') && w.length > 8) return w.slice(0, -4);
  for (const suf of ['ing', 'ed']) {
    if (w.endsWith(suf) && w.length > suf.length + 3) {
      let b = w.slice(0, -suf.length);
      if (/([b-df-hj-np-tv-z])\1$/.test(b) && !/(ll|ss|zz)$/.test(b)) b = b.slice(0, -1); // planning → plan
      else if (/(at|iz|bl|us|ov|iv|ag|uc|ur)$/.test(b)) b += 'e'; // creating → create
      return b;
    }
  }
  if (w.endsWith('es') && w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1);
  return w;
}

/** Raw words after folding (keeps hyphenated ids split + joined). */
export function words(s) {
  const f = fold(s).replace(/[^a-z0-9+#./-]+/g, ' ');
  const out = [];
  for (const tok of f.split(' ')) {
    if (!tok) continue;
    const t = tok.replace(/^[./-]+|[./-]+$/g, '');
    if (!t) continue;
    out.push(t);
    if (t.includes('-') || t.includes('/') || t.includes('.')) {
      for (const p of t.split(/[-/.]/)) if (p) out.push(p);
    }
  }
  return out;
}

/** Terms used for scoring: Portuguese mapped to English, stopwords dropped, stemmed. */
export function terms(s, { translate = true } = {}) {
  const out = [];
  for (const w of words(s)) {
    const mapped = translate && PT[w] ? PT[w] : [w];
    for (const m of mapped) {
      for (const piece of m.split(' ')) {
        if (!piece || piece.length < 2 || STOP.has(piece) || /^\d+(\.\d+)*$/.test(piece)) continue;
        out.push(stem(piece));
      }
    }
  }
  return out;
}

/** Normalized phrase string for substring matching of trigger phrases. */
export function phrase(s, opts) {
  return ' ' + terms(s, opts).join(' ') + ' ';
}
