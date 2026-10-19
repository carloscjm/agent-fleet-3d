#!/usr/bin/env node
// UserPromptSubmit hook: routes the prompt to at most one (or a short list of) skill(s)
// and injects a single factual line. Nothing is printed when no skill fits.
import { route, render, estimateTokens } from './router.mjs';
import { readStdin, appendEvent, projectOf, loadSessions, saveSessions } from '../telemetry/common.mjs';

try {
  const h = await readStdin();
  const prompt = h.prompt || '';
  let d = route(prompt);
  let mode = d.mode;

  if (d.mode !== 'none') {
    const sessions = loadSessions();
    const seen = new Set(sessions[h.session_id]?.ids || []);
    const fresh = d.picks.filter((p) => !seen.has(p.s.id));
    if (fresh.length === 0) mode = 'repeat'; // already in context this session: spend nothing
    else {
      d = { ...d, picks: fresh, mode: fresh.length === 1 ? 'single' : d.mode };
      mode = d.mode;
      sessions[h.session_id] = { ts: Date.now(), ids: [...seen, ...fresh.map((p) => p.s.id)] };
      saveSessions(sessions);
    }
  }

  const text = mode === 'single' || mode === 'shortlist' ? render(d) : '';
  try {
    appendEvent({
      t: Date.now(),
      e: 'Route',
      sid: h.session_id,
      aid: h.agent_id || null,
      proj: projectOf(h.cwd),
      mode,
      skills: (d.picks || []).map((p) => p.s.name),
      top: d.ranked?.[0] ? +d.ranked[0].score.toFixed(2) : 0,
      tokens: estimateTokens(text),
    });
  } catch {}

  if (text) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })
    );
  }
} catch {
  // silent: a routing failure must never block a prompt
}
process.exit(0);
