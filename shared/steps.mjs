// Isomorphic helpers that turn a tool call into a short, readable step in Portuguese
// (used by the hooks, the history reader and the dashboard).
export const clip = (s, n = 70) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const base = (p) => String(p || '').split(/[/\\]/).pop();
const skillDir = (p) => (String(p || '').match(/([^/\\]+)[/\\]SKILL\.md$/) || [])[1] || null;

/** What kind of action a tool call is. Drives the 3D icon, the color and the label. */
export function category(tool = '', input = {}) {
  input = input || {};
  if (tool === 'Skill' || (tool === 'Read' && skillDir(input.file_path))) return 'skill';
  if (tool === 'Read' || tool === 'NotebookRead') return 'read';
  if (/^(Grep|Glob|LS|ToolSearch)$/.test(tool)) return 'search';
  if (tool === 'Write') return 'write';
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit';
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'BashOutput' || tool === 'KillShell') return 'exec';
  if (/^Web/.test(tool)) return 'web';
  if (tool === 'Agent' || tool === 'Task') return 'delegate';
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(tool)) return 'task';
  if (tool.startsWith('mcp__')) return 'mcp';
  return 'other';
}

export const KIND_PT = {
  read: 'Leitura de arquivo',
  search: 'Busca no código',
  edit: 'Edição de arquivo',
  write: 'Arquivo novo',
  exec: 'Comando no terminal',
  web: 'Pesquisa na web',
  skill: 'Skill (manual de instruções)',
  task: 'Lista de tarefas',
  mcp: 'Conector externo',
  delegate: 'Agente ajudante',
  other: 'Outra ação',
  error: 'Deu erro',
};

// Friendly names for Claude Code's built-in subagent types.
const AGENT_PT = { Explore: 'Explorador do código', 'general-purpose': 'Agente ajudante', Plan: 'Planejador', 'claude-code-guide': 'Guia do Claude Code', 'statusline-setup': 'Ajuste da barra de status' };
/** "Explorador do código" instead of "Explore", "Code reviewer" instead of "my-plugin:code-reviewer". */
export function agentLabel(type) {
  const t = String(type || '').split(':').pop();
  return AGENT_PT[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/[-_]/g, ' ') : 'Agente ajudante');
}

/** One readable sentence about what the call did, in Portuguese. */
export function summarize(tool, input = {}) {
  if (!tool) return '';
  input = input || {};
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    return `Usou o conector ${server}: ${String(name || '').replace(/_/g, ' ')}`;
  }
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return `Rodou no terminal: ${clip(input.description || input.command, 60)}`;
    case 'BashOutput':
      return 'Conferiu a saída de um comando';
    case 'Read':
    case 'NotebookRead': {
      const sk = skillDir(input.file_path);
      return sk ? `Leu as instruções da skill ${sk}` : `Leu o arquivo ${base(input.file_path || input.notebook_path)}`;
    }
    case 'Write':
      return `Criou o arquivo ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editou o arquivo ${base(input.file_path || input.notebook_path)}`;
    case 'Grep':
      return `Procurou "${clip(input.pattern, 40)}" no código`;
    case 'Glob':
      return `Listou arquivos ${clip(input.pattern, 40)}`;
    case 'LS':
      return `Listou a pasta ${base(input.path)}`;
    case 'WebSearch':
      return `Pesquisou na web: ${clip(input.query, 50)}`;
    case 'WebFetch':
      try {
        return `Abriu a página ${new URL(input.url).host}`;
      } catch {
        return 'Abriu uma página da web';
      }
    case 'Task':
    case 'Agent':
      return `Chamou um agente: ${clip(input.description || input.prompt, 50)}`;
    case 'Skill':
      return `Usou a skill ${input.skill || input.name || ''}`.trim();
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Atualizou a lista de tarefas';
    case 'AskUserQuestion':
      return 'Fez uma pergunta para você';
    default:
      return `Usou ${tool}`;
  }
}

/** Detects skill usage from tool calls (Skill tool or reading a SKILL.md). */
export function skillOf(tool, input = {}) {
  input = input || {};
  if (tool === 'Skill') return input.skill || input.name || null;
  return tool === 'Read' ? skillDir(input.file_path) : null;
}
