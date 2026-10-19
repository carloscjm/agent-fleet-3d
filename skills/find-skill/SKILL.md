---
name: find-skill
description: Encontra a skill do Tech Leads Club mais adequada para uma tarefa usando o roteador local, sem carregar o catálogo de 94 skills.
argument-hint: "<descrição da tarefa>"
disable-model-invocation: true
allowed-tools: Bash(node:*), Read
---

Run `node "${CLAUDE_PLUGIN_ROOT}/router/route-cli.mjs" "$ARGUMENTS" --top 3`.

If it names a skill, read only that SKILL.md and apply it to the task. If it reports no match, say so in one line and continue without a skill.
