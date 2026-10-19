---
name: pipeline
description: Executa uma tarefa pelo pipeline de entrega do Agent Fleet - Tech Lead planeja, Engenheiro implementa, QA testa e DevOps sobe para o git - com retrabalho automático quando o QA reprova. Use quando o usuário pedir para rodar o pipeline ou passar uma tarefa pelo fluxo completo.
argument-hint: "<descrição da tarefa>"
---

Run this task through the four-stage delivery pipeline: $ARGUMENTS

You are the orchestrator. Delegate every stage to its subagent with the Agent tool and keep your own messages short; the stages hand work to each other through files, so do not paste their reports into the next prompt.

## Setup

1. If the task above is empty, ask the user for it and stop.
2. Make a short slug from the task (lowercase, hyphens, up to 40 characters).
3. Create the folder `.agent-pipeline/<slug>/` in the project root. Keep it out of git without changing tracked files: append `.agent-pipeline/` to `.git/info/exclude` if it is not there yet.
4. Tell the user in one line that the pipeline started and that `/agent-fleet-3d:fleet` shows it live.

## Stages

Run the stages strictly in this order, one at a time, and wait for each to finish.

1. **Tech Lead**: subagent `agent-fleet-3d:tech-lead`. Prompt: the task text and the folder path. When it finishes, check that `PLAN.md` exists. If the Tech Lead reports a decision only the user can make, ask the user and stop.
2. **Engenheiro**: subagent `agent-fleet-3d:engineer`. Prompt: the folder path, and "implemente o PLAN.md".
3. **QA**: subagent `agent-fleet-3d:qa`. Prompt: the folder path. Read the last line of `QA.md`.
   - `VEREDITO: APROVADO`: go to DevOps.
   - `VEREDITO: REPROVADO`: run the **Engenheiro** again with the prompt "retrabalho: corrija as falhas do QA.md", then **QA** again. Allow at most 2 rework rounds. If QA still fails after the second round, stop, tell the user what is still failing (from `QA.md`), and do not run DevOps.
4. **DevOps**: subagent `agent-fleet-3d:devops`. Prompt: the folder path. Only after an approved QA.

## Finish

Reply with at most 6 lines: what was delivered, the QA verdict, the number of rework rounds, and the branch, commit and PR link from DevOps.
