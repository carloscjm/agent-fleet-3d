---
name: fleet
description: Abre o dashboard 3D do Agent Fleet (lista de projetos com agentes ativos e agentes em 3D). Use quando o usuário pedir para abrir, ver ou iniciar o dashboard de agentes.
argument-hint: "[demo]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Start the Agent Fleet 3D dashboard and give the user its address in one line.

1. Start the server with the Bash tool **in the background** (`run_in_background: true`), because it keeps running:
   `node "${CLAUDE_PLUGIN_ROOT}/server/server.mjs" --open`
   Add `--demo` when the argument is `demo`: $ARGUMENTS
2. After about two seconds, read the command's output. It prints one line with the address, either `Agent Fleet 3D: http://localhost:<port>` or `Agent Fleet 3D já está rodando: http://localhost:<port>`. The port can differ from 4317 when an older copy is still running.
3. Reply only with: `Agent Fleet 3D: http://localhost:<port>`. If the output shows an error instead (for example, `node` not found), show that error and say that Node.js must be installed from nodejs.org.
