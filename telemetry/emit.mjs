#!/usr/bin/env node
// Hook handler for agent activity. Runs async (non-blocking) and appends one compact event per hook.
import { basename } from 'node:path';
import { readStdin, appendEvent, projectOf, loadSessions, saveSessions } from './common.mjs';

const clip = (s, n = 70) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export function summarize(tool, input = {}) {
  if (!tool) return '';
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    return `${name || tool} (${server})`;
  }
  switch (tool) {
    case 'Bash':
      return clip(input.description || input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const f = input.file_path || input.notebook_path || '';
      const sk = f.match(/([^/\\]+)[/\\]SKILL\.md$/);
      return sk && tool === 'Read' ? `Lendo skill ${sk[1]}` : `${tool} ${basename(f)}`;
    }
    case 'Grep':
      return `Grep "${clip(input.pattern, 40)}"`;
    case 'Glob':
      return `Glob ${clip(input.pattern, 40)}`;
    case 'WebSearch':
      return `Busca "${clip(input.query, 50)}"`;
    case 'WebFetch':
      try {
        return `Fetch ${new URL(input.url).host}`;
      } catch {
        return 'Fetch';
      }
    case 'Task':
    case 'Agent':
      return `Delegando: ${clip(input.description || input.prompt, 50)}`;
    case 'Skill':
      return `Skill ${input.skill || input.name || ''}`;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Atualizando tarefas';
    default:
      return tool;
  }
}

/** Detects skill usage from tool calls (Skill tool or reading a SKILL.md). */
export function skillOf(tool, input = {}) {
  if (tool === 'Skill') return input.skill || input.name || null;
  const p = input.file_path || '';
  const m = p.match(/([^/\\]+)[/\\]SKILL\.md$/);
  return tool === 'Read' && m ? m[1] : null;
}

export function toEvent(h) {
  const e = h.hook_event_name;
  const ev = {
    t: Date.now(),
    e,
    sid: h.session_id,
    aid: h.agent_id || null,
    at: h.agent_type || null,
    proj: projectOf(h.cwd),
  };
  if (h.tool_name) {
    ev.tool = h.tool_name;
    ev.tuid = h.tool_use_id || null;
    ev.step = summarize(h.tool_name, h.tool_input);
    const sk = skillOf(h.tool_name, h.tool_input);
    if (sk) ev.skill = sk;
    if ((h.tool_name === 'Task' || h.tool_name === 'Agent') && h.tool_input) {
      ev.delegate = { type: h.tool_input.subagent_type || 'general-purpose', desc: clip(h.tool_input.description, 50) };
    }
  }
  if (e === 'UserPromptSubmit') {
    ev.step = process.env.AGENT_FLEET_REDACT_PROMPTS ? 'Novo prompt' : `Prompt: ${clip(h.prompt, 60)}`;
  }
  if (e === 'Notification') ev.step = clip(h.message || 'Aguardando entrada', 60);
  if (e === 'PermissionRequest') ev.step = `Permissão: ${summarize(h.tool_name, h.tool_input)}`;
  if (e === 'SessionStart') ev.source = h.source;
  if (e === 'PostToolUseFailure') ev.err = clip(h.error || h.tool_response?.error || 'failed', 80);
  return ev;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const h = await readStdin();
    appendEvent(toEvent(h));
    // After compaction or /clear the model no longer has earlier skill hints: let the router repeat them.
    if (h.hook_event_name === 'SessionStart' && (h.source === 'compact' || h.source === 'clear')) {
      const s = loadSessions();
      delete s[h.session_id];
      saveSessions(s);
    }
  } catch {
    // never break the user's session
  }
  process.exit(0);
}
