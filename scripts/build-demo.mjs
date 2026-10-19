#!/usr/bin/env node
// Builds docs/demo.html: a single self-contained page (three.js from CDN) running the built-in
// demo data, for GitHub Pages or sharing a preview without installing the plugin.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const dataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');

const core = read('shared/fleet-core.mjs');
const scene = read('ui/scene.js');
const app = read('ui/app.js')
  .replace("'./scene.js'", "'fleet-scene'")
  .replace("'../shared/fleet-core.mjs'", "'fleet-core'")
  .replace("if (params.has('demo'))", 'if (true)'); // no server here: always run the built-in demo

let html = read('ui/index.html');
html = html.replace('<link rel="stylesheet" href="./styles.css" />', `<style>\n${read('ui/styles.css')}\n</style>`);
html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>/,
  `<script type="importmap">${JSON.stringify({
    imports: {
      three: 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
      'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/',
      'fleet-core': dataUrl(core),
      'fleet-scene': dataUrl(scene),
    },
  })}</script>`
);
html = html.replace('<script type="module" src="./app.js"></script>', `<script type="module">\n${app}\n</script>`);
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'demo.html'), html);
console.log(`docs/demo.html (${Math.round(html.length / 1024)} KB)`);
