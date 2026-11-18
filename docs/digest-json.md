# The saved digest (`digest.json`, `v` 2)

A small file in the store (`~/.ai-insights/digest.json`, or under `AI_INSIGHTS_HOME`) with counts for the current and the previous day, week and month. It is for readers that must not read history: the session-start reminder (`src/nudge/`), the Claude Code statusline (`src/statusline/`) and the scheduled job's notification (`ai-insights schedule`).

**One module.** `src/nudge/digest.ts` is the only code that reads or writes the file: `readDigest(home)`, `writeDigest(home, digest)` and `digestPeriod(digest, cadence, now)`. It uses Node built-ins only, so the plugin's hook can import it. `src/cli/digest.ts` builds the file (`buildDigest(sessions, { timeZone, now, labels })`) from the same numbers as the quick views (`src/analysis/periods.ts`).

**Who writes it.** Only runs over the whole history: the default `ai-insights` run, `today`, `week`, `month` and `summary`, and `ai-insights schedule run`. Filtered views (`--harness`, `--since`, `--until`, `--last`, `--max-sessions`) leave the file alone. `today`, `week` and `month` also leave a digest under 10 minutes old alone. The file is mode 0600 and replaced atomically (temp file, then rename).

**What it holds.** Counts, a cost estimate and one finding kind per period. It never holds prompts, commands, paths, project names or model names. A reader that shows it where others can see it, such as a lock screen or a menu bar, should leave the cost out unless the person opts in.

```jsonc
{
  "v": 2,
  "writtenAt": "2026-11-13T19:30:00.000Z",     // UTC, when it was written
  "timezone": "Europe/Berlin",                 // the zone the periods are cut in
  "periods": {
    "today":     Period,                       // local midnight to writtenAt
    "week":      Period,                       // Monday 00:00 to writtenAt
    "month":     Period,                       // the 1st, 00:00, to writtenAt
    "yesterday": Period,                       // the whole previous day
    "lastWeek":  Period,                       // the whole previous week, Monday to Sunday
    "lastMonth": Period                        // the whole previous calendar month
  }
}
```

`Period`:

| Field | Type | Meaning |
|---|---|---|
| `from`, `to` | string | Local ISO time with offset, e.g. `2026-11-09T00:00:00+01:00`. For a current period, `to` is the time of writing. For a previous period, it is that period's end, which is the next period's start. |
| `sessions` | integer | Sessions with activity in the period. |
| `activeMinutes` | integer | Wall-clock minutes with at least one session active, parallel sessions counted once. |
| `prompts` | integer | Your prompts sent in the period. |
| `contextResets` | integer | Compactions in coding sessions active in the period. A session's compactions count in every period it was active in. |
| `tokens` | integer or null | Total tokens. Null when not measured (only chat exports). |
| `costUsd` | number or null | Estimate at API list prices, as in the quick-view JSON. Null when not measured or nothing could be priced. |
| `tip` | object or null | `{ id }`: a finding kind matching `^[a-z][a-z0-9_]{0,40}$`, such as `context_resets`. Turn it into words with `tipText(id, scope)` from `src/nudge/tips.ts`, which has fixed wording per kind and takes the period's name ("last week"). |

**Reading it.** `readDigest` returns null for a missing, damaged or other-version file, and never throws. That includes `v: 1`, the rolling-window file `ai-insights schedule` wrote before this version: it reads as missing until the next run rewrites it. A new optional field keeps `v`; any other change is a new `v`. To talk about the period that just ended ("last week"), use `lastWeek`, but only when `week.from` is the start of the current week: then the digest was written after last week ended, so `lastWeek` is whole. Otherwise a digest written during last week holds it as `week`, counted only to `to`, and a reader should say so ("last week (to Wed 18 Nov)"). `digestPeriod` makes this choice. Ignore a digest about older periods rather than show old counts as current.
