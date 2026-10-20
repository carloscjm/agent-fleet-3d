// Isomorphic helpers that turn a tool call into a short, readable step (used by hooks and the history reader).
export const clip = (s, n = 70) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const base = (p) => String(p || '').split(/[/\\]/).pop();

export function summarize(tool, input = {}) {
  if (!tool) return '';
  input = input || {};
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    return `${name || tool} (${server})`;
  }
  switch (tool) {
    case 'Bash':
    case 'PowerShell':
      return clip(input.description || input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const f = input.file_path || input.notebook_path || '';
      const sk = f.match(/([^/\\]+)[/\\]SKILL\.md$/);
      return sk && tool === 'Read' ? `Lendo skill ${sk[1]}` : `${tool} ${base(f)}`;
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
  input = input || {};
  if (tool === 'Skill') return input.skill || input.name || null;
  const p = input.file_path || '';
  const m = p.match(/([^/\\]+)[/\\]SKILL\.md$/);
  return tool === 'Read' && m ? m[1] : null;
}

export function category(tool = '') {
  if (/^(Read|Grep|Glob|LS)$/.test(tool)) return 'read';
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit';
  if (tool === 'Bash' || tool === 'PowerShell') return 'exec';
  if (/^Web/.test(tool)) return 'web';
  if (tool === 'Agent' || tool === 'Task') return 'delegate';
  if (tool.startsWith('mcp__')) return 'mcp';
  return 'other';
}
