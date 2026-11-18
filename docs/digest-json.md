# The saved digest (`digest.json`, `schemaVersion` 1)

A few hundred bytes in the store (`~/.ai-insights/digest.json`, or under `AI_INSIGHTS_HOME`) with counts for today, this week and this month. It is for readers that must not read history: the session-start reminder (`src/nudge/`), the Claude Code statusline, and scheduled notifications.

**Who writes it.** Only commands a person runs over their whole history: the default `ai-insights` run, `today`, `week`, `month` and `summary`. Filtered runs (`--harness`, `--since`, `--until`, `--last`, `--max-sessions`) leave it alone. `src/cli/digest.ts` builds it from the same numbers as the quick views (`src/analysis/periods.ts`). The file is mode 0600 and replaced atomically.

**What it holds.** Counts, a cost estimate and one finding kind. It never holds prompts, commands, paths, project names or model names. A reader that shows it where others can see (a lock screen, a menu bar) should leave the cost out unless the person opts in.

```jsonc
{
  "schemaVersion": 1,
  "writtenAt": "2026-11-13T19:30:00.000Z",     // UTC, when the run wrote it
  "timezone": "Europe/Berlin",                 // the zone the periods are cut in
  "periods": {
    "today": Period,                           // local midnight to writtenAt
    "week":  Period,                           // Monday 00:00 to writtenAt
    "month": Period                            // the 1st, 00:00, to writtenAt
  }
}
```

`Period`:

| Field | Type | Meaning |
|---|---|---|
| `from`, `to` | string | Local ISO time with offset, e.g. `2026-11-09T00:00:00+01:00`. `to` is when the run wrote the file, not the end of the period. |
| `sessions` | integer | Sessions with activity in the period. |
| `activeMinutes` | integer | Wall-clock minutes with at least one session active, parallel sessions counted once. |
| `prompts` | integer | Your prompts sent in the period. |
| `contextResets` | integer | Compactions in coding sessions active in the period. A session's compactions count in every period it was active in. |
| `tokens` | integer or null | Total tokens. Null when not measured (only chat exports). |
| `costUsd` | number or null | Estimate at API list prices, as in the quick-view JSON. Null when not measured or nothing could be priced. |
| `tip` | object or null | `{ id }`: a finding kind such as `context_resets`. Turn it into words with `tipText(id, scope)` from `src/nudge/tips.ts`, which has fixed wording per kind and takes the period's name ("this week", "last week"). |

**Reading it.** Check `schemaVersion === 1` and ignore fields you do not know. A new optional field keeps the version; any other change is a new one. Treat a period as current only when its `from` starts the period you mean ("this week"), or as the previous one ("last week") when it starts the one before. In both cases the counts run only to `to`, so say how far they go when `to` is before the period's end, as the reminder does ("last week (to Wed 18 Nov)"). Ignore an older digest rather than present old counts as current. `src/nudge/digest.ts` (`readDigest`, `digestPeriod`) does this with Node built-ins only and can be reused.
