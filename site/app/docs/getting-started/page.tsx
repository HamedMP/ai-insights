import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("getting-started")

export default function GettingStarted() {
  return (
    <DocShell slug="getting-started">
      <H2 id="requirements">Requirements</H2>
      <ul>
        <li>
          <strong>Node.js 20 or newer.</strong> Check with <code>node --version</code>. A few sources need more: OpenCode&apos;s database needs Node
          22.5 or later, and compressed Codex rollouts need Node 22.15 or later or a <code>zstd</code> program on your <code>PATH</code>. See{" "}
          <a href="/docs/troubleshooting#node-version">Node version problems</a>.
        </li>
        <li>
          <strong>Some agent history.</strong> At least one of Claude Code, Codex, Cursor, Pi, OpenCode or Gemini CLI used on this machine. See{" "}
          <a href="/docs/agents">What it reads</a>.
        </li>
        <li>No account, no API key and no network access beyond what <code>npx</code> needs to download the package.</li>
      </ul>

      <H2 id="first-run">Your first run</H2>
      <Code label="Terminal">npx ai-insights</Code>
      <p>
        AI Insights scans your history, writes the report and prints a short summary. Add <code>--open</code> to open the report in your browser
        when it is written. On a synthetic history of twelve Claude Code sessions the output looks like this:
      </p>
      <Code label="Output, from a synthetic history; home folder shortened to ~" copy={false}>{`12 sessions across Claude Code, 2026-11-05 to 2026-11-16.
2.2 active hours (2.2 agent-hours across parallel sessions) on 12 days; 1.6M tokens, about $1.13 at API list prices.
Top finding: You keep telling the agent: "run the tests and fix what fails"

Report: ~/.ai-insights/reports/report.html
Tip: run the analyze-ai-usage skill in your agent to add what went well and what got in the way.`}</Code>
      <p>The lines are:</p>
      <ul>
        <li>
          <strong>Coverage:</strong> how many sessions, from which agents, over which dates.
        </li>
        <li>
          <strong>Time and tokens:</strong> active hours (clock time with at least one agent working), agent-hours (the same time summed over
          sessions running in parallel, so it can be larger), active days, tokens and the estimated cost.
        </li>
        <li>
          <strong>Top finding:</strong> the most severe finding, or a note that more history makes for better tips.
        </li>
        <li>
          <strong>Report:</strong> the path to the HTML file. The real output prints the full path.
        </li>
        <li>
          <strong>History warning</strong> (only when it applies): how many sessions your agents can delete within the next 7 days, and the setting
          that keeps them.
        </li>
        <li>
          <strong>Tip</strong> (until you run the agent review): a pointer to the <code>analyze-ai-usage</code> skill.
        </li>
      </ul>
      <p>
        Open the report in any browser. It is one file with everything inside it, so you can also move it or keep a copy. If nothing is found, the
        command prints <code>No agent sessions found.</code> and exits with code 1; run <code>npx ai-insights doctor</code> to see where it looked.
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
        ]}
      />
      <p>
        Deleting the folder is safe: the next run rebuilds the cache from whatever transcripts your agents still keep. You lose the stats of
        sessions whose transcripts are gone, the saved labels and the run history.
      </p>

      <H2 id="run-it-again">Run it again</H2>
      <p>
        Later runs are faster because unchanged transcripts come from the cache. Each run saves a snapshot, so the report gains a{" "}
        <a href="/docs/report#over-time">Since your last run</a> section. To use the newest release rather than a copy <code>npx</code> cached
        earlier, ask for it by tag:
      </p>
      <Code label="Terminal">npx ai-insights@latest</Code>
      <p>
        To look at part of your history, pass <code>--since 30d</code> (or <code>12w</code>, <code>6m</code>, <code>1y</code>, or a date like{" "}
        <code>2026-01-31</code>) or <code>--harness codex</code>. Every option is in the <a href="/docs/cli">CLI reference</a>.
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
        <a href="/docs/agent-review#install">Install the plugin</a>.
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
          If <code>~/.ai-insights/</code> does not exist and <code>~/.hindsight/</code> does, AI Insights keeps using <code>~/.hindsight/</code>, so
          earlier results carry over. Nothing is moved or deleted.
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
