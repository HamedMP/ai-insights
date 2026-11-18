# Quick-view JSON (`schemaVersion` 1)

`ai-insights summary --json` prints today, this week and this month in one object. `ai-insights today --json`, `week --json` and `month --json` print the same object with only their own period. Tray apps, status-bar scripts and other tools read this output, so it is a contract: `src/cli/summary-json.ts` builds it and `tests/cli/quick.test.ts` holds it to the shape below.

**Versioning.** Adding an optional field keeps `schemaVersion` at 1, so readers should ignore fields they do not know. Renaming or removing a field, changing its type or changing what it means is a new `schemaVersion`.

**Privacy.** It holds only aggregates: counts, minutes, tokens, cost, agent and model names, and a tip in fixed wording. It never holds prompts, commands, file paths or project names. The one exception for paths is `reportPath`. Project names appear only under `byProject`, and only when you ask for them with `--by project`. Nothing is written and nothing is sent anywhere: the command reads your history (and its cache) and prints.

**Speed.** It reads only transcripts changed since the start of the earliest period. Parsed sessions are cached, and transcripts that are still being written resume from a checkpoint. A warm run takes a fraction of a second, plus the time to re-read any session that changed.

## Shape

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-18T15:42:00.000Z",   // UTC
  "timezone": "Europe/Helsinki",               // IANA zone the periods are cut in
  "periods": {
    "today": Period,   // local midnight to now
    "week":  Period,   // Monday 00:00 to now
    "month": Period    // the 1st, 00:00, to now
    // "range": Period with --since/--until (today|week|month only)
  },
  "reportPath": "/home/you/.ai-insights/reports/report.html"  // or null before the first report
}
```

`Period`:

| Field | Type | Meaning |
|---|---|---|
| `from`, `to` | string | ISO 8601 local time with offset, e.g. `2026-11-18T00:00:00+02:00`. `to` is now for the current period. |
| `sessions` | integer | Sessions with activity in the period. A session resumed today counts today. |
| `activeMinutes` | integer | Wall-clock minutes in the period with at least one session active. Parallel sessions count once. Gaps over 10 minutes are idle. |
| `prompts` | integer | Your prompts sent in the period. |
| `tokens` | object or null | `{ input, output, cacheRead, cacheWrite, total }`. Null when every session in the period is a chat export, which records no tokens. Never 0 for "unknown". |
| `costUsd` | number or null | Estimate at API list prices, rounded to cents. Not a bill. Null when it was not measured (chat exports only) or when nothing could be priced. An empty period is `0`. |
| `unpricedRequestShare` | number | 0 to 1: the share of requests whose model or tier has no known price. These are left out of `costUsd`, never guessed. |
| `byAgent` | array | `{ agent, label, sessions, costUsd, measured }`, highest cost first. `agent` is a harness id (`claude-code`, `codex`, `claude-chat`, `chatgpt`, ...). `measured` is false for chat exports, which record no tokens or cost: show "not measured" for them. Their `costUsd` is always null. A measured agent with `costUsd: null` had nothing that could be priced. |
| `byModel` | array | `{ model, costUsd, tokens }`, at most 10, highest cost first. |
| `tip` | object or null | `{ id, text }`: one coaching line from the deterministic findings. `id` is the finding kind (`context_resets`, `long_sessions`, ...). `text` is fixed wording that never quotes a command, path or prompt. In `summary` and the single-period views, a period with no tip of its own borrows the next longer period's tip, and the text names that period ("this week"). |
| `byProject` | array, optional | `{ project, sessions, activeMinutes, costUsd }`, folder names only. Present only with `--by project`. |
| `series` | array, optional | `{ from, to, sessions, activeMinutes, prompts, tokens, costUsd }`, one row per day, week or month, oldest first. `tokens` is the total. Present only with `--last n` (n > 1) or `--since`. |

Sums agree with the full report. Requests are de-duplicated and priced exactly as the report does it: a request two sessions share counts once, for the earlier session. So a period's `tokens` and `costUsd` equal the report's daily rows for the same days.

## Examples

```bash
ai-insights summary --json
ai-insights today --json
ai-insights week --json --last 4                     # with series, one row per week
ai-insights month --json --since 2026-10-01 --until 2026-10-31
ai-insights today --json --by project                # adds byProject
```

Run it from a global install (`npm i -g ai-insights`), not `npx`, when a tool calls it every few minutes: `npx` contacts the npm registry each time.
