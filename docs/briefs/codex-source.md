# Brief: Codex source

**You own:** `src/sources/codex/**`, `tests/sources/codex/**`.

Replace the placeholder in `src/sources/codex/index.ts` with a real `Source` for the OpenAI Codex CLI (keep the export name `codexSource`).

- **Roots:** `~/.codex/sessions` and `~/.codex/archived_sessions` (honour `CODEX_HOME`). Files are `YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` and, for most files on this machine, `rollout-….jsonl.zst` (zstd). Support both. Use `node:zlib` zstd when the running Node has it; otherwise fall back (for example to a `zstd` binary if present) or skip the file and count an issue. Legacy `.json` sessions also exist in older installs.
- **Format:** lines are `{timestamp, ordinal, type, payload}`. Types seen: `session_meta`, `turn_context`, `response_item` (payload types `message`, `reasoning`, `function_call`, `function_call_output`, `custom_tool_call`, `custom_tool_call_output`), `event_msg`, `token_usage_record`, `world_state`. Inspect real files to confirm; the format changes between versions.
- **Token usage:** two shapes. Newer `token_usage_record` carries a native response id. Older `event_msg`/`token_count` gives cumulative counters that must be turned into per-request deltas (high-water mark per session; a counter reset is an issue, not negative usage). When both describe the same response, count it once. The reference implementation is `/home/hamed/projects/matrix-os/packages/contracts/src/ai-usage/parser.ts`, `reconcile.ts` and `source.ts` (same author, being moved here under MIT). Port that logic.
- **Prompts:** only what the person typed. Codex injects environment context, instructions and tool output as user-role messages; exclude those.
- **Fill every `Session` field** as well as the data allows: tool calls (shell, `apply_patch`, MCP, web search) with categories and error categories (shell exit codes), lines added/removed and files from `apply_patch` bodies, languages, git commits and pushes, compactions, MCP servers, skills, response times.
- **`excerpt`:** redacted, truncated turns for the model pass, honouring `ExcerptOptions`.
- A SQLite `thread_history_1.sqlite` also exists in `~/.codex`. Do not parse it now, but note in your report what it holds and whether JSONL still looks like the source of truth.

Verify against the real history on this machine (about 555 rollout files): run your source over it, check counts look sane, and spot-check a few sessions by hand. Report totals, the number of issues, and what you could not extract.
