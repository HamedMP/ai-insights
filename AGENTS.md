# AI Insights

AI Insights reads a person's local AI coding-agent history (Claude Code, Codex, Cursor, Pi, OpenCode, Gemini CLI), plus chat history the person imports from a data export (Claude, `ai-insights import claude <path>`), and turns it into insights and actionable tips. It ships as an npm package (`ai-insights`) with a CLI, a stdio MCP server, agent skills, and plugin manifests for each harness. `CLAUDE.md` points here.

## How it works

1. **Sources** (`src/sources/<harness>/`) discover transcripts and parse each into a `Session`: numbers, tool metadata and the person's own prompts. No assistant text, no tool output. Chat exports are the exception to discovery: `ai-insights import` (`src/cli/import.ts`) turns one into sessions under `imports/claude-chat/` in the store, which the `claude-chat` source then reads.
2. **Store** (`src/store/`) caches parsed sessions, facets and reports under `~/.ai-insights/` (`AI_INSIGHTS_HOME` overrides; an existing pre-0.2 `~/.hindsight/` and `HINDSIGHT_HOME` are still used, see `resolveHome`).
3. **Analysis** (`src/analysis/`) turns sessions into a `Report`: activity, token usage and cost, and deterministic `Finding`s with evidence. No model involved.
4. **Model-run pass**: the `analyze-ai-usage` skill has the person's own agent read redacted excerpts through the MCP server, write one `SessionFacet` per session using the fixed taxonomy, then a `Narrative`. AI Insights never calls a model API itself.
5. **Render** (`src/render/`) writes one self-contained HTML report.
6. **MCP + CLI** (`src/mcp/`, `src/cli/`) expose all of it.

`src/schema/types.ts` is the contract every module codes against. Read it first.

## Rules

- **Nothing leaves the machine.** No network calls anywhere in `src/`. No telemetry. The report makes no network requests and loads nothing from the network (its CSP is `default-src 'none'`). It may contain links a person can click: the Matrix OS link, http(s) links to documentation or tools on suggestions and retention, and share links (X, LinkedIn) that open the person's own post with the card caption only when they click them. The one exception to keeping numbers on the machine is the stats share link (`src/render/client/sharelink.js`, decoded by `site/lib/share.ts`): it exists only when the person creates it in the report, and it carries only the v3 payload: aggregate numbers (optional display name, period, sessions, tokens, estimated spend, active days, longest streak, per-agent session share over coding agents only: chat-export harnesses are left out because the site estimates each agent's tokens from that share), one fun-fact line built from counts, the earned titles and the five work ratios as `{k, v}` key-and-number pairs (the site rebuilds the title and rule wording from a table pinned to `src/analysis/recap/titles.ts`), and the recap cards as data (a fixed card key, a headline and a caption, each built in `sharelink.js` from counts, dates, agent names, checked public model-family names and fixed wording; `tests/render/share-link.test.ts` holds the per-card allowlist), in the URL fragment of the site's `/share` page. v3 adds what lets one account publish from several computers: the store's random device id (`src/store/device.ts`, 16 random bytes in `device.json`; never derived from a hostname, username, MAC address or any hardware detail) and an optional typed device name, each ratio's base count `n`, and, unless the person unticks it, `days`: a bitmap of which dates had activity (no counts, no times). v1 and v2 links (and v2 from a report whose store could not make a device id) must keep working on the site; they publish as the account's one `legacy` device. The site keeps one row per (account, device) in `leaderboard_devices` and adds them up in `site/lib/devices.ts`; public pages never receive a device id, a private device name or the day bitmap (`publicDeviceStats`). Never add project names, paths, prompts or other history content to it; a new field is a deliberate payload version change. The public leaderboard and profiles (`site/`, not `src/`) store that same validated payload, and only when the person signs in on the website and presses Publish on their `/share` page; the package never publishes. Leaderboard and profile numbers are self-reported: never describe them as verified. The website (only `site/`) has first-party PostHog analytics through its `/relay` rewrite; it must never send a URL fragment or a referrer handle from `?ref=` (`site/lib/analytics-sanitize.ts`), and the tool and report stay analytics-free. Referrals (`site/lib/referral.ts`) live in a first-party HttpOnly cookie and are credited only on a first publish. Clerk runs only on pages that mount it (`mountsClerk` in `site/lib/auth-config.ts`: /share, /leaderboard, /u, /account). The landing page and the docs stay Clerk-free for anonymous visitors: their HTML and the chunks it loads carry no Clerk host or code (`site/scripts/check-build.mjs`), their CSP names no Clerk host, and Clerk's middleware never runs there. Only a browser with Clerk's signed-in cookie (`site/lib/session-hint.ts`) loads the account menu there, on demand (`site/components/site/session-account.tsx`). A profile photo is stored only when the person opts in (at publish, or with the owner's "Show my photo" switch, `site/lib/photo-route.ts`), read from Clerk on the server, uploaded photos only, and limited to `https://img.clerk.com/`; off is the default.
- **Chat exports are imported, never discovered.** `src/sources/claude-chat/` reads a Claude data export only when the person runs `ai-insights import claude <path>`; a downloads folder is never scanned. It streams the zip or JSON (`zip.ts`, `json-stream.ts`; Node built-ins only) and builds only the keys `CONVERSATION_SPEC` names, so assistant text, thinking, tool inputs and results, attachment text, injected prompt blocks and titles never reach a `Session`, the cache, an excerpt, the report or a share link (`tests/sources/claude-chat/` plants markers in each to prove it). Zips holding account details, login history, memories or projects (`light_metadata`, `memories`, `projects`) are never opened. MCP and connector tool names are user-specific: count them under one label, never by name. Chat harnesses (`CHAT_HARNESSES`, `isChatHarness`) record no model, tokens or cost: show usage as "not measured", never 0 or an estimate, and keep them out of coding findings, work ratios, friction causes, parallel counts and the share link's per-agent split.
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
