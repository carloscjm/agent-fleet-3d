#!/usr/bin/env node
// Manual routing: node router/route-cli.mjs "audit accessibility of my landing page" [--json] [--top N]
import { route, render, estimateTokens } from './router.mjs';

const args = process.argv.slice(2);
const json = args.includes('--json');
const topIdx = args.indexOf('--top');
const top = topIdx >= 0 ? Number(args[topIdx + 1]) : 5;
const prompt = args.filter((a, i) => !a.startsWith('--') && i !== topIdx + 1).join(' ');

if (!prompt) {
  console.error('usage: route-cli.mjs "<task description>" [--json] [--top N]');
  process.exit(1);
}

const d = route(prompt, { force: true });
if (json) {
  console.log(
    JSON.stringify(
      {
        mode: d.mode,
        reason: d.reason,
        ranked: d.ranked.slice(0, top).map((r) => ({ id: r.s.id, name: r.s.name, score: +r.score.toFixed(2), path: r.s.path })),
      },
      null,
      2
    )
  );
} else {
  const text = render(d);
  console.log(text || 'Skill router: no skill clearly matches; proceed without one.');
  console.log(`\n(${d.mode}, ~${estimateTokens(text)} tokens injected)`);
  for (const r of d.ranked.slice(0, top)) console.log(`  ${r.score.toFixed(2).padStart(6)}  ${r.s.name}  [${r.s.cat}]`);
}
