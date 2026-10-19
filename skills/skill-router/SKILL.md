---
name: skill-router
description: Finds the right Tech Leads Club skill (94 bundled, in skills-library/) for a task without loading the catalog. Use when a "Skill router:" hint was not injected but the task looks like it has a dedicated playbook (ADR/RFC, specs, deploys, audits, security, architecture decomposition, GTM, diagrams, CI fixes), or when the user asks which skill to use.
---

# Skill router

The plugin's `UserPromptSubmit` hook already routes most prompts and injects a one-line `Skill router:` hint with the SKILL.md path. Use this skill only when no hint arrived and a playbook would clearly help.

1. Run the local router (pure keyword index, ~1 ms, no model tokens):
   `node "${CLAUDE_PLUGIN_ROOT}/router/route-cli.mjs" "<short task description in English or Portuguese>" --top 3`
   The plugin root is `${CLAUDE_PLUGIN_ROOT}`.
2. Read **only** the SKILL.md it prints. Open that skill's `references/` or `scripts/` files only when a step asks for them.
3. If it reports no match, continue without a skill. Do not browse `skills-library/` manually.
