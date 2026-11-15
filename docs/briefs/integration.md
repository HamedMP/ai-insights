# Brief: store, MCP server and CLI

**You own:** `src/store/**`, `src/mcp/**`, `src/cli/**`, `tests/store/**`, `tests/mcp/**`, `tests/cli/**`.

Other workers are implementing the sources, `buildReport` and `renderReport` in parallel; today those are placeholders. Code against the interfaces in `src/schema/types.ts` and `src/sources/index.ts`, and test with fake sources and fake build/render functions passed in by dependency injection, so your tests do not depend on their work.

1. **Store** (`src/store/`): home is `HINDSIGHT_HOME` or `~/.hindsight`. Layout: `sessions/<harness>/<id>.json`, `facets/<harness>/<id>.json`, `narrative.json`, `reports/report.html` plus a timestamped copy, `reports/report.json`. A cached session is reused when its `sourceMtimeMs` matches the file. Writes are atomic (temp file then rename), files are created `0600` and directories `0700`. Validate everything read back from disk and everything written by a caller with Zod schemas for `SessionFacet` and `Narrative` (put the schemas in `src/store/schemas.ts`, derived from the const arrays in the contract so the taxonomy cannot drift). Session ids used in file names must be validated so a hostile id cannot escape the directory.
2. **Scan pipeline** (`src/store/scan.ts` or similar): discover across all sources, parse with bounded concurrency, reuse cache, build `Coverage` per harness (including `found: false` for harnesses with no history), return sessions. Options: `since`, `harness` filter, `maxSessions`.
3. **MCP server** (`src/mcp/server.ts`, stdio, `@modelcontextprotocol/sdk`): tools, all with Zod input schemas and bounded outputs:
   - `hindsight_scan`: run the scan, return coverage and headline numbers.
   - `hindsight_report`: the deterministic report as JSON, with a `sections` argument so the agent can fetch parts (activity, usage, findings) without flooding its context.
   - `hindsight_sessions`: list sessions (id, harness, project, start, duration, counts, whether a facet exists), paginated, filterable to those still missing facets.
   - `hindsight_excerpt`: redacted transcript excerpt for one session.
   - `hindsight_save_facets`: save one or more facets (validated against the fixed taxonomy; reject unknown enum values with a message listing the allowed ones).
   - `hindsight_save_narrative`: save the narrative.
   - `hindsight_render`: build the report with saved facets and narrative, write the HTML, return its path and `file://` URL.
   Tool descriptions are written for an agent deciding what to call next. Errors return a short, safe message, never a stack trace or raw path dump.
4. **CLI** (`src/cli/main.ts`, `#!/usr/bin/env node`, no CLI framework dependency): `hindsight` (scan + render + print the report path and a three-line summary), `hindsight scan`, `hindsight report [--json] [--open] [--since 90d] [--harness codex]`, `hindsight mcp` (start the stdio server), `hindsight doctor` (which harness histories were found and where), `--help`, `--version`. Nothing is written to stdout in `mcp` mode except protocol frames.

Test the MCP server in-process with the SDK's in-memory transport, and the CLI by calling its `run(argv, deps)` function. When the other modules have landed on `main`, the orchestrator will ask you to rebase and do an end-to-end run on this machine's real history.
