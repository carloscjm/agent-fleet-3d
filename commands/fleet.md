---
description: Abre o dashboard 3D do Agent Fleet (lista de projetos ativos e agentes em 3D)
argument-hint: "[demo]"
allowed-tools: Bash(node:*), Bash(curl:*)
---

Start the Agent Fleet 3D dashboard and tell the user its URL in one line.

1. Check whether it is already running: `curl -s http://localhost:4317/api/health`.
2. If it is not running, start it in the background:
   `node "${CLAUDE_PLUGIN_ROOT}/server/server.mjs" --open $ARGUMENTS` (pass `--demo` when the argument is `demo`).
3. Reply with: `Agent Fleet 3D: http://localhost:4317` and nothing else unless the start failed.
