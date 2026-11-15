---
name: hindsight-setup
description: Check that Hindsight is installed and working. Confirms the Hindsight MCP server is reachable, runs the doctor command, and explains which agent histories were found on this machine and where. Use when Hindsight tools are missing, a scan finds nothing, or the person asks to set up or troubleshoot Hindsight.
---

# Hindsight setup

Goal: the person knows whether Hindsight works here, which agent histories it can see, and, if something is wrong, the one or two steps that fix it.

## 1. Is the MCP server reachable?

Look for the Hindsight tools (`hindsight_scan` and friends; your harness may prefix them, for example `mcp__…__hindsight_scan`). If they are there, call `hindsight_scan`. A reply with coverage means the server works; go to step 2.

If the tools are missing or the call fails:

- Check Node.js 20 or newer is installed: `node --version`.
- Check the package starts: `npx -y @matrix-os/hindsight --version`.
- Show the person how to register the server for the harness they are using, and run it only if they say yes:
  - Claude Code: `/plugin marketplace add hamedmp/hindsight` then `/plugin install hindsight@hindsight`; or `claude mcp add --scope user hindsight -- npx -y @matrix-os/hindsight mcp`.
  - Codex: `codex plugin marketplace add hamedmp/hindsight` then `codex plugin add hindsight@hindsight`; or `codex mcp add hindsight -- npx -y @matrix-os/hindsight mcp`.
  - Cursor: add `"hindsight": {"command": "npx", "args": ["-y", "@matrix-os/hindsight", "mcp"]}` under `mcpServers` in `~/.cursor/mcp.json`.
  - OpenCode: `opencode mcp add hindsight -- npx -y @matrix-os/hindsight mcp`.
  - Pi: `pi install git:github.com/hamedmp/hindsight`.
  - Any of them: `scripts/install.sh` from the Hindsight repository detects installed harnesses and does the above.
- Tell them the harness usually needs a restart or a new session before new MCP tools appear.

## 2. Run doctor

Run `npx -y @matrix-os/hindsight doctor` in the shell. Explain the result in a few lines: for each harness, whether history was found, where, how many sessions, and the date range. Point out anything that limits the report:

- A harness they use but that shows no history: its history may live in a non-default place (for example `CLAUDE_CONFIG_DIR` or `CODEX_HOME` set to another directory).
- A short history window: some agents prune old transcripts. Claude Code deletes them after 30 days unless `cleanupPeriodDays` is raised in its settings.
- Parse issues: a count of records Hindsight skipped because the format was unfamiliar. A few are normal; many suggest a newer harness version than Hindsight knows.

## 3. Next step

If everything works, offer to run the **hindsight** skill. Remind them that everything runs on this machine: Hindsight reads local files, the analysis happens in their own agent, and nothing is uploaded.
