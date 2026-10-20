// Demo chat history: realistic transcripts in the same JSONL shape Claude Code writes,
// so the demo exercises the real parser. Deterministic (seeded) for stable screenshots.
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROJECTS = [
  { name: 'checkout-api', root: 'C:\\Users\\carlos\\code\\checkout-api', branch: 'main' },
  { name: 'mobile-app', root: 'C:\\Users\\carlos\\code\\mobile-app', branch: 'develop' },
  { name: 'data-pipeline', root: 'C:\\Users\\carlos\\code\\data-pipeline', branch: 'main' },
  { name: 'landing-site', root: 'C:\\Users\\carlos\\code\\landing-site', branch: 'main' },
  { name: 'whatsapp-gateway', root: 'C:\\Users\\carlos\\code\\whatsapp-gateway', branch: 'main' },
];

// [project index, hours ago, title, kind, prompts]
const CHATS = [
  [4, 0.4, 'Corrigir retry de webhooks do WhatsApp', 'pipeline-rework', ['/agent-fleet-3d:pipeline corrigir o bug WA-214 (leia o card no Jira antes de começar)']],
  [0, 1.5, 'Idempotência no pagamento', 'pipeline', ['/agent-fleet-3d:pipeline retry com idempotência no pagamento']],
  [0, 3, 'Investigar lentidão no /checkout', 'plain', ['o endpoint /checkout está lento em produção, investigue', 'adicione um índice na tabela orders', 'rode os testes de novo']],
  [1, 5, 'Explicar navegação do app', 'explore', ['me explique como a navegação do app funciona', 'onde fica o fluxo de login?']],
  [3, 20, 'Auditoria de acessibilidade', 'plain', ['faça uma auditoria de acessibilidade na landing page', 'corrija os contrastes apontados']],
  [2, 27, 'Deduplicar eventos de pedido', 'pipeline', ['/agent-fleet-3d:pipeline deduplicar eventos de pedido']],
  [4, 30, 'Mapear limites da API da Meta', 'plain', ['quais limites de mensagens por segundo a Cloud API tem?', 'escreva um resumo no docs/limites.md']],
  [1, 52, 'Tela de onboarding com biometria', 'pipeline-rework', ['/agent-fleet-3d:pipeline tela de onboarding com biometria']],
  [0, 70, 'ADR sobre fila de pagamentos', 'plain', ['crie um ADR registrando por que escolhemos SQS para a fila de pagamentos']],
  [2, 96, 'Particionar tabela de vendas', 'explore', ['planeje o particionamento da tabela de vendas', 'gere a migration']],
  [3, 140, 'Melhorar LCP da home', 'pipeline', ['/agent-fleet-3d:pipeline melhorar LCP da home']],
  [4, 300, 'Template de mensagem de cobrança', 'plain', ['crie o template de cobrança e o teste de envio']],
  [0, 500, 'Revisar PR de estornos', 'plain', ['revise esse PR de estornos e faça o code review']],
  [1, 900, 'Atualizar React Native', 'explore', ['atualize o React Native para a versão estável mais recente', 'corrija os erros de build']],
];

const TOOLSETS = {
  read: [
    ['Read', { file_path: 'src/payments/service.ts' }],
    ['Grep', { pattern: 'processPayment' }],
    ['Glob', { pattern: 'src/**/*.ts' }],
    ['Read', { file_path: 'package.json' }],
  ],
  edit: [
    ['Edit', { file_path: 'src/payments/retry-policy.ts' }],
    ['Write', { file_path: 'test/retry-policy.spec.ts' }],
    ['Edit', { file_path: 'src/webhooks/handler.ts' }],
  ],
  exec: [
    ['Bash', { command: 'npm test', description: 'Rodar testes unitários' }],
    ['Bash', { command: 'npm run lint', description: 'npm run lint' }],
    ['Bash', { command: 'git diff', description: 'git diff' }],
  ],
  web: [['WebSearch', { query: 'whatsapp cloud api rate limits' }], ['WebFetch', { url: 'https://developers.facebook.com/docs' }]],
};

const STAGE_TOOLS = {
  'tech-lead': [['Read', { file_path: 'C:\\plugins\\agent-fleet-3d\\skills-library\\development\\tlc-plan\\SKILL.md' }], ['Grep', { pattern: 'retry' }], ['Read', { file_path: 'src/webhooks/handler.ts' }], ['Write', { file_path: '.agent-pipeline/x/PLAN.md' }]],
  engineer: [['Read', { file_path: 'C:\\plugins\\agent-fleet-3d\\skills-library\\development\\tlc-implement\\SKILL.md' }], ['Edit', { file_path: 'src/webhooks/handler.ts' }], ['Write', { file_path: 'test/handler.spec.ts' }], ['Bash', { command: 'npm test', description: 'Rodar testes unitários' }], ['Write', { file_path: '.agent-pipeline/x/IMPLEMENTATION.md' }]],
  qa: [['Read', { file_path: 'C:\\plugins\\agent-fleet-3d\\skills-library\\development\\spec-driven-eval\\SKILL.md' }], ['Bash', { command: 'npm test', description: 'Rodar testes unitários' }], ['Bash', { command: 'git diff', description: 'git diff' }], ['Write', { file_path: '.agent-pipeline/x/QA.md' }]],
  devops: [['Bash', { command: 'git status', description: 'git status' }], ['Bash', { command: 'git checkout -b fix/webhook-retry', description: 'git checkout -b fix/webhook-retry' }], ['Bash', { command: 'git commit', description: 'git commit -m "fix(webhooks): retry com backoff"' }], ['Bash', { command: 'git push', description: 'git push -u origin fix/webhook-retry' }], ['Bash', { command: 'gh pr create', description: 'gh pr create' }]],
};

export function demoTranscripts(now = Date.now(), seed = 7) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  let uid = 0;
  const id = (p) => `${p}_${(uid++).toString(36)}`;
  return CHATS.map(([pi, hoursAgo, title, kind, prompts], ci) => {
    const p = PROJECTS[pi];
    const sid = `demo-${ci.toString().padStart(2, '0')}-${Math.floor(r() * 1e8).toString(16)}`;
    let t = now - hoursAgo * 3600e3;
    const lines = [];
    const subagents = [];
    const common = () => ({ sessionId: sid, cwd: p.root, gitBranch: p.branch, entrypoint: 'claude-desktop', timestamp: new Date(t).toISOString() });
    const tick = (s) => (t += (s + r() * s) * 1000);
    const user = (text) => lines.push({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: text }, ...common() });
    const tool = (name, input, err = false) => {
      const tid = id('toolu');
      lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: tid, name, input }] }, ...common() });
      tick(name === 'Bash' ? 6 : 2);
      lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: err ? 'Error: exit code 1' : 'ok', is_error: err }] }, ...common() });
    };
    const say = (text) => lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, ...common() });
    const agent = (type, desc, result, tools) => {
      const tid = id('toolu');
      const prompt = `${desc}. Pasta: .agent-pipeline/${sid}/`;
      lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: tid, name: 'Agent', input: { subagent_type: type, description: desc, prompt } }] }, ...common() });
      const sub = [{ type: 'user', message: { role: 'user', content: prompt }, sessionId: sid, timestamp: new Date(t).toISOString(), isSidechain: true }];
      for (const [name, input] of tools) {
        const sid2 = id('toolu');
        tick(4);
        sub.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: sid2, name, input }] }, sessionId: sid, timestamp: new Date(t).toISOString(), isSidechain: true });
        tick(3);
        const fail = name === 'Bash' && r() < 0.12;
        sub.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: sid2, content: fail ? 'exit code 1' : 'ok', is_error: fail }] }, sessionId: sid, timestamp: new Date(t).toISOString(), isSidechain: true });
      }
      subagents.push(sub);
      tick(3);
      lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: [{ type: 'text', text: result }] }] }, ...common() });
    };

    lines.push({ type: 'ai-title', aiTitle: title, sessionId: sid });
    for (const [k, prompt] of prompts.entries()) {
      user(prompt);
      tick(3);
      if (kind.startsWith('pipeline') && k === 0) {
        agent('agent-fleet-3d:tech-lead', `Planejar: ${title}`, 'PLAN.md com 4 tarefas e 5 critérios de aceite', STAGE_TOOLS['tech-lead']);
        agent('agent-fleet-3d:engineer', `Implementar: ${title}`, 'Testes passando, IMPLEMENTATION.md escrito', STAGE_TOOLS.engineer);
        if (kind === 'pipeline-rework') {
          agent('agent-fleet-3d:qa', `Testar: ${title}`, '2 critérios falharam: timeout não respeitado\nVEREDITO: REPROVADO', STAGE_TOOLS.qa);
          agent('agent-fleet-3d:engineer', 'Retrabalho do QA', 'Falhas do QA.md corrigidas', STAGE_TOOLS.engineer.slice(1));
        }
        agent('agent-fleet-3d:qa', `Testar: ${title}`, 'Todos os critérios passaram\nVEREDITO: APROVADO', STAGE_TOOLS.qa);
        agent('agent-fleet-3d:devops', 'Subir para o git', `PR #${40 + ci} aberto em fix/${title.toLowerCase().split(' ')[0]}`, STAGE_TOOLS.devops);
        say(`Entregue: ${title}. QA aprovado, PR aberto.`);
        continue;
      }
      if (kind === 'explore' && k === 0) agent('Explore', `Mapear: ${prompt.slice(0, 40)}`, 'Mapa dos módulos escrito', TOOLSETS.read);
      const n = 3 + Math.floor(r() * 7);
      for (let i = 0; i < n; i++) {
        const set = i < 2 ? 'read' : pick(['read', 'edit', 'edit', 'exec', 'web']);
        const [name, input] = pick(TOOLSETS[set]);
        tool(name, input, name === 'Bash' && r() < 0.1);
      }
      say('Pronto. Resumo do que mudou e como testar.');
      tick(30);
    }
    lines.push({ type: 'cost-state', sessionId: sid, totalCostUSD: Math.round((0.2 + r() * 3.5) * 100) / 100 });
    return { lines, subagents };
  });
}
