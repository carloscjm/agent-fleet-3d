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
  assert.equal(ev.step, 'Leu as instruções da skill seo');
  assert.equal(summarize('mcp__github__create_pull_request', {}), 'Usou o conector github: create pull request');
  assert.equal(summarize('Bash', { command: 'npm test', description: 'Run tests' }), 'Rodou no terminal: Run tests');
});

import { stageOf, verdictOf } from '../shared/fleet-core.mjs';

test('stage mapping and QA verdict parsing', () => {
  assert.equal(stageOf('agent-fleet-3d:tech-lead'), 'plan');
  assert.equal(stageOf('engineer'), 'build');
  assert.equal(stageOf('agent-fleet-3d:qa'), 'test');
  assert.equal(stageOf('agent-fleet-3d:devops'), 'ship');
  assert.equal(stageOf('Explore'), null);
  assert.equal(stageOf('Plan'), null);
  assert.equal(verdictOf('ok\nVEREDITO: REPROVADO'), 'fail');
  assert.equal(verdictOf('VEREDITO: APROVADO'), 'pass');
});

test('pipeline run with QA rework then ship', () => {
  const st = createState();
  let t = 1000;
  const ev = (e, extra = {}) => apply(st, { t: t++, e, sid: 'sess', proj, ...extra });
  const stage = (aid, role, msg) => {
    ev('PreToolUse', { tool: 'Agent', tuid: 'd' + aid, delegate: { type: `agent-fleet-3d:${role}`, desc: 'Planejar: retry' } });
    ev('SubagentStart', { aid, at: `agent-fleet-3d:${role}` });
    ev('PreToolUse', { aid, at: `agent-fleet-3d:${role}`, tool: 'Bash', tuid: 't' + aid, step: 'npm test' });
    ev('PostToolUse', { aid, at: `agent-fleet-3d:${role}`, tool: 'Bash', tuid: 't' + aid });
    if (msg !== undefined) ev('SubagentStop', { aid, at: `agent-fleet-3d:${role}`, msg, verdict: verdictOf(msg) });
  };
  stage('a1', 'tech-lead', 'PLAN.md');
  stage('a2', 'engineer', 'feito');
  stage('a3', 'qa', 'VEREDITO: REPROVADO');
  let run = projectDetail(st, 'p1', t).flows[0].run;
  assert.equal(run.stages[2].status, 'failed');
  assert.equal(run.status, 'blocked');
  stage('a4', 'engineer');
  run = projectDetail(st, 'p1', t).flows[0].run;
  assert.equal(run.current, 'build');
  assert.equal(run.reworks, 1);
  ev('SubagentStop', { aid: 'a4', at: 'agent-fleet-3d:engineer', msg: 'corrigido' });
  stage('a5', 'qa', 'VEREDITO: APROVADO');
  stage('a6', 'devops', 'PR aberto');
  run = projectDetail(st, 'p1', t).flows[0].run;
  assert.equal(run.status, 'complete');
  assert.deepEqual(run.stages.map((s) => s.status), ['done', 'done', 'done', 'done']);
  assert.equal(run.stages[2].attempts, 2);
  assert.equal(run.task, 'retry');
  // a new Tech Lead after shipping starts run #2
  stage('a7', 'tech-lead');
  const flow = projectDetail(st, 'p1', t).flows[0];
  assert.equal(flow.runs, 2);
  assert.equal(flow.run.current, 'plan');
  assert.equal(listProjects(st, t)[0].pipe.stages[0], 'active');
});
