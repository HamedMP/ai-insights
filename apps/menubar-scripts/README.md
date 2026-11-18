# Menu bar scripts

`ai-insights.30m.sh` is a [SwiftBar](https://swiftbar.app) / [xbar](https://xbarapp.com) plugin for macOS: this
week's sessions in the menu bar, today and this month, one tip, and Open full report in its menu. It is the
zero-install alternative to the desktop app in `apps/desktop`.

- **You install it, AI Insights never does.** Copy the file into your SwiftBar or xbar plugin folder and make it
  executable. Delete the file to remove it.
- **Local only.** It runs your installed `ai-insights` CLI (`npm i -g ai-insights`) and Node; never `npx`, so it
  makes no network requests. Each run has a 2-minute limit (5 minutes to write a missing report).
- **Refresh interval** is the `30m` in the file name (`ai-insights.1h.sh` refreshes hourly).
- **Hide cost** with `AI_INSIGHTS_HIDE_COST=1` (xbar shows it as a plugin variable). The menu bar title never
  shows cost.

It reads `ai-insights summary --json` with the same tolerance as the app: missing fields show a dash. Try it
with synthetic numbers: `AI_INSIGHTS_CLI=../desktop/fixtures/fake-cli.mjs ./ai-insights.30m.sh`.
