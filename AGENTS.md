# AI Insights

AI Insights reads a person's local AI coding-agent history (Claude Code, Codex, later Cursor, Pi, OpenCode) and turns it into insights and actionable tips. It ships as an npm package (`ai-insights`) with a CLI, a stdio MCP server, agent skills, and plugin manifests for each harness. `CLAUDE.md` points here.

## How it works

1. **Sources** (`src/sources/<harness>/`) discover transcripts and parse each into a `Session`: numbers, tool metadata and the person's own prompts. No assistant text, no tool output.
2. **Store** (`src/store/`) caches parsed sessions, facets and reports under `~/.ai-insights/` (`AI_INSIGHTS_HOME` overrides; an existing pre-0.2 `~/.hindsight/` and `HINDSIGHT_HOME` are still used, see `resolveHome`).
3. **Analysis** (`src/analysis/`) turns sessions into a `Report`: activity, token usage and cost, and deterministic `Finding`s with evidence. No model involved.
4. **Model-run pass**: the `analyze-ai-usage` skill has the person's own agent read redacted excerpts through the MCP server, write one `SessionFacet` per session using the fixed taxonomy, then a `Narrative`. AI Insights never calls a model API itself.
5. **Render** (`src/render/`) writes one self-contained HTML report.
6. **MCP + CLI** (`src/mcp/`, `src/cli/`) expose all of it.

`src/schema/types.ts` is the contract every module codes against. Read it first.

## Rules

- **Nothing leaves the machine.** No network calls anywhere in `src/`. No telemetry. The report makes no network requests and loads nothing from the network (its CSP is `default-src 'none'`). It may contain links a person can click: the Matrix OS link, http(s) links to documentation or tools on suggestions and retention, and share links (X, LinkedIn) that open the person's own post with the card caption only when they click them. The one exception to keeping numbers on the machine is the stats share link (`src/render/client/sharelink.js`, decoded by `site/lib/share.ts`): it exists only when the person creates it in the report, and it carries only the v2 payload: aggregate numbers (optional display name, period, sessions, tokens, estimated spend, active days, longest streak, per-agent session share), one fun-fact line built from counts, and the recap cards as data (a fixed card key, a headline and a caption, each built in `sharelink.js` from counts, dates, agent names, checked public model-family names and fixed wording; `tests/render/share-link.test.ts` holds the per-card allowlist), in the URL fragment of the site's `/share` page. v1 links (no cards) must keep working on the site. Never add project names, paths, prompts or other history content to it; a new field is a deliberate payload version change. The public leaderboard and profiles (`site/`, not `src/`) store that same validated payload, and only when the person signs in on the website and presses Publish on their `/share` page; the package never publishes. Leaderboard and profile numbers are self-reported: never describe them as verified. The website (only `site/`) has first-party PostHog analytics through its `/relay` rewrite; it must never send a URL fragment or a referrer handle from `?ref=` (`site/lib/analytics-sanitize.ts`), and the tool and report stay analytics-free. Referrals (`site/lib/referral.ts`) live in a first-party HttpOnly cookie and are credited only on a first publish. Clerk runs only on pages that mount it (`mountsClerk` in `site/lib/auth-config.ts`: /share, /leaderboard, /u); the landing page stays Clerk-free, which `site/scripts/check-build.mjs` enforces. A profile photo is stored only when the person opts in at publish, read from Clerk on the server and limited to `https://img.clerk.com/`.
- **Never store or show secrets.** Run prompt and command text through `redact`/`clean` from `src/sources/shared.ts` before it is stored or returned.
- **Parsers never throw on bad input.** Transcript formats are internal and change between versions. Skip what you do not understand and count it in `issues`. Ignore unknown record types.
- **Bound everything.** Cap files scanned, bytes per file, events, array sizes and string lengths. Stream large files; do not read a 60 MB transcript into one string.
- **Keep changes inside one module where you can.** `src/schema/types.ts` is shared by every module: change it deliberately and say why in the pull request.
- **No new dependencies** beyond `zod` and `@modelcontextprotocol/sdk` without asking. Node built-ins only otherwise. Node 20+ must work; newer APIs (for example `node:zlib` zstd) need a graceful fallback.
- TypeScript strict, ES modules, `.js` import suffixes, Zod 4 (`import { z } from "zod"`).
- **Tests first.** Vitest, in `tests/<module>/`. Name the user outcome each test protects. Fixtures are small, hand-written and synthetic: never copy real transcript content, real paths with usernames, or real prompts into the repo.
- Real history on this machine may be read to learn the format and to sanity-check results. Never commit it, quote it in reports, or paste its content anywhere.
- Comments explain why, not what. No comment narrating the change you made.
- Commit early and often on your branch with Conventional Commits (`feat(sources): parse codex rollouts`). Changes reach `main` through a pull request.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test                 # all tests
pnpm exec vitest run tests/<module>   # one module
pnpm build
```

## Finishing

A change is done when `pnpm check` passes and it is committed. In the pull request say what you built, what you verified and how, and anything you could not do. A known gap stated plainly is worth more than a claim of completeness.
