import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, apply, listProjects, projectDetail, STALE_MS } from '../shared/fleet-core.mjs';
import { toEvent, summarize } from '../telemetry/emit.mjs';

const proj = { id: 'p1', name: 'shop', root: '/code/shop' };
const base = (e, extra = {}) => ({ t: 1000, e, sid: 'sess-abcd', proj, ...extra });

test('main agent and subagent lifecycle', () => {
  const st = createState();
  apply(st, base('SessionStart'));
  apply(st, base('UserPromptSubmit', { step: 'Prompt: fix checkout' }));
  apply(st, base('PreToolUse', { tool: 'Agent', tuid: 'd1', step: 'Delegando: map modules', delegate: { type: 'Explore', desc: 'map modules' } }));
  apply(st, base('SubagentStart', { aid: 'ag1', at: 'Explore' }));
  apply(st, base('PreToolUse', { aid: 'ag1', at: 'Explore', tool: 'Grep', tuid: 't1', step: 'Grep "pay"' }));

  let d = projectDetail(st, 'p1', 1500);
  const sub = d.agents.find((a) => a.id === 'ag1');
  assert.equal(sub.parent, 'sess-abcd');
  assert.equal(sub.label, 'Explore: map modules');
  assert.equal(sub.status, 'running');
  assert.equal(sub.step, 'Grep "pay"');

  apply(st, base('PostToolUseFailure', { aid: 'ag1', tool: 'Grep', tuid: 't1', err: 'boom', t: 1400 }));
  d = projectDetail(st, 'p1', 1500);
  assert.equal(d.agents.find((a) => a.id === 'ag1').status, 'error');
  assert.equal(d.agents.find((a) => a.id === 'ag1').steps.at(-1).st, 'error');

  apply(st, base('SubagentStop', { aid: 'ag1', at: 'Explore' }));
  apply(st, base('Stop'));
  d = projectDetail(st, 'p1', 1600);
  assert.equal(d.agents.find((a) => a.id === 'sess-abcd').status, 'idle');
  assert.equal(d.agents.find((a) => a.id === 'ag1').status, 'done');
});

test('project list shows live projects and marks stale agents', () => {
  const st = createState();
  apply(st, base('PreToolUse', { tool: 'Bash', tuid: 'x', step: 'npm test' }));
  const list = listProjects(st, 2000);
  assert.equal(list.length, 1);
  assert.equal(list[0].counts.running, 1);
  const later = listProjects(st, 1000 + STALE_MS + 1);
  assert.equal(later[0].counts.stale, 1);
});

test('hook input becomes a compact event', () => {
  const ev = toEvent({ hook_event_name: 'PreToolUse', session_id: 's', cwd: '/tmp', tool_name: 'Read', tool_input: { file_path: '/x/skills-library/quality/seo/SKILL.md' }, tool_use_id: 'u1' });
  assert.equal(ev.skill, 'seo');
  assert.equal(ev.step, 'Lendo skill seo');
  assert.equal(summarize('mcp__github__create_pull_request', {}), 'create_pull_request (github)');
  assert.equal(summarize('Bash', { command: 'npm test', description: 'Run tests' }), 'Run tests');
});
