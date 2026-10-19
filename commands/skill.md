---
description: Encontra a skill TLC mais adequada para uma tarefa (roteamento local, sem gastar tokens de catálogo)
argument-hint: "<descrição da tarefa>"
allowed-tools: Bash(node:*), Read
---

Run `node "${CLAUDE_PLUGIN_ROOT}/router/route-cli.mjs" "$ARGUMENTS" --top 3`.

If it names a skill, read only that SKILL.md and apply it to the task. If it reports no match, say so in one line and continue without a skill.
