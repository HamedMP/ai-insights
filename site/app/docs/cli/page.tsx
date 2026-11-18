import { DocShell } from "@/components/docs/doc-shell"
import { Code, DocLink, H2, H3, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("cli")

export default function Cli() {
  return (
    <DocShell slug="cli">
      <p>
        The package installs two commands, <code>ai-insights</code> and <code>hindsight</code>, which run the same program. With{" "}
        <code>npx</code> you do not need to install anything: <code>npx ai-insights@latest &lt;command&gt;</code>.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights [options]          scan, write the report, print a summary
ai-insights scan [options]     scan and show what was found
ai-insights report [options]   write the report (or print JSON with --json)
ai-insights today|week|month   a quick look: sessions, time, tokens, cost and one tip
ai-insights summary            today, this week and this month side by side
ai-insights doctor             show which histories were found and where
ai-insights share [options]    print your stats share link, to open and publish from any device
ai-insights serve [--port <n>] show the last report to your computer through an SSH tunnel
ai-insights mcp                start the MCP server on stdio (for your agent)
ai-insights import claude <path>  add a Claude chat export
ai-insights import openai <path>  add a ChatGPT data export
ai-insights install            add the plugin to your agents
ai-insights uninstall          remove it again (and a schedule, if you added one)
ai-insights schedule weekly    refresh the report on a schedule, with a notification
ai-insights nudge              print a line when a monthly review is due`}</Code>

      <H2 id="commands">Commands</H2>
      <H3 id="cmd-run">ai-insights</H3>
      <p>
        With no command, AI Insights scans, writes the report and shows the numbers, your persona, the top finding, the report path as a link,
        numbered next steps and a history warning when one applies. Piped or redirected, it prints the same as plain text with no escape codes,
        so scripts can read it. See <DocLink href="/docs/getting-started#first-run">Your first run</DocLink> for both.
      </p>
      <p>
        On a terminal it draws its mark first, then one status line on stderr while it works (finding history, reading sessions, analysing,
        writing the report), ending with a check mark and the time taken. Piped, in CI or on a dumb terminal there is no status line.
      </p>
      <p>
        While it works, the first numbers show up within about a second, above the status line. Each agent&apos;s sessions and cost this month
        appear as soon as its history is read, then today, this week and this month. They come from a quick pass over usage alone and match
        the report and <a href="#cmd-quick">ai-insights month</a> to the cent. They are off when piped or in CI, where
        an agent or a log would only collect extra lines; <code>AI_INSIGHTS_LIVE=1</code> turns them on there, as plain lines on stderr, so
        stdout stays what scripts read. <code>AI_INSIGHTS_LIVE=0</code> turns them off on a terminal too.
      </p>
      <p>
        At the end it asks <code>Open the report in your browser? [Y/n]</code>: Enter or <code>y</code> opens it, <code>n</code> does not, and
        Ctrl-C exits. It asks only when you are at a terminal: never when stdin or stdout is piped, in CI (<code>CI</code> set), or over SSH
        without a forwarded display, and never for <code>scan</code>, <code>report</code>, <code>doctor</code> or <code>mcp</code>. So an agent or
        a script running it never waits on the question. <code>--open</code>, <code>--no-open</code> and <code>AI_INSIGHTS_OPEN</code> skip it.
      </p>
      <p>
        After that, when Claude Code or Codex is on your machine without the AI Insights plugin, it asks once whether to add it. See{" "}
        <a href="#cmd-install">ai-insights install</a> for what that runs. The same rules decide whether it asks, and a no is remembered for 30
        days, or until a newer minor version runs. <code>--no-install-prompt</code> and <code>AI_INSIGHTS_NO_INSTALL_PROMPT=1</code> turn it off.
      </p>
      <Code label="Output, after the report" copy={false}>{`Add AI Insights to Claude Code and Codex? It installs the ai-insights plugin:
the MCP server, three skills (analyze-ai-usage, ai-insights-coach,
ai-insights-setup) and a once-a-month reminder when a review is due.
Codex runs the reminder only after you approve it in /hooks.
Each review saves your sessions' stats and prompts in ~/.ai-insights,
so they outlast agents that delete old transcripts.
Install it now? [Y/n]`}</Code>
      <H3 id="cmd-scan">ai-insights scan</H3>
      <p>Scans and prints what was found, without writing a report. Output from a synthetic history:</p>
      <Code label="Output, from a synthetic history" copy={false}>{`History found
  Claude Code  12 sessions    2026-11-05 to 2026-11-16  58.4 KB
  Codex        not found
  Cursor       not found
  Pi           not found
  OpenCode     not found
  Gemini CLI   not found

12 sessions, 36 prompts, 2.2 agent-hours, 1.6M tokens.
2.2 active hours (2.2 agent-hours across parallel sessions); about $1.13 at API list prices.
Parsed 0, reused 12 from cache.`}</Code>
      <p>
        A found agent with unreadable lines or skipped usage records says how many after its size. The last line shows how many transcripts were
        parsed, how many came from the cache, and how many could not be read.
      </p>
      <H3 id="cmd-report">ai-insights report</H3>
      <p>
        Writes the report and prints only its path. With <code>--json</code> it writes nothing and prints the whole report as JSON instead: version,
        time zone, range, coverage, activity, usage, findings, facets, narrative, recap, retention, the causes of friction and the ratios.
      </p>
      <Code label="Terminal">{`npx ai-insights@latest report --json > report.json`}</Code>
      <H3 id="cmd-quick">ai-insights today, week, month and summary</H3>
      <p>
        A quick look that writes no report, so it is cheap to run often. It reads only the transcripts changed since the start of the period, reuses
        the cache, and reads a session that is still being written from where the last run stopped. <code>today</code> runs from local midnight,{" "}
        <code>week</code> from Monday and <code>month</code> from the 1st, all up to now in your time zone. <code>summary</code> shows all three side by
        side.
      </p>
      <p>
        One coaching tip comes first, drawn from the same findings as the report. When the period has none of its own, it borrows the longer
        period&apos;s tip and says so (&quot;this week&quot;). After the tip come sessions, active time (wall-clock, parallel sessions counted once), prompts,
        tokens and the cost estimate at API list prices, then a breakdown by agent and the top models. Chat exports record no tokens, so they show as{" "}
        <em>not measured</em>, never 0 or an estimate. Requests with no known price show as unpriced. <code>--no-cost</code> leaves the cost out.
        Piped, the same is printed as plain text.
      </p>
      <Code label="Output, from a synthetic history" copy={false}>{`  Today  Wed 18 Nov, so far · Europe/Helsinki

  * Tip  Sessions ran out of context this week. Hand off instead of
    compacting.

  3 sessions - 1.4 h active - 14 prompts
  2.7M tokens - $3.13 at API list prices

  Agent        Sessions   Cost
  Claude Code         2  $1.81
  Codex               1  $1.32

  Models  claude-opus-4-8 $1.49, gpt-5.5 $1.32, claude-sonnet-4-6 $0.33

  Run ai-insights for the full report.`}</Code>
      <Code label="Output, from a synthetic history" copy={false}>{`  AI Insights  Europe/Helsinki

  * Tip  Sessions ran out of context this week. Hand off instead of
    compacting.

            Today  This week  This month
  Sessions      3          6           7
  Active    1.4 h      4.4 h       7.3 h
  Prompts      14         29          41
  Tokens     2.7M       5.3M        7.3M
  Cost      $3.13      $6.27       $8.74

  Cost is an estimate at API list prices.`}</Code>
      <p>
        <code>--last &lt;n&gt;</code> covers the last n days, weeks or months, with one row each. <code>--since</code> and{" "}
        <code>--until</code> take days (<code>2026-11-01</code>), both included. <code>--by project</code>, <code>--by model</code> or{" "}
        <code>--by agent</code> (the default) picks the breakdown. Project names appear only on your terminal, and only when you ask for them.
      </p>
      <Code label="Terminal">{`npx ai-insights@latest today
npx ai-insights@latest week --last 4 --by model
npx ai-insights@latest month --since 2026-10-01 --until 2026-10-31
npx ai-insights@latest summary --json`}</Code>
      <H3 id="cmd-doctor">ai-insights doctor</H3>
      <p>
        Shows the version and Node version, then for each agent: how many transcripts it found and their dates, how long the agent keeps them,
        and every location it checked, marked found or missing. It ends with the store: its path, whether it is writable, how many sessions are
        cached and labels saved, whether a narrative is saved, and when the last report was written. Abridged output from a synthetic history:
      </p>
      <Code label="Output, from a synthetic history; home folder shortened to ~; abridged" copy={false}>{`ai-insights 0.4.0 on Node 24.22.0

Claude Code: 12 transcripts (58.4 KB), 2026-11-05 to 2026-11-16
  keeps   transcripts 30 days (the default; cleanupPeriodDays in ~/.claude/settings.json)
  found   ~/.claude/projects
  missing ~/.config/claude/projects
  missing ~/.config/Claude/local-agent-mode-sessions
  missing ~/.config/Claude/claude-code-sessions
Codex: no history found
  missing ~/.codex/sessions
  missing ~/.codex/archived_sessions
…

Store: ~/.ai-insights
  writable
  0 cached sessions, 0 saved facets, narrative not saved yet
  last report: none yet`}</Code>
      <H3 id="cmd-share">ai-insights share</H3>
      <p>
        Writes the report as <code>report</code> does, then prints the stats share link that the report&apos;s{" "}
        <strong>Publish to the leaderboard</strong> button makes: the same link, byte for byte, built by the same code from the same numbers.
        Before the link it lists every line the link holds, the same list the report shows under &quot;See exactly what&apos;s in the
        link&quot;. It contacts nothing: it only prints text. Open the link on any device to see your card on the site; nothing is published
        until you sign in there and press Publish. See <DocLink href="/docs/sharing">Sharing</DocLink> for what the link carries.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights share [--name <name>] [--device <name>] [--no-days] [--copy]`}</Code>
      <p>
        <code>--name</code> is the display name on your card (none by default: the card says &quot;Someone&quot;), <code>--device</code> names
        this computer for publishing from several, and <code>--no-days</code> leaves out which days you were active, like unticking the box in
        the report. The link is printed alone on its line and also saved to <code>share-link.txt</code> in the store, since terminals wrap long
        lines. <code>--copy</code> also asks the terminal to put it on your clipboard (OSC 52; many terminals allow it, tmux only with{" "}
        <code>set-clipboard on</code>). <code>--since</code> and <code>--harness</code> work as for the report.
      </p>
      <Code label="Output, from a synthetic history; home folder shortened to ~; cards and link abridged" copy={false}>{`Your stats share link. It holds exactly these lines:
  Name: Ada
  Device: “VPS”, random id b469a88d0fe09b46caf1fcf1465f2799 made by AI Insights, not from this computer's name or hardware
  Which days you were active: 15 dates from 2026-10-01 on (dates only, no counts or times)
  Period: 2026-11-01 to 2026-11-14
  29 sessions, 35.0K tokens
  15 active days, longest streak 14 days
  Agents: Claude Code 71%, Codex 29%
  Card “Longest streak”: 14 days, in a row, Nov 1 to Nov 14
  …

The numbers travel in the link's #fragment, which browsers do not send to any server. Nothing is uploaded:
open the link on your laptop or phone to see your card, then sign in there and press Publish to join the leaderboard.

https://ai-insights.app/share/#eyJ2IjozLCJuYW1lIjoiQWRhIiwiZnJvbSI6IjIwMjYtMTEtMDEi…

Also saved to ~/.ai-insights/share-link.txt, in case your terminal wraps the link.`}</Code>
      <H3 id="cmd-serve">ai-insights serve</H3>
      <p>
        Shows the last written report to a browser on your own computer, for when AI Insights runs on a server. It listens on{" "}
        <code>127.0.0.1</code> only, so nothing on the network can reach it, and you forward the port over your own SSH connection. It serves
        that one report file at one random path, read-only, and answers nothing else: no other files, no listing, only <code>GET</code> and{" "}
        <code>HEAD</code>, only for a <code>localhost</code> address, with the report&apos;s own policy that loads nothing from the network. The
        random path keeps other accounts on a shared server from reading the report. It stops after 30 minutes without a visit, or on Ctrl-C.
        A free port is picked unless you pass <code>--port</code> (1024 to 65535).
      </p>
      <Code label="Output" copy={false}>{`Serving your report on this server at http://localhost:41234/9f2c…e1
It listens on 127.0.0.1 only: nothing on the network can reach it.

On your own computer, forward the port over SSH:
  ssh -L 41234:127.0.0.1:41234 user@host
then open:
  http://localhost:41234/9f2c…e1

It stops after 30 minutes without a visit, or press Ctrl-C.`}</Code>
      <H3 id="cmd-mcp">ai-insights mcp</H3>
      <p>
        Starts the MCP server on standard input and output. Your agent starts this for you once the plugin or server is installed; you do not run
        it by hand. See the <DocLink href="/docs/mcp">MCP reference</DocLink>.
      </p>
      <H3 id="cmd-import">ai-insights import</H3>
      <p>
        Adds the history of a chat product from its data export. Chat exports are never looked for on their own: you point AI Insights at the
        file. See <DocLink href="/docs/import">Import chat history</DocLink> for what is read and what cannot be measured.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights import claude <path>    a Claude export: the .zip, its unzipped folder, or conversations.json
ai-insights import openai <path>    a ChatGPT export: the .zip, its unzipped folder, or a conversations JSON file
ai-insights import --list           show what has been imported
ai-insights import --remove <src>   remove that import (claude or openai) and everything made from it`}</Code>
      <p>
        A newer import of the same source replaces the earlier one. Imported conversations then appear in every run as their own agent,{" "}
        <code>claude-chat</code> (Claude chat) or <code>chatgpt</code> (ChatGPT).
      </p>
      <H3 id="cmd-install">ai-insights install</H3>
      <p>
        Adds the AI Insights plugin to the agents it finds, through each agent&apos;s own plugin commands. It prints the exact commands first and
        runs them only after you say yes (or with <code>--yes</code>). It edits no agent config file itself, and running it again changes
        nothing once the plugin is there. A step that fails or takes longer than two minutes is reported with the command to run yourself.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights install [--harness <name>]... [--yes] [--dry-run]
ai-insights uninstall [--harness <name>]... [--yes] [--dry-run]`}</Code>
      <Table
        caption="What install runs"
        head={["Agent", "Commands", "Uninstall"]}
        rows={[
          [
            "Claude Code",
            <>
              <code>claude plugin marketplace add hamedmp/ai-insights</code>, then <code>claude plugin install ai-insights@ai-insights --scope user</code>
            </>,
            <>
              <code>claude plugin uninstall ai-insights@ai-insights</code>, <code>claude plugin marketplace remove ai-insights</code>
            </>,
          ],
          [
            "Codex",
            <>
              <code>codex plugin marketplace add hamedmp/ai-insights</code>, then <code>codex plugin add ai-insights@ai-insights</code>
            </>,
            <>
              <code>codex plugin remove ai-insights@ai-insights</code>, <code>codex plugin marketplace remove ai-insights</code>
            </>,
          ],
          ["Cursor, OpenCode, Pi", "Nothing: it prints the install steps (untested installs)", "Prints the removal steps"],
        ]}
      />
      <p>
        <code>--harness</code> takes <code>claude-code</code>, <code>codex</code>, <code>cursor</code>, <code>opencode</code> or <code>pi</code>{" "}
        and can repeat. <code>--dry-run</code> prints the plan and changes nothing. Without <code>--yes</code> it only asks at a terminal;
        piped, it prints the plan and exits 1. Claude Code and Codex download the plugin from GitHub when they install it; see{" "}
        <DocLink href="/docs/privacy#installing">Privacy</DocLink>. Uninstalling leaves your report and cache in place.{" "}
        <code>uninstall</code> also removes a schedule added with <a href="#cmd-schedule">ai-insights schedule</a>.
      </p>
      <H3 id="cmd-schedule">ai-insights schedule</H3>
      <p>
        Adds one job to your computer&apos;s own scheduler that refreshes the report at a set time and shows a notification. It is the one thing
        AI Insights leaves running after a restart, so it is opt-in and works like <a href="#cmd-install">install</a>: it lists the files it
        adds, the exact command line it runs and when, and adds nothing until you say yes. It never runs in CI or when the output is not a
        terminal; <code>--yes</code> only skips the question. The job reads your agent history on this computer, rewrites the report, saves the
        counts for the session-start reminder (<code>digest.json</code> in the store) and shows a notification. It sends nothing anywhere.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights schedule daily|weekly|monthly [--at HH:MM] [--day mon..sun] [--with-cost] [--yes] [--dry-run]
ai-insights schedule off       remove everything it added
ai-insights schedule status    what is installed, when it runs next, how the last run went`}</Code>
      <Table
        caption="Where the job lives"
        head={["System", "What it adds", "Notification"]}
        rows={[
          ["macOS", <><code key="p">~/Library/LaunchAgents/app.ai-insights.schedule.plist</code>, loaded with <code>launchctl bootstrap gui/&lt;uid&gt;</code></>, <code key="n">osascript</code>],
          ["Linux", <><code key="u">ai-insights-schedule.service</code> and <code>.timer</code> in <code>~/.config/systemd/user</code>, enabled with <code>systemctl --user</code></>, <><code key="n">notify-send</code>, when installed</>],
          ["Linux without user systemd", "Nothing: it prints a crontab line for you to add", "None"],
          ["Windows", "Nothing: it prints a schtasks command for you to run (untested on Windows)", "None"],
        ]}
      />
      <p>
        The default time is 09:00, and weekly runs on Monday. A daily, weekly or monthly job reports on the last 1, 7 or 30 days, and monthly runs
        on the 1st. On Linux, a run missed while the computer was off happens at the next start. The notification holds counts only, since it can
        show on a lock screen: no project names, prompts or paths, and the estimated cost only with <code>--with-cost</code>. Clicking it opens
        nothing. The job starts this install&apos;s own Node and CLI file by absolute path, never <code>npx</code> (which would contact the npm
        registry), so <code>schedule</code> refuses to run from an npx cache: install it first with <code>npm i -g ai-insights</code>.
      </p>
      <Code label="Output, on Linux; home folder shortened to ~" copy={false}>{`$ ai-insights schedule weekly
This adds a scheduled job to this computer that keeps running after a restart:
  when   every Monday at 09:00 (next: Mon 23 Nov 2026, 09:00)
  runs   /usr/local/bin/node /usr/local/lib/node_modules/ai-insights/dist/cli/main.js schedule run weekly
  adds   ~/.config/systemd/user/ai-insights-schedule.service
         ~/.config/systemd/user/ai-insights-schedule.timer
  then   systemctl --user daemon-reload
         systemctl --user enable --now ai-insights-schedule.timer
Each time it reads your agent history on this computer, rewrites the report and shows a
notification with counts only, like "Your weekly AI Insights are ready: 41 sessions, 6.1 h."
It sends nothing anywhere.
Remove it any time with: ai-insights schedule off (ai-insights uninstall removes it too)
Add this schedule? [Y/n]`}</Code>
      <H3 id="cmd-nudge">ai-insights nudge</H3>
      <p>
        Prints one line when a monthly review is due, and nothing otherwise. The plugin runs the same code when a new Claude Code or Codex
        session starts; see <DocLink href="/docs/getting-started#monthly-reminder">The monthly reminder</DocLink>. It always exits 0.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights nudge          the line, if a review is due
ai-insights nudge --off    never remind me
ai-insights nudge --on     remind me again`}</Code>
      <p>
        <code>help</code> is accepted as a command and prints the same text as <code>--help</code>.
      </p>

      <H2 id="summary-json">Quick-view JSON</H2>
      <p>
        With <code>--json</code>, each of these prints numbers for other tools: a tray app, a status-bar script. It carries{" "}
        <code>schemaVersion: 1</code>, <code>generatedAt</code>, <code>timezone</code>, <code>reportPath</code> (or null) and{" "}
        <code>periods.today</code>, <code>.week</code> and <code>.month</code>. With <code>--since</code> or <code>--until</code> it carries{" "}
        <code>.range</code> instead. Each period has <code>from</code>, <code>to</code>, <code>sessions</code>, <code>activeMinutes</code>,{" "}
        <code>prompts</code>, <code>tokens</code> (null when not measured), <code>costUsd</code> (null when not measured or nothing could be
        priced), <code>unpricedRequestShare</code>, <code>byAgent</code> (each with <code>measured: false</code> for chat exports), <code>byModel</code> and <code>tip</code>. It holds aggregates only: no
        prompts, commands, paths or project names, except <code>byProject</code> with <code>--by project</code>. A new optional field keeps the
        version; any other change is a new version. The full description is{" "}
        <a href="https://github.com/HamedMP/ai-insights/blob/main/docs/summary-json.md">docs/summary-json.md</a>. Call it from a global install
        (<code>npm i -g ai-insights</code>), not <code>npx</code>, when something runs it every few minutes.
      </p>

      <H2 id="on-a-server">On a server</H2>
      <p>
        Over SSH without a forwarded display, or on Linux with no display at all, a run does not ask to open the report and does not pretend
        it opened. It ends with the three ways to see it from your own computer (if a browser fails to open elsewhere, you get the same lines):
      </p>
      <Code label="Output, the end of a run over SSH; home folder shortened" copy={false}>{`No browser here to open the report. To see it from your own computer:
  npx ai-insights@latest serve    through an SSH tunnel
  scp user@host:/home/you/.ai-insights/reports/report.html .
  npx ai-insights@latest share    a link to publish from any device`}</Code>
      <p>
        <a href="#cmd-serve">serve</a> shows the full report through an SSH tunnel; the <code>scp</code> line, run on your own computer with
        your server&apos;s login in place of <code>user@host</code>, copies the file so you can open it there; <a href="#cmd-share">share</a>{" "}
        prints the link to your card, which you can open on your laptop or phone and publish from. Nothing leaves the server unless you run one
        of these yourself.
      </p>

      <H2 id="options">Options</H2>
      <p>
        Options work with the default command, <code>scan</code>, <code>report</code> and <code>share</code>; the share and serve options only
        with their command. Values can follow a space or an equals sign:{" "}
        <code>--since 30d</code> or <code>--since=30d</code>.
      </p>
      <Table
        caption="Options"
        head={["Option", "What it does"]}
        rows={[
          [
            <code key="s">--since &lt;window&gt;</code>,
            <>
              Only history from a window like <code>30d</code>, <code>12w</code>, <code>6m</code> or <code>1y</code> (a month counts as 30 days, a
              year as 365), or from a day like <code>2026-01-31</code>, which starts at midnight in your time zone.
            </>,
          ],
          [
            <code key="h">--harness &lt;name&gt;</code>,
            <>
              Only one agent: <code>claude-code</code>, <code>codex</code>, <code>cursor</code>, <code>pi</code>, <code>opencode</code>,{" "}
              <code>gemini</code>, <code>claude-chat</code> (an imported Claude chat export) or <code>chatgpt</code> (an imported ChatGPT export).
            </>,
          ],
          [<code key="m">--max-sessions &lt;n&gt;</code>, "Read at most n transcripts, newest first. The default is 5,000; the most is 50,000."],
          [<code key="r">--refresh</code>, "Re-parse every transcript, ignoring the cache."],
          [
            <code key="j">--json</code>,
            <>
              With <code>report</code>: print the report as JSON instead of writing HTML. With <code>today</code>, <code>week</code>,{" "}
              <code>month</code> and <code>summary</code>: print the <a href="#summary-json">quick-view JSON</a>.
            </>,
          ],
          [
            <code key="u">--until &lt;day&gt;</code>,
            <>
              Only history up to and including this day (<code>2026-11-30</code>, to midnight in your time zone). With the default command,{" "}
              <code>scan</code>, <code>report</code> and <code>share</code> it keeps sessions that started by then, each counted whole. With{" "}
              <code>today</code>, <code>week</code> or <code>month</code> it ends the period there, and <code>--since</code> takes a day too.
            </>,
          ],
          [<code key="l">--last &lt;n&gt;</code>, <>With <code>today</code>, <code>week</code> or <code>month</code>: the last n days, weeks or months (1 to 366), one row each.</>],
          [<code key="b">--by &lt;what&gt;</code>, <>With <code>today</code>, <code>week</code> or <code>month</code>: break it down by <code>project</code>, <code>model</code> or <code>agent</code> (the default).</>],
          [<code key="nc">--no-cost</code>, <>With the quick views: leave the cost out, for a screen others can see.</>],
          [<code key="o">--open</code>, "Open the written report in your default browser without asking."],
          [<code key="no">--no-open</code>, "Do not ask whether to open the report, and do not open it."],
          [<code key="ni">--no-install-prompt</code>, "Do not offer to add AI Insights to your agents after the run."],
          [<code key="sn">--name &lt;name&gt;</code>, <>With <code>share</code> only: the display name on your card. None by default.</>],
          [<code key="sd">--device &lt;name&gt;</code>, <>With <code>share</code> only: a name for this computer, for publishing from several. None by default.</>],
          [<code key="sy">--no-days</code>, <>With <code>share</code> only: leave out which days you were active.</>],
          [<code key="sc">--copy</code>, <>With <code>share</code> only: also ask the terminal to copy the link (OSC 52).</>],
          [<code key="sp">--port &lt;n&gt;</code>, <>With <code>serve</code> only: the port on <code>127.0.0.1</code>, 1024 to 65535. A free one by default.</>],
          [<code key="hh">-h, --help</code>, "Show the help."],
          [<code key="v">-v, --version</code>, "Show the version."],
        ]}
      />
      <Code label="Examples">{`npx ai-insights@latest --since 90d --open
npx ai-insights@latest scan --harness codex
npx ai-insights@latest --refresh
npx ai-insights@latest report --since 2026-10-01 --until 2026-10-31`}</Code>

      <H2 id="environment">Environment variables</H2>
      <Table
        caption="Environment variables"
        head={["Variable", "Effect"]}
        rows={[
          [<code key="a">AI_INSIGHTS_HOME</code>, <>Where AI Insights keeps its cache, labels, snapshots and reports. Default <code>~/.ai-insights</code>.</>],
          [<code key="h">HINDSIGHT_HOME</code>, <>The pre-0.2 name, used when <code>AI_INSIGHTS_HOME</code> is not set.</>],
          [<code key="d">AI_INSIGHTS_DEBUG</code>, "When set, a failed command also prints the error's stack trace."],
          [<code key="l">AI_INSIGHTS_LIVE</code>, <>The first numbers a run shows while it works: <code>0</code> turns them off, <code>1</code> turns them on when piped or in CI (off there by default).</>],
          [<code key="w">AI_INSIGHTS_WORKERS</code>, <>Worker threads used to read transcripts, 0 to 8. <code>0</code> reads everything on one thread. By default it picks up to 4 from your cores and memory (none on a 2-core or 2 GB machine); each worker adds about 100 MB while a first, cold scan runs.</>],
          [
            <code key="ao">AI_INSIGHTS_OPEN</code>,
            <>
              <code>1</code> opens the report without asking, <code>0</code> never asks. <code>--open</code> and <code>--no-open</code> win over it.
            </>,
          ],
          [
            <code key="ni">AI_INSIGHTS_NO_INSTALL_PROMPT</code>,
            <>
              <code>1</code> never offers to add AI Insights to your agents, like <code>--no-install-prompt</code>.
            </>,
          ],
          [<code key="nc">NO_COLOR</code>, "When set to anything, the result screen has no colour and no links."],
          [<code key="fc">FORCE_COLOR</code>, <>Colour even when the output is piped, for recordings: <code>1</code>, <code>2</code> (256 colours) or <code>3</code> (truecolor); <code>0</code> turns colour off. It wins over <code>NO_COLOR</code>.</>],
          [<code key="fh">FORCE_HYPERLINK</code>, <><code>0</code> turns off clickable links in terminals that show them as stray characters; <code>1</code> turns them on.</>],
          [
            "Agent variables",
            <>
              <code>CLAUDE_CONFIG_DIR</code>, <code>CODEX_HOME</code>, <code>OPENCODE_DB</code>, <code>PI_CODING_AGENT_DIR</code>,{" "}
              <code>CURSOR_CONFIG_DIR</code>, <code>GEMINI_CLI_HOME</code> and others move where history is read from. See{" "}
              <DocLink href="/docs/agents#locations">Where each agent&apos;s history lives</DocLink>.
            </>,
          ],
        ]}
      />

      <H2 id="exit-codes">Exit codes</H2>
      <Table
        caption="Exit codes"
        head={["Code", "Meaning"]}
        rows={[
          ["0", "Success."],
          [
            "1",
            <>
              No sessions were found (the default command and <code>share</code>), there is no report to serve yet, the chosen port is taken,
              or the command failed. The message starts with <code>ai-insights:</code>.{" "}
              <code>install</code> and <code>uninstall</code> also exit 1 when a step failed, a named agent is not installed, or they would have
              needed <code>--yes</code>.
            </>,
          ],
          [
            "2",
            <>
              A usage error: an unknown command or option, a missing or invalid value, <code>--json</code> without <code>report</code>, or a share or serve option with another command.
            </>,
          ],
        ]}
      />
      <Code label="Output" copy={false}>{`$ npx ai-insights@latest --since 5x
ai-insights: --since must be a window like 30d, 12w, 6m or 1y, or an ISO date like 2026-01-31
Run \`ai-insights --help\` for usage.`}</Code>

      <H2 id="install-script">The install script</H2>
      <p>
        <code>scripts/install.sh</code> in the repository sets up the skills and MCP server for agents without a plugin install, or several at
        once. Run it from a clone.
      </p>
      <Code label="Usage" copy={false}>{`scripts/install.sh [--all | --harness <name>]... [--dry-run]`}</Code>
      <Table
        caption="Install script options"
        head={["Option", "What it does"]}
        rows={[
          [<code key="a">--all</code>, "Every supported agent found on this machine. The default."],
          [
            <code key="h">--harness &lt;name&gt;</code>,
            <>
              Only this agent; repeatable. One of <code>claude-code</code>, <code>codex</code>, <code>cursor</code>, <code>opencode</code>,{" "}
              <code>pi</code>.
            </>,
          ],
          [<code key="d">--dry-run</code>, "Print what would happen and change nothing."],
          [<code key="hh">-h, --help</code>, "Show the help."],
        ]}
      />
      <p>Where it puts things:</p>
      <Table
        caption="Install script targets"
        head={["Agent", "Skills", "MCP server"]}
        rows={[
          ["Claude Code", <code key="s">~/.claude/skills</code>, <code key="m">claude mcp add --scope user</code>],
          ["Codex", <code key="s">~/.agents/skills</code>, <code key="m">codex mcp add</code>],
          ["Cursor", <code key="s">~/.cursor/skills</code>, <code key="m">~/.cursor/mcp.json</code>],
          ["OpenCode", <code key="s">~/.agents/skills</code>, <code key="m">opencode mcp add</code>],
          ["Pi", <code key="s">~/.pi/agent/skills</code>, <>None: use <code>pi install</code> for the tools</>],
        ]}
      />
      <p>
        It replaces only the folders of the three skills it ships, skips an MCP server that is already registered, and leaves a Cursor{" "}
        <code>mcp.json</code> that is not valid JSON untouched. For Claude Code it notes that the plugin does the same thing: use one or the other.
      </p>
    </DocShell>
  )
}
