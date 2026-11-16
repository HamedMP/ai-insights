---
name: ai-insights-setup
description: Check that AI Insights is installed and working. Confirms the AI Insights MCP server is reachable, runs the doctor command, and explains which agent histories were found on this machine and where. Use when AI Insights tools are missing, a scan finds nothing, or the person asks to set up or troubleshoot AI Insights.
---

# AI Insights setup

Goal: the person knows whether AI Insights works here, which agent histories it can see, and, if something is wrong, the one or two steps that fix it.

## 1. Is the MCP server reachable?

Look for the AI Insights tools (`ai_insights_scan` and friends; your harness may prefix them, for example `mcp__…__ai_insights_scan`). If they are there, call `ai_insights_scan`. A reply with coverage means the server works; go to step 2.

If the tools are missing or the call fails:

- Check Node.js 20 or newer is installed: `node --version`.
- Check the package starts: `npx -y ai-insights --version`.
- Show the person how to register the server for the harness they are using, and run it only if they say yes:
  - Claude Code: `/plugin marketplace add hamedmp/ai-insights` then `/plugin install ai-insights@ai-insights`; or `claude mcp add --scope user ai-insights -- npx -y ai-insights mcp`.
  - Codex: `codex plugin marketplace add hamedmp/ai-insights` then `codex plugin add ai-insights@ai-insights`; or `codex mcp add ai-insights -- npx -y ai-insights mcp`.
  - Cursor: add `"ai-insights": {"command": "npx", "args": ["-y", "ai-insights", "mcp"]}` under `mcpServers` in `~/.cursor/mcp.json`.
  - OpenCode: `opencode mcp add ai-insights -- npx -y ai-insights mcp`.
  - Pi: `pi install git:github.com/hamedmp/ai-insights`.
  - Any of them: `scripts/install.sh` from the AI Insights repository detects installed harnesses and does the above.
- Tell them the harness usually needs a restart or a new session before new MCP tools appear.

## 2. Run doctor

Run `npx -y ai-insights doctor` in the shell. Explain the result in a few lines: for each harness, whether history was found, where, how many sessions, and the date range. Point out anything that limits the report:

- A harness they use but that shows no history: its history may live in a non-default place (for example `CLAUDE_CONFIG_DIR` or `CODEX_HOME` set to another directory).
- A short history window: some agents prune old transcripts. Claude Code deletes them 30 days after they last changed unless `cleanupPeriodDays` is raised in its settings (Desktop and Cowork sessions are kept); Gemini CLI deletes chats after 30 days by default. `ai-insights doctor` shows how long each agent keeps them.
- Parse issues: a count of records AI Insights skipped because the format was unfamiliar. A few are normal; many suggest a newer harness version than AI Insights knows.

## 3. Next step

If everything works, offer to run the **analyze-ai-usage** skill. Remind them that everything runs on this machine: AI Insights reads local files, the analysis happens in their own agent, and nothing is uploaded.
