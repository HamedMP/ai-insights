# Hindsight

Look back at how you work with AI coding agents. Hindsight reads your local Claude Code and Codex history and turns it into a private HTML report: where your time and tokens go, what keeps going wrong, and specific changes to try. Cursor, Pi and OpenCode history are planned.

![Hindsight report screenshot](docs/screenshot.png)
<!-- Screenshot placeholder: add docs/screenshot.png once the report renderer has landed. -->

## Install

Every path starts the same MCP server, `npx -y @matrix-os/hindsight mcp`, and adds three skills: `hindsight` (build the report), `hindsight-coach` (turn findings into edits you review) and `hindsight-setup` (check it works). Node.js 20 or newer is needed.

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

**Cursor** (untested): install from this repository; `.cursor-plugin/plugin.json` adds the skills and the MCP server. Or run `scripts/install.sh --harness cursor`.

**Pi** (untested)

```
pi install git:github.com/hamedmp/hindsight
```

**OpenCode** (untested): OpenCode has no plugins, so use the script:

```
scripts/install.sh --harness opencode
```

**Anything else, or several at once**: clone this repository and run `scripts/install.sh`. It finds the harnesses installed on your machine, copies the skills into each one's skills folder, registers the MCP server through each harness's own `mcp add` command, and prints what it did. It needs no root, touches only your home folder, and is safe to re-run. `--dry-run` shows what it would do.

Then open a new session and ask your agent to **run hindsight**. Without an agent, `npx @matrix-os/hindsight` builds the numbers-only report from the command line.

## What it reads

| Harness | Where |
| --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` (or under `CLAUDE_CONFIG_DIR`) |
| Codex | `~/.codex/sessions` and `~/.codex/archived_sessions` (or under `CODEX_HOME`) |

From each transcript Hindsight keeps numbers (tokens, durations, tool calls, errors, lines changed) and the prompts you typed, with secrets redacted. It does not store the agent's replies or tool output. During analysis your agent reads short, redacted excerpts on demand. Everything Hindsight writes goes to `~/.hindsight/` (set `HINDSIGHT_HOME` to move it), with files readable only by you.

## Privacy

- **Local only.** Hindsight makes no network calls and has no telemetry. The report is one HTML file on your disk.
- **Your agent does the analysis.** Hindsight never calls a model API. The judgement part runs in the agent you already use, under your existing account and settings.
- **Redaction.** Common secret formats (API keys, bearer tokens, private keys, `PASSWORD=`-style assignments) are redacted from prompts, commands and excerpts before they are stored or shown. Redaction is pattern-based, so it can miss an unusual secret; the skills tell your agent never to copy one into its notes.

The one outbound thing is a link to Matrix OS at the end of the report.

## How the analysis works

Hindsight works in two layers.

1. **Deterministic.** The scan parses your history into sessions and computes activity, token usage, estimated cost at API list prices, and findings, each backed by evidence you can check: a command that failed six times in a row, instructions you keep repeating, sessions that end in a context reset. No model is involved, and the same history gives the same result.
2. **Model-run.** The `hindsight` skill has your agent read a redacted excerpt of each recent session and label it with a fixed taxonomy: goal, outcome, friction, what went well. It then writes a short narrative from the totals. The labels are validated against the taxonomy before they are saved, so the charts stay comparable from run to run.

The report combines both. `hindsight-coach` then proposes concrete changes, such as a line for your `CLAUDE.md` or `AGENTS.md`, a feature to turn on or a plugin to install, and shows each as a diff that you approve before anything is written.

## Matrix OS

Hindsight can only look back as far as your agents keep their transcripts. Claude Code deletes them after 30 days by default. [Matrix OS](https://matrix-os.com) keeps your agent history long-term and builds memory on top of it, so you can look back further than a month.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
node scripts/generate-harness.mjs   # after changing skills/, the version or the plugin config
```

`skills/` is the one source for the skills. `scripts/generate-harness.mjs` generates every harness manifest and the installable plugin tree in `harness/hindsight/`, which Claude Code and Codex install. CI fails when the generated files are stale. See `AGENTS.md` for the module layout and rules.

## License

MIT
