import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { route, render, estimateTokens } from '../router/router.mjs';

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));

test('router picks an accepted skill (or none) for each labeled prompt', () => {
  const misses = [];
  let tokens = 0;
  let inList = 0;
  for (const [prompt, expected] of cases) {
    const d = route(prompt);
    tokens += estimateTokens(render(d));
    const picked = d.mode === 'none' ? [] : d.picks.map((p) => p.s.id);
    if (expected.length === 0 ? picked.length === 0 : picked.some((p) => expected.includes(p))) inList++;
    const ok = expected.length === 0 ? picked.length === 0 : expected.includes(picked[0]);
    if (!ok) misses.push(`${prompt} → [${picked.join(', ')}] expected [${expected.join(', ')}]`);
  }
  const acc = 1 - misses.length / cases.length;
  console.log(`top-1 accuracy ${(acc * 100).toFixed(1)}% (in shortlist ${((inList / cases.length) * 100).toFixed(1)}%) on ${cases.length} prompts; avg ~${Math.round(tokens / cases.length)} tokens injected`);
  if (misses.length) console.log(misses.join('\n'));
  assert.ok(acc >= 0.9, `accuracy ${acc} below 0.9`);
});

test('slash commands and tiny prompts are skipped', () => {
  assert.equal(route('/clear').mode, 'none');
  assert.equal(route('ok').mode, 'none');
});

test('explicit skill name wins', () => {
  const d = route('use tlc-spec-driven to plan the checkout feature');
  assert.equal(d.picks[0].s.id, 'tlc-spec-driven');
});
