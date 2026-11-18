import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, DocLink, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"
import { HASHTAG } from "@/lib/site"

export const metadata = docMetadata("getting-started")

export default function GettingStarted() {
  return (
    <DocShell slug="getting-started">
      <H2 id="requirements">Requirements</H2>
      <ul>
        <li>
          <strong>Node.js 20 or newer.</strong> Check with <code>node --version</code>. A few sources need more: OpenCode&apos;s database needs Node
          22.5 or later, and compressed Codex rollouts need Node 22.15 or later or a <code>zstd</code> program on your <code>PATH</code>. See{" "}
          <DocLink href="/docs/troubleshooting#node-version">Node version problems</DocLink>.
        </li>
        <li>
          <strong>Some agent history.</strong> At least one of Claude Code, Codex, Cursor, Pi, OpenCode or Gemini CLI used on this machine. See{" "}
          <DocLink href="/docs/agents">What it reads</DocLink>.
        </li>
        <li>No account, no API key and no network access beyond what <code>npx</code> needs to download the package.</li>
      </ul>

      <H2 id="first-run">Your first run</H2>
      <Code label="Terminal">npx ai-insights@latest</Code>
      <p>
        AI Insights draws the Matrix OS rabbit at once, then shows what it is doing on one line (finding your history, reading sessions, analysing, writing
        the report) and ends with a check mark and the time it took. Then it shows what it found and asks whether to open the report. On a
        synthetic history of 58 Claude Code and Codex sessions, an 80-column terminal ends like this (in colour, with the report path and the
        website as links you can click):
      </p>
      <Code label="Output, from a synthetic history; home folder shortened to ~" copy={false}>{`         ▀▄▄
      ▄▄▖ ▀▜▄
       ▀▛█▄ ▀▙
         ▝▀▀▌▝▄▄
             ▐██▙     ▄▀█ █   █ █▄ █ █▀ █ █▀▀ █ █ ▀█▀ █▀
         ▝▀▀▀▀▝       █▀█ █   █ █ ▀█ ▄█ █ █▄█ █▀█  █  ▄█
      ▀▀▀▀▀ ▀▝▀▘      by Matrix OS · v0.7.1
    ▝▀▀▀▀▘▀ ▀▀▀▘
    ▀▀▀▀▀▘▀▘ ▀▀
  ▀▀ ▀▘▝▀▀▘▝▘ ▀

  ✓ 58 sessions (Claude Code 46 · Codex 12) read and analysed in 0.1s

  ╭─ 2026-10-23 → 2026-11-16 ────────────────────────────────────────────────╮
  │ 58             23             28             151.1M         $69.71+      │
  │ sessions       active days    active hours   tokens         est. cost    │
  │                                                                          │
  │ Claude Code, Codex · 31 agent-hours in parallel · 22% of requests        │
  │ unpriced                                                                 │
  ╰──────────────────────────────────────────────────────────────────────────╯

  ◆ The Night Delegator
    also The Clear Briefer · The Context Keeper · The Stress Tester
  ▲ Top finding  \`pnpm e2e\` keeps failing
  ▸ Report  ~/.ai-insights/reports/report.html

  What to do next ────────────────────────────────────────────────────────────
  1  Open       press Enter below to open it in your browser, or click the
                report path above.
  2  Cards      the report opens on your cards; Download video or images saves
                them.
  3  Publish    Publish to the leaderboard next to your cards, then again in
                the box; sign in on ai-insights.app and press Publish.
  4  Share      post your cards or ai-insights.app/u/<handle> with
                ${HASHTAG}.
  5  Go deeper  run the analyze-ai-usage skill in your agent.

  ! 5 Claude Code sessions can be deleted within 7 days (from 2026-11-22).
    Keep them: add "cleanupPeriodDays": 365 to ~/.claude/settings.json or run
    npx packmem archive.

  Keep your history with Matrix OS  →  matrix-os.com

  Open the report in your browser? [Y/n] no`}</Code>
      <p>From the top:</p>
      <ul>
        <li>
          <strong>The numbers:</strong> the dates covered, sessions, active days, active hours (clock time with at least one agent working),
          tokens and the estimated cost at API list prices. Under them: which agents, the agent-hours (the same time summed over sessions running
          in parallel, so it can be larger) and how much usage could not be priced.
        </li>
        <li>
          <strong>Your persona</strong> and the extra titles you earned, when the report has a recap.
        </li>
        <li>
          <strong>Top finding:</strong> the most severe finding, or a note that more history makes for better tips.
        </li>
        <li>
          <strong>Report:</strong> the full path to the HTML file. Most terminals let you click it (with Cmd or Ctrl held in some).
        </li>
        <li>
          <strong>What to do next:</strong> open the report, which starts on your cards; export them with{" "}
          <strong>Download video or images</strong>, publish to the leaderboard (<strong>Publish to the leaderboard</strong> next to your cards,
          then the same button in the box it takes you to, then sign in on ai-insights.app and press <strong>Publish</strong>; see <DocLink href="/docs/sharing#publish">Publish to the leaderboard</DocLink>), share with <code>{HASHTAG}</code>, and run the{" "}
          <DocLink href="/docs/agent-review">agent review</DocLink>. The last step goes away once you have run the review.
        </li>
        <li>
          <strong>History warning</strong> (only when it applies): how many sessions your agents can delete within the next 7 days, and the setting
          that keeps them.
        </li>        <li>
          <strong>Keep your history with Matrix OS:</strong> a link to <a href="https://matrix-os.com">matrix-os.com</a>, the same one the report
          ends with. AI Insights itself uploads nothing.
        </li>
        <li>
          <strong>The question:</strong> press Enter (or <code>y</code>) to open the report in your browser, <code>n</code> to leave it. Add{" "}
          <code>--open</code> to open it without asking, <code>--no-open</code> to never be asked, or set <code>AI_INSIGHTS_OPEN=1</code> or{" "}
          <code>0</code> to make that your default. It is never asked when the output is piped, in CI or over SSH without a display.
        </li>
      </ul>
      <p>
        The screen fits narrower windows down to 40 columns, uses plain ASCII where the terminal cannot draw boxes, and drops colour and links
        when <code>NO_COLOR</code> is set. When the output is piped or redirected (a script, CI), it prints stable plain text with no escape codes
        instead:
      </p>
      <Code label="Piped output, same history" copy={false}>{`58 sessions across Claude Code and Codex, 2026-10-23 to 2026-11-16.
28 active hours (31 agent-hours across parallel sessions) on 23 days; 151.1M tokens, about $69.71 for the requests we can price; 22% unpriced.
Top finding: \`pnpm e2e\` keeps failing
Persona: The Night Delegator (also The Clear Briefer, The Context Keeper and The Stress Tester)

Report: ~/.ai-insights/reports/report.html
5 Claude Code sessions can be deleted within 7 days (from 2026-11-22). AI Insights keeps their stats; to keep the transcripts, add "cleanupPeriodDays": 365 to ~/.claude/settings.json or archive them with \`npx packmem archive\`.

Next steps
  1. Open the report: open the file above in your browser, or run again with --open.
  2. Your cards: the report opens on them; "Download video or images" saves them.
  3. Publish to the leaderboard: press "Publish to the leaderboard" next to your cards, then again in the box; sign in on https://ai-insights.app/ and press "Publish".
  4. Share it: use the X or LinkedIn buttons in the report, or post your cards or https://ai-insights.app/u/<handle> with ${HASHTAG}.
  5. Go deeper: run the analyze-ai-usage skill in your agent to add what went well and what got in the way.`}</Code>
      <p>
        Open the report in any browser. It is one file with everything inside it, so you can also move it or keep a copy. If nothing is found, the
        command prints <code>No agent sessions found.</code> with what to try and exits with code 1; run <code>npx ai-insights@latest doctor</code> to
        see where it looked.
      </p>

      <H2 id="where-files-go">Where files go</H2>
      <p>
        AI Insights writes only to its own folder, <code>~/.ai-insights/</code>. Set <code>AI_INSIGHTS_HOME</code> to put it somewhere else. Folders
        are created readable by you only (mode 700) and files likewise (mode 600).
      </p>
      <Table
        caption="Files AI Insights writes"
        head={["Path", "What it holds"]}
        rows={[
          [<code key="r">reports/report.html</code>, "The latest report. Open this one."],
          [<code key="t">reports/report-&lt;time&gt;.html</code>, "A timestamped copy of each report. The newest 20 are kept."],
          [<code key="j">reports/report.json</code>, "The latest report as JSON."],
          [<code key="s">sessions/&lt;agent&gt;/</code>, "The parsed sessions, cached so the next run only re-reads transcripts that changed."],
          [<code key="f">facets/&lt;agent&gt;/</code>, "Session labels your agent saved during the agent review."],
          [<code key="n">snapshots/</code>, "A small summary of each run, used for “Since your last run”."],
          [<code key="d">device.json</code>, "A random id for this installation, made once. Share links carry it so the website keeps one entry per computer. Never made from your computer's name or hardware."],
        ]}
      />
      <p>
        Deleting the folder is safe: the next run rebuilds the cache from whatever transcripts your agents still keep. You lose the stats of
        sessions whose transcripts are gone, the saved labels and the run history. A new device id is made too, so the next publish from this computer shows up on your profile as a new computer; remove the old one there.
      </p>

      <H2 id="run-it-again">Run it again</H2>
      <p>
        Later runs are faster because unchanged transcripts come from the cache. Each run saves a snapshot, so the report gains a{" "}
        <DocLink href="/docs/report#over-time">Since your last run</DocLink> section. To use the newest release rather than a copy <code>npx</code> cached
        earlier, ask for it by tag:
      </p>
      <Code label="Terminal">npx ai-insights@latest</Code>
      <p>
        To look at part of your history, pass <code>--since 30d</code> (or <code>12w</code>, <code>6m</code>, <code>1y</code>, or a date like{" "}
        <code>2026-01-31</code>) or <code>--harness codex</code>. Every option is in the <DocLink href="/docs/cli">CLI reference</DocLink>.
      </p>

      <H2 id="from-your-agent">From your agent instead</H2>
      <p>
        If you use Claude Code or Codex, you can install the plugin and ask your agent to build the report. That route adds the agent review: your
        own agent labels a sample of sessions and writes a short narrative.
      </p>
      <Code label="Claude Code">{`/plugin marketplace add hamedmp/ai-insights
/plugin install ai-insights@ai-insights`}</Code>
      <p>
        Then start a new session and run <code>/analyze-ai-usage</code>. Other agents and details are in{" "}
        <DocLink href="/docs/agent-review#install">Install the plugin</DocLink>.
      </p>

      <p>
        Or let the command line do it: after the report, <code>npx ai-insights@latest</code> offers to install the plugin into Claude Code and Codex, and{" "}
        <code>npx ai-insights@latest install</code> does the same at any time.
      </p>

      <H2 id="monthly-reminder">The monthly reminder</H2>
      <p>
        With the plugin installed, a new Claude Code or Codex session can show one line when a review is due:
      </p>
      <Code label="Shown at session start" copy={false}>{`AI Insights: your monthly review is due. Run /analyze-ai-usage, or npx ai-insights@latest in a terminal. (Turn this off: npx ai-insights@latest nudge --off)`}</Code>
      <ul>
        <li>It is due when no report has been written this calendar month. It shows at most once a month, on the first new session that finds it due.</li>
        <li>
          It is shown to you, not added to your agent&apos;s context, and it runs offline: a small script inside the plugin reads two files in your
          AI Insights folder (<code>reports/report.html</code> for its date, and <code>nudge.json</code>, where it records the month it last showed).
        </li>
        <li>
          Codex runs plugin hooks only after you review and trust them (in <code>/hooks</code>), so there it starts once you have approved
          it, and again after an update changes it. Codex documents plugin hooks for its desktop app; in the Codex CLI it is untested.
          Resumed, cleared and compacted sessions never show it.
        </li>
        <li>
          <code>npx ai-insights@latest nudge --off</code> turns it off; <code>--on</code> turns it back on. Uninstalling the plugin removes it.
        </li>
        <li>
          <code>npx ai-insights@latest nudge --cadence weekly</code> (or <code>daily</code>) shows one line at the first session of each week (or
          day) instead: that period&apos;s sessions, active time and context resets, and one tip. <code>--cadence monthly</code> goes back to the
          default, where the monthly line also carries last month&apos;s counts when it can.
        </li>
      </ul>
      <Code label="Shown at session start, weekly" copy={false}>{`AI Insights: last week (to Fri 13 Nov) 37 sessions, 21 h active, 8 context resets. A command kept failing last week. Tell the agent how the command should be run, in your instructions file. Run /analyze-ai-usage for the full review. (Turn this off: npx ai-insights@latest nudge --off)`}</Code>
      <p>
        The counts come from <code>digest.json</code> in your AI Insights folder, which <code>npx ai-insights@latest</code>,{" "}
        <code>today</code>, <code>week</code>, <code>month</code> and <code>summary</code> rewrite each time you run them: counts, the cost
        estimate and the kind of one finding, nothing else. The reminder never reads your history. When the digest is missing or about an older
        period, the plain reminder shows instead. A partial period says how far it goes, as in &quot;to Fri 13 Nov&quot; above.
      </p>
      <p>
        Why monthly: Claude Code and Gemini CLI delete transcripts after 30 days by default. Each run saves the stats and your prompts from every
        transcript it reads (see <DocLink href="/docs/agents#what-is-kept">What is kept</DocLink>), so a review a month keeps that history after the
        transcripts are gone. It does not keep the agent&apos;s replies or anything needed to resume a session.
      </p>

      <H2 id="hindsight">Formerly Hindsight</H2>
      <p>
        AI Insights was called Hindsight until version 0.2. If you used it then, nothing needs to change:
      </p>
      <ul>
        <li>
          The package installs a second command, <code>hindsight</code>, which runs the same program as <code>ai-insights</code>.
        </li>
        <li>
          If <code>~/.hindsight/</code> exists and <code>~/.ai-insights/</code> does not, the next <code>ai-insights</code> command moves it to{" "}
          <code>~/.ai-insights/</code> in one step and leaves <code>~/.hindsight</code> as a link to it, so earlier results carry over and the
          old path keeps working. It says so in one line. If the move cannot be done safely (another disk, no permission, no symlinks), nothing
          changes and <code>~/.hindsight/</code> stays in use. Two folders are never merged and nothing is deleted. The session-start reminder
          and the MCP server never move it.
        </li>
        <li>
          <code>HINDSIGHT_HOME</code> still works when <code>AI_INSIGHTS_HOME</code> is not set.
        </li>
        <li>
          The old npm package <code>@matrix-os/hindsight</code> is deprecated in favour of <code>ai-insights</code>.
        </li>
      </ul>
      <Callout title="Old skills stay where they are">
        <p>
          The install script leaves skills from before 0.2 (<code>hindsight</code>, <code>hindsight-coach</code>, <code>hindsight-setup</code>) in
          place and tells you about them. Remove them yourself once you no longer need them.
        </p>
      </Callout>
    </DocShell>
  )
}
