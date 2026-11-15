# Hindsight

Hindsight reads a person's local AI coding-agent history (Claude Code, Codex, later Cursor, Pi, OpenCode) and turns it into insights and actionable tips. It ships as an npm package (`@matrix-os/hindsight`) with a CLI, a stdio MCP server, agent skills, and plugin manifests for each harness. `CLAUDE.md` points here.

## How it works

1. **Sources** (`src/sources/<harness>/`) discover transcripts and parse each into a `Session`: numbers, tool metadata and the person's own prompts. No assistant text, no tool output.
2. **Store** (`src/store/`) caches parsed sessions, facets and reports under `~/.hindsight/` (`HINDSIGHT_HOME` overrides).
3. **Analysis** (`src/analysis/`) turns sessions into a `Report`: activity, token usage and cost, and deterministic `Finding`s with evidence. No model involved.
4. **Model-run pass**: the insights skill has the person's own agent read redacted excerpts through the MCP server, write one `SessionFacet` per session using the fixed taxonomy, then a `Narrative`. Hindsight never calls a model API itself.
5. **Render** (`src/render/`) writes one self-contained HTML report.
6. **MCP + CLI** (`src/mcp/`, `src/cli/`) expose all of it.

`src/schema/types.ts` is the contract every module codes against. Read it first.

## Rules

- **Nothing leaves the machine.** No network calls anywhere in `src/`. No telemetry. The report loads nothing from the network. It may contain links a person can click: the Matrix OS link, and http(s) links to documentation or tools on suggestions.
- **Never store or show secrets.** Run prompt and command text through `redact`/`clean` from `src/sources/shared.ts` before it is stored or returned.
- **Parsers never throw on bad input.** Transcript formats are internal and change between versions. Skip what you do not understand and count it in `issues`. Ignore unknown record types.
- **Bound everything.** Cap files scanned, bytes per file, events, array sizes and string lengths. Stream large files; do not read a 60 MB transcript into one string.
- **Stay in your module.** Each brief in `docs/briefs/` names the directories you own. Do not edit other modules or `src/schema/types.ts`. If the contract is wrong or missing something, say exactly what in your report instead of working around it.
- **No new dependencies** beyond `zod` and `@modelcontextprotocol/sdk` without asking. Node built-ins only otherwise. Node 20+ must work; newer APIs (for example `node:zlib` zstd) need a graceful fallback.
- TypeScript strict, ES modules, `.js` import suffixes, Zod 4 (`import { z } from "zod"`).
- **Tests first.** Vitest, in `tests/<module>/`. Name the user outcome each test protects. Fixtures are small, hand-written and synthetic: never copy real transcript content, real paths with usernames, or real prompts into the repo.
- Real history on this machine may be read to learn the format and to sanity-check results. Never commit it, quote it in reports, or paste its content anywhere.
- Comments explain why, not what. No comment narrating the change you made.
- Commit early and often on your branch with Conventional Commits (`feat(sources): parse codex rollouts`). Do not push, do not merge, do not touch `main`.
- Do not start other agents.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test                 # all tests
pnpm exec vitest run tests/<module>   # one module
pnpm build
```

## Finishing

Your work is done when `pnpm typecheck` and your module's tests pass and everything is committed. Then report to the orchestrator with the command your brief gives you: what you built, what you verified and how, anything you could not do, and any contract change you need. Report honestly; a known gap stated plainly is worth more than a claim of completeness.
