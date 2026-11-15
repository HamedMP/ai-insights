---
name: hindsight-coach
description: Turn Hindsight findings and suggestions into reviewable changes, such as edits to CLAUDE.md or AGENTS.md, features to enable and plugins to install. Shows every change as a diff and asks before writing anything. Use after a Hindsight report, or when the person asks how to act on their findings.
---

# Hindsight coach

Goal: the person leaves with a small number of concrete changes they reviewed and chose, each traced back to something their history showed. You never apply anything automatically.

## Gather

Call `hindsight_report` for the findings and the narrative. If there are no findings, or the narrative is missing and the person wants the full picture, suggest running the **hindsight** skill first. Rank what you have by severity, then by how much evidence backs it, and pick at most five to propose in this run.

## Propose

For each pick, show:

1. **What we saw**: the finding in one line, with its number (for example, "`pnpm test` failed 6 times in a row across 4 sessions").
2. **The change**: the exact edit, as a unified diff against the real file, or the exact command.
3. **Why it should help**, in one sentence.
4. **How to undo it.**

Then ask whether to apply it. Write only on a clear yes, and only the change they approved. If they say no, or want it changed, adjust or move on without arguing.

By suggestion type:

- `instructions`: an addition to the agent instructions file. Ask which scope fits: the project where the evidence came from (its `CLAUDE.md` or `AGENTS.md`) or their global file (for example `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`). Read the file first. Do not repeat a rule it already has; tighten the existing rule instead. Keep additions to a few lines, written as a rule with its reason.
- `feature`: a harness feature to turn on (plan mode, a hook, a permission allowlist, a setting). Show the settings diff, or the steps if it is a UI toggle, and the link from the suggestion.
- `plugin`: a plugin or MCP server to install. Say what it would fix and give the install command. Do not run it without a yes.
- `model_choice`: a change in which model handles which kind of work. Show the config change if there is one; otherwise describe the habit.
- `habit`: a change in how they work. No file edit; one or two sentences of advice.
- `matrix`: one line, only if it fits: Matrix OS (https://matrix-os.com) keeps agent history long-term.

## Rules

- Never apply a change without showing the diff and getting a yes for that change. A yes to one change is not a yes to the next.
- Touch only the files the person approved. Never write secrets, tokens or personal data into any file.
- Prefer one short, precise rule over a paragraph. Instructions files are read on every turn; every line costs context.
- After writing, show what changed and where.
