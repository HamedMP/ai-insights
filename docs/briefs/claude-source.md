# Brief: Claude Code source

**You own:** `src/sources/claude/**`, `tests/sources/claude/**`.

Replace the placeholder in `src/sources/claude/index.ts` with a real `Source` for Claude Code (keep the export name `claudeSource`).

- **Roots:** `~/.claude/projects` (honour `CLAUDE_CONFIG_DIR`). Transcripts are `<project-dir>/<session-id>.jsonl`. Subagent transcripts may sit in nested directories; decide how to attribute them (fold into the parent session's counts or skip) and say which you chose.
- **Format:** one JSON object per line. Known line `type`s include `user`, `assistant`, `system`, `attachment`, `file-history-snapshot`, `summary`, plus many internal ones; ignore what you do not need. Envelope keys include `uuid`, `parentUuid`, `sessionId`, `cwd`, `gitBranch`, `timestamp`, `isSidechain`, `permissionMode`, `message`. `message.content` is a string or an array of blocks: `text`, `thinking`, `tool_use` (`id`, `name`, `input`), `tool_result` (`tool_use_id`, `is_error`, `content`). `message.usage` has `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `cache_creation.{ephemeral_5m_input_tokens,ephemeral_1h_input_tokens}`. Inspect real files on this machine to confirm; the format is undocumented and changes.
- **De-duplication:** one API response can be written as several assistant lines sharing `message.id`; count its usage once. Request id is `claude:<message.id>`.
- **Prompts:** only what the person typed. Exclude tool results, injected reminders, command output wrappers, hook output and meta lines. Slash commands and skills should land in `features.slashCommands` / `features.skills`.
- **Fill every `Session` field** as well as the data allows: tool calls with categories and error categories, lines added/removed from Edit/Write inputs, files modified, languages, git commits and pushes (from Bash commands), compactions, plan mode, subagents, MCP servers (`mcp__<server>__<tool>`), response times, interruptions.
- **`excerpt`:** redacted, truncated turns for the model pass, honouring `ExcerptOptions`.
- A reference parser for the token-usage part exists at `/home/hamed/projects/matrix-os/packages/contracts/src/ai-usage/parser.ts` and `source.ts` (same author, being moved here under MIT). Reuse its logic where it helps.

Verify against the real history on this machine: run your source over `~/.claude/projects`, check counts look sane, and compare a few sessions with Claude Code's own cache in `~/.claude/usage-data/session-meta/*.json` (fields like `user_message_count`, `tool_counts`, `lines_added`, `input_tokens`). Report how closely you match and explain differences.
