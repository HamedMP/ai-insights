# Hindsight

**See how you actually work with your AI coding agents, and what to change.** Hindsight reads your local Claude Code and Codex history and turns it into a private report: where your time and tokens go, what keeps going wrong, and specific fixes to try.

[![A Hindsight report](https://raw.githubusercontent.com/hamedmp/hindsight/main/assets/report.png)](https://hamedmp.github.io/hindsight/demo/report.html)

[Website](https://hamedmp.github.io/hindsight/) · [Sample report](https://hamedmp.github.io/hindsight/demo/report.html) · [npm](https://www.npmjs.com/package/@matrix-os/hindsight)

Everything runs on your machine. Hindsight makes no network calls and never calls a model API; the judgement part runs in the agent you already use.

**Status:** early (0.1). History is read from **Claude Code and Codex**. Cursor, Pi and OpenCode can run the skills, but their own history is not parsed yet, and those installs are untested.

## Install

Each install adds the same MCP server (`npx -y @matrix-os/hindsight mcp`) and three skills:
- `hindsight` builds the report;
- `hindsight-coach` turns the findings into edits you review;
- `hindsight-setup` checks that everything works.

You need Node.js 20 or newer.

**Claude Code**

```
/plugin marketplace add hamedmp/hindsight
/plugin install hindsight@hindsight
```

**Codex**

```
codex plugin marketplace add hamedmp/hindsight
codex plugin add hindsight@hindsight
```

**Cursor** (untested; Cursor history is not read yet): from a clone of this repository, run `scripts/install.sh --harness cursor`. It adds the server to `~/.cursor/mcp.json` and the skills to `~/.cursor/skills`.

**Pi** (untested; Pi history is not read yet): `pi install git:github.com/hamedmp/hindsight`

**OpenCode** (untested; OpenCode history is not read yet): from a clone, run `scripts/install.sh --harness opencode`.

**Several harnesses at once:** clone this repository and run `scripts/install.sh`. The script:
- finds the harnesses on your machine;
- copies the skills into each one;
- registers the MCP server with each harness's own `mcp add` command.

It needs no root, writes only inside your home folder, and is safe to run again. Add `--dry-run` to see what it would do first.

Then start a new session and ask your agent to **run hindsight**.

**Without an agent:** `npx @matrix-os/hindsight` builds the numbers-only report from the command line. `npx @matrix-os/hindsight doctor` shows which history it found.

## What you get

- **A single HTML report** on your disk, covering:
  - activity over time and by project;
  - tokens and estimated cost at API list prices, saying how much it could not price;
  - wall-clock time kept apart from agent-hours.
- **Findings with evidence**, such as a command that keeps failing, instructions you keep repeating, sessions that end in a context reset, or corrections that come late. Each one is backed by evidence you can check.
- **A narrative from your own agent:** what kinds of work you do, how you drive the agent, what works, what gets in the way, and what to try next.
- **Coaching you approve:** `hindsight-coach` suggests concrete changes, such as a line for `CLAUDE.md` or `AGENTS.md`, a setting to turn on or a habit to try. It shows each one as a diff and writes nothing without your yes.

## What it reads

| Harness | Where |
| --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` (or under `CLAUDE_CONFIG_DIR`) |
| Codex | `~/.codex/sessions` and `~/.codex/archived_sessions` (or under `CODEX_HOME`) |

From each transcript, Hindsight keeps:
- numbers: tokens, durations, tool calls, errors and lines changed;
- the prompts you typed, with secrets redacted.

It does not store the agent's replies or tool output. During analysis, your agent reads short, redacted excerpts on demand.

Hindsight writes everything to `~/.hindsight/` (set `HINDSIGHT_HOME` to move it), and only you can read those files.

## Privacy

- **Local only.** No network calls, no telemetry, no account. The report is one HTML file that loads nothing from the network.
- **Your agent does the analysis.** Hindsight never calls a model API. The judgement runs in the agent you already use, under your existing account and settings.
- **Redaction.** Before anything is stored or shown, Hindsight redacts common secret formats from prompts, commands and excerpts: API keys, bearer tokens, private keys, `PASSWORD=`-style assignments and email addresses. It also shortens home-folder paths to `~`. Redaction is pattern-based, so it can miss an unusual secret, and the skills tell your agent never to copy one into its notes.

The report links to Matrix OS and to the docs for the tools it suggests; nothing else in it points off your machine.

## How the analysis works

1. **Deterministic.** The scan parses your history into sessions. From those it computes activity, token usage, cost and findings, each with evidence you can check. No model is involved, so the same history always gives the same result.
2. **Run by your agent.** The `hindsight` skill has your agent read a redacted excerpt of each session in a sample spread across your history. The agent labels each session with a fixed set of labels covering goal, outcome, friction and what went well, then writes a short narrative. The labels are checked against that set before they are saved, so the charts stay comparable from run to run.

The report combines both layers.

## Matrix OS

Hindsight can only look back as far as your agents keep their transcripts, and Claude Code deletes them after 30 days by default. [Matrix OS](https://matrix-os.com) keeps your agent history long-term and builds memory on top of it, so you can look back further than a month.

## Development

```bash
pnpm install
pnpm check                          # typecheck, tests, generated-file check
pnpm build
node scripts/generate-harness.mjs   # after changing skills/, the version, the icon or the plugin config
```

`skills/` is the only source for the skills. `scripts/generate-harness.mjs` generates every harness manifest, plus the installable plugin in `harness/hindsight/` that Claude Code and Codex install. CI fails when the generated files are out of date. [AGENTS.md](AGENTS.md) describes the module layout and the rules.

Bugs and ideas go to [GitHub issues](https://github.com/hamedmp/hindsight/issues).

## License

MIT
