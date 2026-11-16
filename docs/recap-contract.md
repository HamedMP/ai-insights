# Recap and run-history contract

What the renderer receives for the redesigned report, and where it differs from the prototype's `bundle.json`.
The types are the source of truth: `Recap`, `RunSnapshot`, `RunComparison` and `RenderExtras` in
`src/schema/types.ts`. Every field there has a doc comment.

## How the renderer gets it

```ts
renderReport(report: Report, extras?: RenderExtras): string
```

| Prototype            | Product                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `BUNDLE.recap`       | `report.recap` (absent when there are no sessions)                                        |
| `BUNDLE.analysis`    | `report` itself: `coverage`, `activity`, `usage`, `findings`, `facets`, `narrative`        |
| `BUNDLE.runs`        | `extras.runs`: saved snapshots, oldest first, this run last (one entry on a first run)    |
| prototype run diff   | `extras.comparison`: `compareRuns(runs.at(-2), runs.at(-1))`, absent on a first run        |
| `BUNDLE.meta.sessions` | `report.activity.sessions` (or `report.recap.totals.sessions`)                          |

`extras` is optional. `ai-insights report --json` prints the `Report`, recap included, but no runs.

Mapping for the prototype's private `analysis` object:

- `analysis.activity.hourBy` is `recap.rhythm.harnessPeaks[].hours`.
- `analysis.activity.spans[].active` is `report.activity.sessionSpans[].active` (new: epoch-ms `[start, end]`
  pairs split at idle gaps over 10 minutes, at most 50 per span). `project` there is the full path; take the
  basename for display, as the prototype did.
- `analysis.activity.agentDrivenSessions` is the number of `sessionSpans` with `agentDriven`.
- `analysis.usage.daily[].usd` is `report.usage.daily[].estimatedUsd`; `models[].usd` is `models[].estimatedUsd`.
- Everything else in `analysis` has the same name on `report`.

## `Recap` shape

```
version: 1
generatedAt, timeZone
range { from, to, days }
totals { sessions, prompts, activeDays, wallHours, agentHours, harnesses[{key,sessions}], commits,
         commitShare, compactions, toolCalls, toolsPerPrompt, toolCallsCapped }
rhythm? { hours[24], peakHour, nightShare, earlyShare, verdict{key,label}, quiet{len,start},
          latestNight?, harnessPeaks[{key,peak,prompts,hours[24]}], weekdays[7 x {key,count}] }
daily[{day,sessions,prompts,minutes}]   dailyTruncated
streak { days, start, end }
bigDay? { day, prompts, weekday }
voice { prompts, excludedAgentSessions, excludedWrapped, words[5], openers[3], polite{please,thanks,sorry},
        questionShare, wordsTyped, oneWord, leverage?{words,toolCalls} }
interrupted
slash[5]   slashTotal
connectors[5]   skills[5]                                       (new)
shell { calls, programs[5], tests, testPass?, rmrf, forcePush, sleeps }
parallel { max, overlapEvents, subagents }
longestSession? { activeMinutes, wallMinutes, prompts, toolCalls, harness, compactions, toolCallsCapped }
topProjectShare?
failures { total, calls, rate, categories[{key,label,count}], nemesis[4 x {key,count,runs}] }
models[4 x {key,harness,requests,share}]
usage { tokens, output, requests, usd?, unpriced, cacheHitRate?, novels, usdPerCommit? }
winRate?   facetSessions
persona? { title, time, role, reason }
tips[<=3 x {title,kind,metric{value,unit}|null}]
thinking? { blocks, totalMs?, longestMs?, sessions }              (new)
approvals? { auto?, byPerson?, denied?, guardianReviews?, sessions } (new)
replies? { count, medianSec, fastShare, longestSec }            (new)
```

## Deliberate differences from `bundle.json`

**Absent, not null.** A stat that cannot be computed is left out: `rhythm`, `persona`, `bigDay`,
`rhythm.latestNight`, `voice.leverage`, `shell.testPass`, `longestSession`, `topProjectShare`, `usage.usd`,
`usage.cacheHitRate`, `usage.usdPerCommit`, `winRate`, `thinking`, `approvals`, `replies`. Checks written as
`x ?? 0` or `x != null` keep working. Cards that read `D.rhythm`, `D.persona` or `D.longestSession` without a
guard need one: they are absent when no prompt has a timestamp (for example, only agent-driven sessions).

**Period.** `range.days` is the true span, first to last local day with a session, counted inclusively and never
capped. `daily` keeps the newest 400 days; `dailyTruncated` says when older days were cut. `range` is always
set (never null) because a recap only exists when there is a session.

**Templates and markers.** As in the updated extractor, prompts that open with an XML-style tag are left out of
the voice stats (counted in `voice.excludedWrapped`) but stay in `totals.prompts` and `rhythm`. New: harness
markers for pasted content (`[image]`, `[Image #2]`, `[Pasted text #1 +40 lines]`) are not words, so a prompt
that is only an image no longer counts as a one-word prompt.

**Ties** in `words`, `openers`, `slash`, `programs`, `nemesis`, `connectors` and `skills` break alphabetically
(the prototype kept first-seen order). `rhythm.harnessPeaks` is sorted by prompts, most first.

**Slash commands** use the parsers' new per-invocation counts when a session has them, which include commands
run without leaving a prompt (Claude `local_command` lines). Older cached sessions fall back to prompts that
start with `/`. Codex built-ins `/plan`, `/fork` and `/skills` joined the built-in list.

**Programs.** `sleep` is a public program (the prototype filed `sleep 5` under "your own CLI"). Paths with
backslashes resolve to their last segment.

**Models.** Only known public families keep their name; everything else is "Another model". Router prefixes
(`openrouter/acme/x`) and date suffixes (`-20250929`) are dropped. Gemini, Grok, DeepSeek, Qwen, Kimi, GLM,
Mistral and Llama families were added for the newer sources. `codex-auto-review` is left out of `models` and
`usage.requests`, as before.

**Tips.** `metric` is `{ value, unit }` without `label` (the updated extractor's form). Titles must be one of the
fixed suggestion titles; the filter runs before the top three are taken, so a non-allowlisted title no longer
costs a slot. "Make checks part of done" was missing from the prototype's list and is included.

**`toolCallsCapped`** (on `totals` and `longestSession`) is true when a source dropped calls past its cap
(Codex 10,000, others 20,000): show the count as "10,000+". It comes from the new `Session.toolCallsDropped`,
or for older cached sessions from the count reaching the cap.

**New sections.**
- `connectors`: MCP servers by sessions using them. Decorated names (`linear-server`, `claude_ai_Figma`) match
  the public product; plugin servers and unknown ones are "a custom one".
- `skills`: skills by invocations, public names only, others "a custom one".
- `thinking`: Claude counts assistant records with a thinking block and sums `thinkingDurationMs`; Codex counts
  reasoning items and times them from start to completion. `sessions` says how many sessions reported it
  (sessions cached before parser version Claude 6 / Codex 5 do not, until re-parsed).
- `approvals`: Claude permission decisions (`auto`, `byPerson`, `denied`); Codex `guardianReviews`. A counter is
  absent when no session's harness records it. For default-mode users the auto share will look very different.
- `replies`: the person's reply time to finished turns, from sessions they drove, gaps over 12 h dropped.

**Dropped.** `recap.meta` (`sessionsLoaded`, `sessionsInRange`, `rejected`) is gone: use
`report.activity.sessions` and `report.coverage`.

## `RunSnapshot` shape and differences from `bundle.runs`

```
snapshotVersion: 1
id                 "2026-11-16T17-30-12-530Z"  (file name; was "2026-11-16")
generatedAt, timeZone
versions { report, recap, pricing }
window { from, to, days }
metrics { sessions, prompts, activeDays, wallHours, agentHours, toolCalls, toolErrors, failureRate, tests,
          testPass|null, tokens, usd|null, cacheHitRate|null, maxParallel, compactions, compactionsPerSession,
          commits, medianResponseSec|null, winRate|null, interrupted, streak }
findings[{ id, kind, severity, title, metric|null, hasSuggestion }]
suggestionsShown[]   finding ids whose suggestion the report showed
narrative            boolean
daily?[<=30]         {day, sessions, prompts, minutes}
```

- Runs are real snapshots saved each time a report is rendered (`ai-insights`, `ai-insights report`, the MCP
  render tool), not reconstructed from history. A first run has one entry and no comparison. `report --json`
  saves nothing.
- `id` is a file-name-safe timestamp. Display dates from `generatedAt` (the page's `dshort(prevRun.id)` needs to
  become `dshort(prevRun.generatedAt)`).
- Metrics keep the prototype's keys. Missing values are `null` (not absent) so sparklines can skip them.
  `medianResponseSec` is the recap's reply median with gaps over 12 h dropped (the prototype used the uncapped
  activity median, 247.5 s on the sample history against about 213 s capped).
- A `repeated_instruction` finding's id and title are built from prompt words, so the snapshot stores
  `repeated_instruction:#<hash>` and the title "You keep repeating an instruction". The hash is stable across
  runs. Other ids are `Finding.id`, stable across runs.
- Two runs under 10 minutes apart are one run: the later replaces the earlier. Up to 500 snapshots are kept;
  beyond that, snapshots older than 90 days thin to the newest per week.
- A snapshot is about 4 KB with 30 days of `daily`.

`RunComparison` gives `deltas[{ key, previous, current, delta }]` (delta null when either side is null) and
`resolved`, `stillOpen` and `new` findings, matching the page's "Looks resolved / Still open / New" columns.

## Additions (2026-11-16)

All additive and optional: a renderer that ignores them keeps working. Types in `src/schema/types.ts`.

### Keep your history

`report.retention?: Retention` (absent in tests and older reports):

```
windowDays: 7
atRisk { sessions, bytes, nextDeletion|null }     summed over harnesses
cachedOnly                                         sessions only AI Insights' cache still holds
coversFrom|null                                    earliest session start a recap can still cover
cache { keeps: string[], drops: string[] }         fixed text: what a cached session keeps / loses
harnesses[] {
  harness, policy: "deletes"|"kept"|"unknown", days?, source?: "default"|"settings"|"managed",
  setting? { name, file (home as ~), value|null }, clock?: "modified"|"last-updated",
  basis (one or two sentences), url?, transcripts, bytes, oldestOnDisk|null,
  atRisk? { sessions, bytes, nextDeletion|null }   only for "deletes"
  due?[<=5] { sessionId, eligibleAt }              for citing evidence; never show ids on a card
  exempt? { sessions, reason }                     due by age but kept anyway (Claude Desktop / Cowork)
  cachedOnly, coversFrom|null
}
```

- `nextDeletion` in the past means "the next time the agent starts": both Claude Code and Gemini CLI delete
  at startup.
- Facts per harness (read 2026-11-16): Claude Code deletes a transcript `cleanupPeriodDays` (default 30)
  after it last changed, at startup; sessions started or last continued in Claude Desktop or Cowork are kept at
  any age since v2.1.248 unless `desktopSessionCleanupPeriodDays` or managed settings say otherwise
  (https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically). Gemini CLI deletes a project's
  chats after `general.sessionRetention.maxAge` (documented default 30 days) when it starts in that project.
  Codex, OpenCode and Pi keep sessions until you delete them. Cursor: unknown.

Finding `history_retention` (id `history_retention`) replaces `short_history`, which no detector emits any more
(the kind stays in `FINDING_KINDS` so old reports type-check). Severity: `medium` when sessions are due within 7
days, `low` when a deleting harness is at its default, `info` when history is merely short. Its suggestion has
`title: "Keep your history"` and `steps`:

```
Suggestion.steps?: SuggestionStep[]   { title, action, command?, undo?, url?, instructionText? }
```

1. "Keep Claude Code transcripts longer" (or Gemini CLI): `command` is the line to paste,
   `"cleanupPeriodDays": 365`, `action` names the file, `undo` says how to go back. With managed settings the
   step has no command and says an administrator must change it.
2. "Archive them compactly": packmem, `action` is the agreed packmem wording word for word, `command`
   `npx packmem archive --dry-run`, `url` the packmem docs.
3. "Keep them for good across machines": Matrix OS, `matrix chats import` only.

When `history_retention` fires, `history_disk_usage` keeps its number but has no `suggestion`, so the packmem
pitch shows once. Show the disk card from its `detail`/`metric`.

`recap.history?: { days, firstDay, cachedOnly }` (absent without `retention`): "N days of history kept";
`days` counts calendar days from `firstDay` through the report day, both included (one more than `Coverage.historyDays`).

### Cost the harness recorded

`usage.recorded?: { usd, requests, zeroRequests }` and `usage.recordedByHarness?[]` (`{ harness, usd, requests,
zeroRequests }`): what OpenCode and Pi recorded themselves (`ModelRequest.costUsd`). Not the estimate and never
added to it. A recorded $0 is a subscription or coding plan, not free use: say "recorded $X (N requests
recorded $0, typical of subscriptions)". Not in the recap.

### Coverage

`coverage[].skippedUsageRecords?`: usage counters read but not counted (Codex counter resets with nothing to
explain them). Show apart from `issues`, which now means unreadable lines only.

### Approvals and thinking

- `approvals.autoBlocked?` (session and recap): Codex actions the automatic reviewer blocked or let time out.
  Not the person declining.
- `thinking` now also comes from OpenCode (reasoning parts, timed), Pi (assistant messages with a thinking block,
  no durations) and Gemini CLI (answers with `thoughts`, no durations).

### Marathon card

`recap.longestSession` is now the longest session the person drove. Sessions where most prompts are
script-filled templates (an XML-style wrapper such as Codex `<heartbeat>`) or where other agents sent more
messages than the person are skipped; `longestSession.skippedAutomated?` says how many longer ones were left out.

### Most agents at once

`recap.parallel.lanes?: RecapLanes` (absent when no two sessions overlapped):

```
{ windowMinutes: 360, peakAt, atPeak, lanes[<=20, more only if atPeak needs them] {
    harness, start, end, active[<=20]: [from, to) } }
```

All times are minutes from the window start, rounded to 0.01; no ids, projects or clock times. The lanes with
a stretch where `from <= peakAt < to` are exactly `atPeak`, which equals `parallel.max`. Lanes are ordered by
first stretch; deterministic for the same history.
