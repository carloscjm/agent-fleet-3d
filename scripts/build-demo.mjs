#!/usr/bin/env node
// Builds a single self-contained demo page (three.js from CDN, built-in demo data):
//   docs/demo.html          full HTML document, for GitHub Pages or opening locally
//   docs/demo.fragment.html same page without the document skeleton, for hosts that add their own
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
// Wrap each module in its own function scope so top-level names (el, STATUS_PT…) can't clash,
// then expose only its exports.
function scoped(src) {
  const names = [...src.matchAll(/^export (?:const|function|let|async function) ([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  const body = src
    .replace(/^import [\s\S]*? from '[^']+';$/gm, '')
    .replace(/^export \{[^}]*\};?$/gm, '')
    .replace(/^export (?=(const|function|let|async))/gm, '');
  return `const { ${names.join(', ')} } = (() => {\n${body}\nreturn { ${names.join(', ')} };\n})();`;
}
// order matters: each module only sees the exports of the ones before it
const modules = ['shared/steps.mjs', 'shared/fleet-core.mjs', 'shared/history-core.mjs', 'shared/history-demo.mjs', 'ui/icons3d.js', 'ui/icons2d.js', 'ui/scene.js', 'ui/scene-history.js'];
const threeImports = [...new Set(modules.flatMap((m) => read(m).match(/^import .* from '(three|three\/addons\/[^']+)';$/gm) || []))];
const app = read('ui/app.js')
  .replace(/^import [\s\S]*? from '\.{1,2}\/[^']+';$/gm, '')
  .replace("if (params.has('demo'))", 'if (true)'); // no server here: always run the built-in demo
const bundle = [...threeImports, ...modules.map((m) => scoped(read(m))), app].join('\n');

let html = read('ui/index.html');
html = html.replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${read('ui/styles.css')}\n</style>`);
html = html
  .replace('"./vendor/three/three.module.js"', '"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"')
  .replace('"./vendor/three/addons/"', '"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"');
html = html.replace('<script type="module" src="./app.js"></script>', `<script type="module">\n${bundle}\n</script>`);

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'demo.html'), html);
const fragment = html
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<\/head>\s*<body>\s*/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
writeFileSync(join(root, 'docs', 'demo.fragment.html'), fragment);
console.log(`docs/demo.html (${Math.round(html.length / 1024)} KB), docs/demo.fragment.html`);
