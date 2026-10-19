---
name: fleet
description: Abre o dashboard 3D do Agent Fleet (lista de projetos com agentes ativos e agentes em 3D). Use quando o usuário pedir para abrir, ver ou iniciar o dashboard de agentes.
argument-hint: "[demo]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(curl:*)
---

Start the Agent Fleet 3D dashboard and give the user its URL in one line.

1. Check whether it is already running: `curl -s http://localhost:4317/api/health`.
2. If that fails, start the server with the Bash tool **in the background** (`run_in_background: true`), because it keeps running:
   `node "${CLAUDE_PLUGIN_ROOT}/server/server.mjs" --open`
   Add `--demo` when the argument is `demo`: $ARGUMENTS
3. Wait a second, run the health check again, then reply only with: `Agent Fleet 3D: http://localhost:4317`.
   If it still fails, show the server's error output.
