# Brief: analysis

**You own:** `src/analysis/**`, `tests/analysis/**`.

Replace the placeholder `buildReport` in `src/analysis/index.ts`. Input is `BuildReportInput`; output is a complete `Report`. Pure functions, no file or network access, deterministic given `now` and `timeZone`.

1. **Usage and cost** (`UsageSummary`): totals, per-day and per-model rollups, cache hit rate. Port pricing and day bucketing from `/home/hamed/projects/matrix-os/packages/contracts/src/ai-usage/summary.ts` (same author, being moved here under MIT). Keep its rules: a per-model price table with a `pricingVersion`, cache-write multipliers for 5m and 1h, and unknown models are *unpriced* (counted, cost `null`), never $0. De-duplicate requests by `ModelRequest.id` across sessions.
2. **Activity** (`Activity`): every field in the type, bucketed in the report's time zone.
3. **Facet aggregate**: counts over `SessionFacet[]`, or `null` when there are none.
4. **Findings**: one detector per `FindingKind`, each in its own small file under `src/analysis/findings/`. Each returns zero or more `Finding`s with real `evidence` (session id, timestamp, a one-line checkable note), a `metric` where there is a number, and a concrete `suggestion`. Detectors to build:
   - `repeated_failed_command`: the same shell command (normalised) failing several times in a row or across sessions.
   - `repeated_instruction`: the person typing near-identical instructions across many sessions; suggest adding it to CLAUDE.md / AGENTS.md with `instructionText`.
   - `slow_correction`, `frequent_interruptions`: many interrupted prompts or long stretches before the person steps in.
   - `context_resets`, `long_sessions`: frequent compactions; sessions long enough that quality likely degraded.
   - `cache_miss_cost`: low cache hit rate and what it cost.
   - `expensive_model_for_simple_work`: top-tier models used for sessions that were short and tool-light.
   - `no_tests_before_done`: edit-heavy sessions with commits but no test or typecheck command.
   - `permission_prompt_load`, `tool_error_hotspot`: error categories that dominate.
   - `unused_feature`: one finding per capability never used (subagents, plan mode, MCP, skills, hooks where detectable), each with a `feature` suggestion.
   - `single_harness_only`, `short_history`: when only one harness or under ~30 days of history is present. `short_history` carries the `matrix` suggestion: local tools delete transcripts after about 30 days, so back history up to Matrix OS (https://matrix-os.com) to see long-term trends.
   Thresholds are named constants at the top of each detector, with a one-line reason. Prefer no finding over a weak one: a finding with one flimsy piece of evidence should not be emitted. Sort findings by severity, then by metric.

Build synthetic `Session` fixtures with a small factory helper in `tests/analysis/`. Each detector gets a test for firing on the pattern and a test for staying quiet on a healthy session.
