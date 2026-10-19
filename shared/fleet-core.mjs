// Isomorphic state reducer for agent telemetry events (runs in Node and in the browser).
export const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // project stays listed for 1h after last activity
export const STALE_MS = 15 * 60 * 1000; // agent with no events for 15 min shows as stale
export const SUB_LINGER_MS = 2 * 60 * 1000; // finished generic subagents leave the view after 2 min
const MAX_STEPS = 40;

// ---------------------------------------------------------------------------
// Delivery pipeline: Tech Lead → Engenheiro → QA → DevOps
export const STAGES = [
  { key: 'plan', role: 'tech-lead', label: 'Tech Lead', verb: 'Planeja a execução' },
  { key: 'build', role: 'engineer', label: 'Engenheiro', verb: 'Implementa o plano' },
  { key: 'test', role: 'qa', label: 'QA', verb: 'Testa os critérios' },
  { key: 'ship', role: 'devops', label: 'DevOps', verb: 'Sobe para o git' },
];
const STAGE_PATTERNS = [
  ['plan', /^(tech-?lead|tech_lead|techlead)$/],
  ['build', /^(engineer|engenheiro|developer|dev)$/],
  ['test', /^(qa|tester|quality|quality-assurance)$/],
  ['ship', /^(devops|dev-ops|release|release-manager)$/],
];
/** Maps a subagent type ("agent-fleet-3d:tech-lead", "qa", …) to a pipeline stage key, or null. */
export function stageOf(type) {
  const t = String(type || '').toLowerCase().split(':').pop().trim();
  for (const [key, re] of STAGE_PATTERNS) if (re.test(t)) return key;
  return null;
}
/** Reads the QA verdict from a final message. */
export function verdictOf(text) {
  const s = String(text || '');
  const m = s.match(/VEREDITO:\s*(APROVADO|REPROVADO)/i);
  if (m) return m[1].toUpperCase() === 'APROVADO' ? 'pass' : 'fail';
  if (/\b(REPROVADO|FAILED|FAIL)\b/i.test(s)) return 'fail';
  if (/\b(APROVADO|PASSED|PASS)\b/i.test(s)) return 'pass';
  return null;
}

export function createState() {
  return { projects: new Map(), routes: { total: 0, injected: 0, tokens: 0, bySkill: {} }, version: 0 };
}

function project(state, p) {
  let pr = state.projects.get(p.id);
  if (!pr) {
    pr = { id: p.id, name: p.name, root: p.root, last: 0, agents: new Map() };
    state.projects.set(p.id, pr);
  }
  return pr;
}

function agent(pr, id, init) {
  let a = pr.agents.get(id);
  if (!a) {
    a = {
      id,
      parent: null,
      kind: 'main',
      type: 'main',
      stage: null,
      label: 'Sessão principal',
      status: 'ready',
      step: 'Sessão iniciada',
      tool: null,
      skill: null,
      verdict: null,
      result: null,
      steps: [],
      started: init.t,
      ended: null,
      last: init.t,
      tools: 0,
      errors: 0,
      pending: [],
      ...init.fields,
    };
    pr.agents.set(id, a);
  }
  return a;
}

function pushStep(a, s) {
  a.steps.push(s);
  if (a.steps.length > MAX_STEPS) a.steps.splice(0, a.steps.length - MAX_STEPS);
}

/** Apply one raw hook event. Returns the touched project id (or null). */
export function apply(state, ev) {
  if (!ev || !ev.proj || !ev.sid) return null;
  const pr = project(state, ev.proj);
  pr.last = Math.max(pr.last, ev.t);
  const main = agent(pr, ev.sid, { t: ev.t, fields: { label: `Sessão ${ev.sid.slice(0, 4)}` } });

  let a = main;
  if (ev.aid && ev.aid !== ev.sid) {
    const stage = stageOf(ev.at);
    const st = STAGES.find((s) => s.key === stage);
    a = agent(pr, ev.aid, {
      t: ev.t,
      fields: { parent: ev.sid, kind: 'sub', type: ev.at || 'subagent', stage, label: st ? st.label : ev.at || 'subagent' },
    });
  }
  a.last = Math.max(a.last, ev.t);
  state.version++;

  switch (ev.e) {
    case 'SessionStart':
      a.status = 'ready';
      a.step = ev.source === 'resume' ? 'Sessão retomada' : 'Sessão iniciada';
      break;
    case 'UserPromptSubmit':
      a.status = 'thinking';
      a.step = ev.step || 'Novo prompt';
      pushStep(a, { t: ev.t, tool: 'Prompt', step: a.step, st: 'done' });
      break;
    case 'Route': {
      state.routes.total++;
      if (ev.mode === 'single' || ev.mode === 'shortlist') {
        state.routes.injected++;
        state.routes.tokens += ev.tokens || 0;
        for (const s of ev.skills || []) state.routes.bySkill[s] = (state.routes.bySkill[s] || 0) + 1;
        a.skill = ev.skills?.[0] || a.skill;
        pushStep(a, { t: ev.t, tool: 'Router', step: `Skill → ${(ev.skills || []).join(', ')}`, st: 'done' });
      }
      break;
    }
    case 'PreToolUse':
      a.status = 'running';
      a.step = ev.step || ev.tool;
      a.tool = ev.tool;
      a.tools++;
      if (ev.skill) a.skill = ev.skill;
      if (ev.delegate) a.pending.push(ev.delegate);
      pushStep(a, { t: ev.t, id: ev.tuid, tool: ev.tool, step: a.step, st: 'running' });
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const s = [...a.steps].reverse().find((x) => (ev.tuid ? x.id === ev.tuid : x.st === 'running'));
      const failed = ev.e === 'PostToolUseFailure';
      if (s) {
        s.st = failed ? 'error' : 'done';
        s.dur = ev.t - s.t;
        if (failed) s.err = ev.err;
      }
      if (failed) a.errors++;
      if (a.status !== 'done') a.status = failed ? 'error' : 'thinking';
      if (!a.steps.some((x) => x.st === 'running')) a.tool = null;
      break;
    }
    case 'Notification':
    case 'PermissionRequest':
      a.status = 'waiting';
      a.step = ev.step || 'Aguardando entrada';
      break;
    case 'SubagentStart': {
      // The subagent itself (ev.aid) was created above; label it from the parent's pending delegation.
      const i = main.pending.findIndex((d) => d.type === ev.at);
      const d = i >= 0 ? main.pending.splice(i, 1)[0] : main.pending.shift();
      if (a !== main) {
        a.status = 'thinking';
        a.step = d?.desc ? `Iniciando: ${d.desc}` : 'Iniciando';
        if (d?.desc && !a.stage) a.label = `${a.type}: ${d.desc}`;
        if (d?.desc) a.task = d.desc;
      }
      break;
    }
    case 'SubagentStop':
      a.status = 'done';
      a.ended = ev.t;
      a.step = 'Concluído';
      if (ev.msg) a.result = ev.msg;
      if (a.stage === 'test') a.verdict = ev.verdict || verdictOf(ev.msg);
      if (a.stage === 'test' && a.verdict) a.step = a.verdict === 'pass' ? 'Aprovado' : 'Reprovado';
      for (const s of a.steps) if (s.st === 'running') s.st = 'done';
      a.tool = null;
      break;
    case 'Stop':
      a.status = a.kind === 'main' ? 'idle' : 'done';
      a.step = a.kind === 'main' ? 'Aguardando você' : 'Concluído';
      a.tool = null;
      break;
    case 'SessionEnd':
      for (const x of pr.agents.values()) if (x.id === ev.sid || x.parent === ev.sid) x.status = 'ended';
      break;
    default:
      break;
  }
  return pr.id;
}

export function effectiveStatus(a, now) {
  if (['done', 'ended', 'idle'].includes(a.status)) return a.status;
  return now - a.last > STALE_MS ? 'stale' : a.status;
}

const LIVE = new Set(['running', 'thinking', 'waiting', 'error', 'ready']);

// ---------------------------------------------------------------------------
// Pipeline runs, derived from the stage subagents of each main session.
function runsOf(pr, sid) {
  const subs = [...pr.agents.values()].filter((a) => a.parent === sid && a.stage).sort((x, y) => x.started - y.started);
  const runs = [];
  let cur = null;
  for (const a of subs) {
    const newRun = !cur || (a.stage === 'plan' && cur.pastPlan) || (cur.shipped && a.stage !== 'ship');
    if (newRun) {
      cur = { started: a.started, stages: { plan: [], build: [], test: [], ship: [] }, pastPlan: false, shipped: false };
      runs.push(cur);
    }
    cur.stages[a.stage].push(a);
    if (a.stage !== 'plan') cur.pastPlan = true;
    if (a.stage === 'ship' && a.status === 'done') cur.shipped = true;
  }
  return runs;
}

function summarizeRun(run, now, index) {
  const stages = STAGES.map((def) => {
    const attempts = run.stages[def.key];
    const last = attempts[attempts.length - 1];
    if (!last) return { key: def.key, label: def.label, verb: def.verb, status: 'pending', attempts: 0 };
    const ast = effectiveStatus(last, now);
    let status = LIVE.has(ast) ? 'active' : ast === 'stale' ? 'stale' : 'done';
    if (status === 'done' && def.key === 'test' && last.verdict === 'fail') status = 'failed';
    const first = attempts[0];
    return {
      key: def.key,
      label: def.label,
      verb: def.verb,
      status,
      agentId: last.id,
      agentStatus: ast,
      step: last.step,
      skill: last.skill,
      verdict: last.verdict,
      result: last.result,
      attempts: attempts.length,
      started: first.started,
      ended: status === 'done' || status === 'failed' ? last.ended || last.last : null,
      dur: (status === 'active' ? now : last.ended || last.last) - first.started,
      tools: attempts.reduce((n, a) => n + a.tools, 0),
      errors: attempts.reduce((n, a) => n + a.errors, 0),
      steps: last.steps.slice(-8).map(({ tool, step, st, dur }) => ({ tool, step, st, dur })),
      history: attempts.map((a) => ({ id: a.id, status: effectiveStatus(a, now), verdict: a.verdict })),
    };
  });
  const active = stages.find((s) => s.status === 'active');
  const shipped = stages[3].status === 'done';
  const lastTest = stages[2];
  // QA failed and nobody picked the work back up: the run is blocked waiting for a decision.
  const blocked = !active && !shipped && lastTest.status === 'failed';
  const nextIdx = stages.findIndex((s) => s.status === 'pending');
  return {
    n: index + 1,
    started: run.started,
    stages,
    current: active ? active.key : shipped ? 'complete' : blocked ? 'test' : nextIdx >= 0 ? stages[nextIdx].key : null,
    status: shipped ? 'complete' : active ? 'running' : blocked ? 'blocked' : 'waiting',
    reworks: Math.max(0, stages[1].attempts - 1),
    task: (run.stages.plan[0]?.task || run.stages.build[0]?.task || '').replace(/^(Planejar|Implementar|Planear|Plan):\s*/i, '') || null,
  };
}

function flowsOf(pr, now) {
  const mains = [...pr.agents.values()].filter((a) => a.kind === 'main' && (a.status !== 'ended' || now - a.last < ACTIVE_WINDOW_MS));
  return mains
    .map((m) => {
      const runs = runsOf(pr, m.id);
      const run = runs.length ? summarizeRun(runs[runs.length - 1], now, runs.length - 1) : null;
      const others = [...pr.agents.values()].filter((a) => a.parent === m.id && !a.stage);
      return {
        sid: m.id,
        label: m.label,
        status: effectiveStatus(m, now),
        step: m.step,
        skill: m.skill,
        last: m.last,
        started: m.started,
        runs: runs.length,
        completed: runs.filter((r) => r.shipped).length,
        run,
        others: others.filter((a) => effectiveStatus(a, now) !== 'done' || now - a.last < SUB_LINGER_MS).map((a) => a.id),
      };
    })
    // stable order (oldest session first) so rows don't jump around as activity changes
    .sort((x, y) => (y.run ? 1 : 0) - (x.run ? 1 : 0) || x.started - y.started);
}

export function listProjects(state, now = Date.now(), { includeInactive = false } = {}) {
  const out = [];
  for (const pr of state.projects.values()) {
    const counts = { running: 0, thinking: 0, waiting: 0, error: 0, idle: 0, done: 0, stale: 0, ready: 0, ended: 0 };
    let live = 0;
    for (const a of pr.agents.values()) {
      const st = effectiveStatus(a, now);
      counts[st] = (counts[st] || 0) + 1;
      if (LIVE.has(st)) live++;
    }
    const active = live > 0 || now - pr.last < ACTIVE_WINDOW_MS;
    if (!active && !includeInactive) continue;
    const lead = [...pr.agents.values()].sort((x, y) => y.last - x.last)[0];
    const flow = flowsOf(pr, now).find((f) => f.run);
    const pipe = flow ? { status: flow.run.status, current: flow.run.current, stages: flow.run.stages.map((s) => s.status), reworks: flow.run.reworks } : null;
    out.push({ id: pr.id, name: pr.name, root: pr.root, last: pr.last, total: pr.agents.size, live, counts, active, step: lead?.step || '', pipe });
  }
  return out.sort((x, y) => y.live - x.live || y.last - x.last);
}

export function projectDetail(state, id, now = Date.now()) {
  const pr = state.projects.get(id);
  if (!pr) return null;
  const flows = flowsOf(pr, now);
  const keep = new Set();
  for (const f of flows) {
    keep.add(f.sid);
    for (const o of f.others) keep.add(o);
    if (f.run) for (const s of f.run.stages) for (const h of s.history || []) keep.add(h.id);
  }
  const agents = [...pr.agents.values()]
    .filter((a) => keep.has(a.id) || (a.kind === 'sub' && !a.stage && effectiveStatus(a, now) !== 'done'))
    .map(({ pending, ...a }) => ({ ...a, status: effectiveStatus(a, now), steps: a.steps.slice(-25) }));
  return { id: pr.id, name: pr.name, root: pr.root, last: pr.last, flows, agents };
}

// ---------------------------------------------------------------------------
// Demo generator: sessions running the delivery pipeline, same event shape as the hooks.
const DEMO_PROJECTS = [
  { id: 'demo-checkout', name: 'checkout-api', root: '~/code/checkout-api', tasks: ['Retry com idempotência no pagamento', 'Webhook de estorno', 'Limite de tentativas por cartão'] },
  { id: 'demo-mobile', name: 'mobile-app', root: '~/code/mobile-app', tasks: ['Tela de onboarding com biometria', 'Cache offline do carrinho'] },
  { id: 'demo-data', name: 'data-pipeline', root: '~/code/data-pipeline', tasks: ['Deduplicar eventos de pedido', 'Particionar tabela de vendas'] },
  { id: 'demo-site', name: 'landing-site', root: '~/code/landing-site', tasks: ['Melhorar LCP da home', 'Formulário de contato acessível'] },
];
const STAGE_TOOLS = {
  plan: [
    ['Read', 'Lendo skill tlc-plan'],
    ['Glob', 'Glob src/**/*.ts'],
    ['Grep', 'Grep "processPayment"'],
    ['Read', 'Read src/payments/service.ts'],
    ['Read', 'Read package.json'],
    ['Write', 'Write PLAN.md'],
  ],
  build: [
    ['Read', 'Lendo skill tlc-implement'],
    ['Read', 'Read PLAN.md'],
    ['Edit', 'Edit retry-policy.ts'],
    ['Edit', 'Edit service.ts'],
    ['Write', 'Write retry-policy.spec.ts'],
    ['Bash', 'Rodar testes unitários'],
    ['Bash', 'npm run lint'],
    ['Write', 'Write IMPLEMENTATION.md'],
  ],
  test: [
    ['Read', 'Lendo skill spec-driven-eval'],
    ['Read', 'Read PLAN.md'],
    ['Bash', 'git diff'],
    ['Bash', 'Rodar testes unitários'],
    ['Bash', 'npm run build'],
    ['Write', 'Write QA.md'],
  ],
  ship: [
    ['Bash', 'git status'],
    ['Bash', 'git checkout -b feat/retry-idempotente'],
    ['Bash', 'git add src/payments'],
    ['Bash', 'git commit -m "feat(pagamentos): retry com idempotência"'],
    ['Bash', 'git push -u origin feat/retry-idempotente'],
    ['Bash', 'gh pr create'],
  ],
};
const ORDER = ['plan', 'build', 'test', 'ship'];

export function startDemo(emit, { speed = 1, rand = Math.random } = {}) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const sessions = [];
  let n = 0;
  const t0 = Date.now();
  DEMO_PROJECTS.forEach((p, i) => {
    const count = i === 0 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const sid = Math.floor(rand() * 0xffffffff).toString(16).padStart(8, '0') + i + k;
      const s = { sid, proj: p, task: 0, phase: 'idle', idleUntil: 0, stage: null, failedOnce: false };
      sessions.push(s);
      emit({ t: t0, e: 'SessionStart', sid, proj: p, source: 'startup' });
      // stagger: sessions start at different points of the pipeline
      startTask(s, t0);
      const skip = (i + k) % 4;
      for (let j = 0; j < skip; j++) finishStage(s, t0, true);
    }
  });

  function startTask(s, t) {
    const task = s.proj.tasks[s.task++ % s.proj.tasks.length];
    s.taskName = task;
    s.failedOnce = false;
    emit({ t, e: 'UserPromptSubmit', sid: s.sid, proj: s.proj, step: `Prompt: /agent-fleet-3d:pipeline ${task}` });
    emit({ t, e: 'Route', sid: s.sid, proj: s.proj, mode: 'single', skills: ['tlc-plan'], tokens: 58 });
    startStage(s, 'plan', t);
  }

  function startStage(s, key, t) {
    const role = { plan: 'tech-lead', build: 'engineer', test: 'qa', ship: 'devops' }[key];
    const aid = `a${(n++).toString(36)}${Math.floor(rand() * 1e5).toString(36)}`;
    const at = `agent-fleet-3d:${role}`;
    const tuid = `d${aid}`;
    const desc = { plan: `Planejar: ${s.taskName}`, build: s.failedOnce && s.reworkPending ? 'Retrabalho do QA' : `Implementar: ${s.taskName}`, test: `Testar: ${s.taskName}`, ship: 'Subir para o git' }[key];
    emit({ t, e: 'PreToolUse', sid: s.sid, proj: s.proj, tool: 'Agent', tuid, step: `Delegando: ${desc}`, delegate: { type: at, desc } });
    emit({ t, e: 'SubagentStart', sid: s.sid, proj: s.proj, aid, at });
    s.stage = { key, aid, at, tuid, ticks: 0, target: 5 + Math.floor(rand() * 5), open: null };
    s.phase = key;
    s.reworkPending = false;
  }

  function finishStage(s, t, fast = false) {
    const st = s.stage;
    if (!st) return;
    if (st.open) emit({ t, e: 'PostToolUse', sid: s.sid, proj: s.proj, aid: st.aid, at: st.at, tool: st.open[0], tuid: st.open[2] });
    if (fast) {
      for (const [tool, step] of STAGE_TOOLS[st.key].slice(0, 3)) {
        const tuid = `t${(n++).toString(36)}`;
        emit({ t, e: 'PreToolUse', sid: s.sid, proj: s.proj, aid: st.aid, at: st.at, tool, step, tuid });
        emit({ t, e: 'PostToolUse', sid: s.sid, proj: s.proj, aid: st.aid, at: st.at, tool, tuid });
      }
    }
    let verdict = null;
    let msg = { plan: 'PLAN.md com 4 tarefas', build: 'Testes passando, IMPLEMENTATION.md escrito', ship: 'PR #42 aberto em feat/retry-idempotente' }[st.key];
    if (st.key === 'test') {
      const fail = !s.failedOnce && rand() < 0.45;
      verdict = fail ? 'fail' : 'pass';
      msg = fail ? '2 critérios falharam\nVEREDITO: REPROVADO' : 'Todos os critérios passaram\nVEREDITO: APROVADO';
      if (fail) s.failedOnce = true;
    }
    emit({ t, e: 'SubagentStop', sid: s.sid, proj: s.proj, aid: st.aid, at: st.at, msg, verdict });
    emit({ t, e: 'PostToolUse', sid: s.sid, proj: s.proj, tool: 'Agent', tuid: st.tuid });
    s.stage = null;
    if (st.key === 'test' && verdict === 'fail') {
      s.reworkPending = true;
      return startStage(s, 'build', t);
    }
    const next = ORDER[ORDER.indexOf(st.key) + 1];
    if (next) return startStage(s, next, t);
    emit({ t, e: 'Stop', sid: s.sid, proj: s.proj });
    s.phase = 'idle';
    s.idleUntil = t + (6000 + rand() * 8000) / speed;
  }

  const tick = () => {
    const t = Date.now();
    const s = pick(sessions);
    if (s.phase === 'idle') {
      if (t > s.idleUntil) startTask(s, t);
      return;
    }
    const st = s.stage;
    const base = { t, sid: s.sid, proj: s.proj, aid: st.aid, at: st.at };
    if (st.open) {
      const fail = st.open[0] === 'Bash' && rand() < 0.08;
      emit({ ...base, e: fail ? 'PostToolUseFailure' : 'PostToolUse', tool: st.open[0], tuid: st.open[2], err: 'exit code 1' });
      st.open = null;
      return;
    }
    if (st.ticks >= st.target) return finishStage(s, t);
    const list = STAGE_TOOLS[st.key];
    const [tool, step] = st.ticks < list.length && rand() < 0.7 ? list[st.ticks] : pick(list);
    const tuid = `t${(n++).toString(36)}`;
    st.open = [tool, step, tuid];
    st.ticks++;
    const skill = step.startsWith('Lendo skill ') ? step.slice(12) : undefined;
    emit({ ...base, e: 'PreToolUse', tool, step, tuid, skill });
  };
  const id = setInterval(tick, Math.max(90, 450 / speed));
  return () => clearInterval(id);
}
