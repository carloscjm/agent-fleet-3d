import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranscript, promptText, pipelineOf, filterChats, groupChats, dateGroup } from '../shared/history-core.mjs';
import { demoTranscripts } from '../shared/history-demo.mjs';

const T0 = Date.parse('2026-10-20T12:00:00Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const base = (s) => ({ sessionId: 'sess-1', cwd: '/code/shop', gitBranch: 'feat/x', timestamp: at(s) });

function sampleLines() {
  return [
    { type: 'ai-title', aiTitle: 'Título gerado', sessionId: 'sess-1' },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>ignore</system-reminder>' }, { type: 'text', text: 'conserte o checkout' }] }, origin: { kind: 'human' }, ...base(0) },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Vou olhar.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/code/shop/src/a.ts' } }] }, ...base(1) },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, ...base(2) },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Rodar testes' } }] }, ...base(3) },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'exit 1', is_error: true }] }, ...base(9) },
    { type: 'user', isMeta: true, message: { content: 'Caveat: meta line' }, ...base(10) },
    { type: 'user', message: { role: 'user', content: '<command-name>/agent-fleet-3d:pipeline</command-name><command-args>corrigir bug</command-args>' }, ...base(20) },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'agent-fleet-3d:qa', description: 'Testar', prompt: 'Teste a pasta X' } }] }, ...base(21) },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: 'falhou\nVEREDITO: REPROVADO' }] }] }, ...base(40) },
    { type: 'cost-state', totalCostUSD: 1.25, sessionId: 'sess-1' },
  ];
}

test('prompt detection skips tool results, meta lines and reminders', () => {
  const lines = sampleLines();
  assert.equal(promptText(lines[1]), 'conserte o checkout');
  assert.equal(promptText(lines[3]), null);
  assert.equal(promptText(lines[6]), null);
  assert.equal(promptText(lines[7]), '/agent-fleet-3d:pipeline corrigir bug');
});

test('transcript becomes turns, tools, agents and meta', () => {
  const sub = [
    { type: 'user', message: { content: 'Teste a pasta X' }, timestamp: at(22) },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 's1', name: 'Bash', input: { description: 'npm test' } }] }, timestamp: at(23) },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 's1', content: 'ok' }] }, timestamp: at(30) },
  ];
  const { meta, turns, events } = parseTranscript(sampleLines(), { subagents: [sub] });
  assert.equal(meta.id, 'sess-1');
  assert.equal(meta.title, 'Título gerado');
  assert.equal(meta.branch, 'feat/x');
  assert.equal(meta.prompts, 2);
  assert.equal(meta.tools, 2);
  assert.equal(meta.agents, 1);
  assert.equal(meta.errors, 1);
  assert.equal(meta.cost, 1.25);
  assert.equal(meta.pipeline, true);
  assert.deepEqual(meta.stages, ['test']);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].reply, 'Vou olhar.');
  assert.equal(turns[0].tools[1].err, 'exit 1');
  const qa = turns[1].agents[0];
  assert.equal(qa.verdict, 'fail');
  assert.equal(qa.tools.length, 1, 'subagent transcript matched by prompt');
  assert.ok(events.some((e) => e.e === 'SubagentStop' && e.verdict === 'fail'));
});

test('demo transcripts rebuild a pipeline with rework', () => {
  const t = demoTranscripts(T0)[0];
  const p = parseTranscript(t.lines, { subagents: t.subagents });
  const d = pipelineOf(p.events, p.meta.id, T0 + 3600e3);
  const run = d.flows[0].run;
  assert.equal(run.status, 'complete');
  assert.equal(run.reworks, 1);
  assert.equal(d.flows[0].label, 'Orquestrador');
});

test('chat filter and grouping', () => {
  const chats = demoTranscripts(T0).map((t) => parseTranscript(t.lines).meta);
  assert.ok(filterChats(chats, { q: 'whatsapp' }).length >= 2);
  assert.ok(filterChats(chats, { q: 'acessibilidade' }).length >= 1, 'search ignores accents');
  assert.equal(filterChats(chats, { show: 'pipeline' }).every((c) => c.pipeline), true);
  const byProject = groupChats(chats, 'project', T0);
  assert.equal(new Set(byProject.map((g) => g.key)).size, byProject.length);
  assert.equal(byProject.reduce((n, g) => n + g.chats.length, 0), chats.length);
  assert.equal(dateGroup(T0, T0).label, 'Hoje');
  const byDate = groupChats(chats, 'date', T0);
  assert.equal(byDate[0].label, 'Hoje');
});

test('server index reads every session on disk, cached by mtime', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fleet-hist-'));
  const proj = join(dir, 'projects', '-code-shop');
  mkdirSync(join(proj, 'sess-1', 'subagents'), { recursive: true });
  writeFileSync(join(proj, 'sess-1.jsonl'), sampleLines().map((l) => JSON.stringify(l)).join('\n') + '\n');
  writeFileSync(join(proj, 'sess-1', 'subagents', 'agent-x.jsonl'), JSON.stringify({ type: 'user', message: { content: 'Teste a pasta X' }, timestamp: at(22) }) + '\n');
  writeFileSync(join(proj, 'empty.jsonl'), '');
  process.env.AGENT_FLEET_CLAUDE_DIR = dir;
  process.env.AGENT_FLEET_HOME = join(dir, 'home');
  const { createHistory } = await import('../server/history.mjs');
  const h = createHistory({ cacheFile: join(dir, 'home', 'idx.json') });
  const list = h.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Título gerado');
  const d = h.detail('sess-1');
  assert.equal(d.turns.length, 2);
  assert.equal(d.pipeline.flows[0].run.stages[2].status, 'failed');
});
