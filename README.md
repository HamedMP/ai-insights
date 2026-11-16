# AI Insights

**See how you actually work with your AI coding agents, and what to change.** AI Insights reads your local agent history (Claude Code, Codex, OpenCode, Pi, Cursor, Gemini CLI) and turns it into a private report: where your time and tokens go, what keeps going wrong, and specific fixes to try.

[![An AI Insights report](https://raw.githubusercontent.com/hamedmp/ai-insights/main/assets/report.png)](https://hamedmp.github.io/ai-insights/demo/report.html)

[Website](https://hamedmp.github.io/ai-insights/) · [Sample report](https://hamedmp.github.io/ai-insights/demo/report.html) · [npm](https://www.npmjs.com/package/ai-insights)

AI Insights was called Hindsight until v0.2; `@matrix-os/hindsight` is deprecated in favour of `ai-insights`.

Everything runs on your machine. AI Insights makes no network calls and never calls a model API; the judgement part runs in the agent you already use.

**Status:** early (0.2). History is read from **Claude Code, Codex, OpenCode, Pi, Cursor and Gemini CLI**. Cursor's local transcripts hold no token counts, and Gemini CLI support is built from its source format without real history to test against. Skill installs for Cursor, Pi and OpenCode are untested.

## Install

Each install adds the same MCP server (`npx -y ai-insights mcp`) and three skills:
- `analyze-ai-usage` builds the report;
- `ai-insights-coach` turns the findings into edits you review;
- `ai-insights-setup` checks that everything works.

You need Node.js 20 or newer.

**Claude Code**

```
/plugin marketplace add hamedmp/ai-insights
/plugin install ai-insights@ai-insights
```

**Codex**

```
codex plugin marketplace add hamedmp/ai-insights
codex plugin add ai-insights@ai-insights
```

**Cursor** (untested; Cursor history is not read yet): from a clone of this repository, run `scripts/install.sh --harness cursor`. It adds the server to `~/.cursor/mcp.json` and the skills to `~/.cursor/skills`.

**Pi** (untested; Pi history is not read yet): `pi install git:github.com/hamedmp/ai-insights`

**OpenCode** (untested; OpenCode history is not read yet): from a clone, run `scripts/install.sh --harness opencode`.

**Several harnesses at once:** clone this repository and run `scripts/install.sh`. The script:
- finds the harnesses on your machine;
- copies the skills into each one;
- registers the MCP server with each harness's own `mcp add` command.

It needs no root, writes only inside your home folder, and is safe to run again. Add `--dry-run` to see what it would do first.

Then start a new session and ask your agent to **analyze my AI usage** (or run `/analyze-ai-usage`).

**Without an agent:** `npx ai-insights` builds the numbers-only report from the command line. `npx ai-insights doctor` shows which history it found.

## What you get

- **A single HTML report** on your disk, covering:
  - activity over time and by project;
  - tokens and estimated cost at API list prices, saying how much it could not price;
  - wall-clock time kept apart from agent-hours.
- **Findings with evidence**, such as a command that keeps failing, instructions you keep repeating, sessions that end in a context reset, or corrections that come late. Each one is backed by evidence you can check.
- **A narrative from your own agent:** what kinds of work you do, how you drive the agent, what works, what gets in the way, and what to try next.
- **Coaching you approve:** `ai-insights-coach` suggests concrete changes, such as a line for `CLAUDE.md` or `AGENTS.md`, a setting to turn on or a habit to try. It shows each one as a diff and writes nothing without your yes.

## What it reads

| Harness | Where |
| --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` (or under `CLAUDE_CONFIG_DIR`) |
| Codex | `~/.codex/sessions` and `~/.codex/archived_sessions` (or under `CODEX_HOME`) |
| OpenCode | `~/.local/share/opencode/opencode.db` (or `OPENCODE_DB`, `XDG_DATA_HOME`), plus the older `storage/` files. The database needs Node 22.5 or later. |
| Pi | `~/.pi/agent/sessions` (or `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`), and OMP's `~/.omp` sessions and profiles |
| Cursor | `~/.cursor/projects/*/agent-transcripts` (prompts and tool calls; no tokens) |
| Gemini CLI | `~/.gemini/tmp/*/chats` (or under `GEMINI_CLI_HOME`) |

From each transcript, AI Insights keeps:
- numbers: tokens, durations, tool calls, errors and lines changed;
- the prompts you typed, with secrets redacted.

It does not store the agent's replies or tool output. During analysis, your agent reads short, redacted excerpts on demand.

AI Insights writes everything to `~/.ai-insights/` (set `AI_INSIGHTS_HOME` to move it), and only you can read those files. If you used it as Hindsight before 0.2 and have a `~/.hindsight/` folder, it keeps using that folder (and still honours `HINDSIGHT_HOME`), so earlier results carry over; nothing is moved or deleted.

## Privacy

- **Local only.** No network calls, no telemetry, no account. The report is one HTML file that loads nothing from the network.
- **Your agent does the analysis.** AI Insights never calls a model API. The judgement runs in the agent you already use, under your existing account and settings.
- **Redaction.** Before anything is stored or shown, AI Insights redacts common secret formats from prompts, commands and excerpts: API keys, bearer tokens, private keys, `PASSWORD=`-style assignments and email addresses. It also shortens home-folder paths to `~`. Redaction is pattern-based, so it can miss an unusual secret, and the skills tell your agent never to copy one into its notes.

The report links to Matrix OS and to the docs for the tools it suggests; nothing else in it points off your machine.

## How the analysis works

1. **Deterministic.** The scan parses your history into sessions. From those it computes activity, token usage, cost and findings, each with evidence you can check. No model is involved, so the same history always gives the same result.
2. **Run by your agent.** The `analyze-ai-usage` skill has your agent read a redacted excerpt of each session in a sample spread across your history. The agent labels each session with a fixed set of labels covering goal, outcome, friction and what went well, then writes a short narrative. The labels are checked against that set before they are saved, so the charts stay comparable from run to run.

The report combines both layers.

## Matrix OS

AI Insights can only look back as far as your agents keep their transcripts, and Claude Code deletes them after 30 days by default. [Matrix OS](https://matrix-os.com) keeps your agent history long-term and builds memory on top of it, so you can look back further than a month.

## Development

```bash
pnpm install
pnpm check                          # typecheck, tests, generated-file check
pnpm build
node scripts/generate-harness.mjs   # after changing skills/, the version, the icon or the plugin config
```

`skills/` is the only source for the skills. `scripts/generate-harness.mjs` generates every harness manifest, plus the installable plugin in `harness/ai-insights/` that Claude Code and Codex install. CI fails when the generated files are out of date. [AGENTS.md](AGENTS.md) describes the module layout and the rules.

Bugs and ideas go to [GitHub issues](https://github.com/hamedmp/ai-insights/issues).

## License

MIT
