import { DocShell } from "@/components/docs/doc-shell"
import { Code, DocLink, H2, H3 } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"
import { REPO } from "@/lib/site"

export const metadata = docMetadata("troubleshooting")

export default function Troubleshooting() {
  return (
    <DocShell slug="troubleshooting">
      <p>
        Start with <code>doctor</code>. It shows the version, your Node version, every place AI Insights looked for each agent, and whether its own
        folder is writable.
      </p>
      <Code label="Terminal">npx ai-insights@latest doctor</Code>

      <H2 id="no-sessions">No agent sessions found</H2>
      <Code label="Output" copy={false}>{`No agent sessions found. Run \`npx ai-insights@latest doctor\` to see where AI Insights looked.
AI Insights reads Claude Code, Codex, Cursor, Pi, OpenCode and Gemini CLI history from their usual folders on this machine.
More help: https://ai-insights.app/docs/troubleshooting`}</Code>
      <p>
        With <code>--since</code> or <code>--harness</code>, a third line names them: the filter may be what left nothing.
      </p>
      <ul>
        <li>
          <strong>History in another place.</strong> If you set <code>CLAUDE_CONFIG_DIR</code>, <code>CODEX_HOME</code> or a similar variable for
          your agent, set it the same way when you run AI Insights. <code>doctor</code> lists each location as found or missing. The variables are
          in <DocLink href="/docs/agents#locations">Where each agent&apos;s history lives</DocLink>.
        </li>
        <li>
          <strong>A narrow window.</strong> <code>--since</code> or <code>--harness</code> may leave nothing. Run without them.
        </li>
        <li>
          <strong>No history kept.</strong> If the agent deleted its transcripts, there is nothing left to read, and AI Insights only has stats for
          sessions it read before.
        </li>
      </ul>

      <H2 id="node-version">Node version problems</H2>
      <ul>
        <li>
          <strong>Node older than 20:</strong> AI Insights needs Node.js 20 or newer. Check with <code>node --version</code> and upgrade.
        </li>
        <li>
          <strong>OpenCode found but empty:</strong> OpenCode keeps its history in a SQLite database that needs Node 22.5 or later to read.{" "}
          <code>doctor</code> prints a note under OpenCode when this is the problem.
        </li>
        <li>
          <strong>Codex compressed rollouts:</strong> <code>.jsonl.zst</code> files need Node 22.15 or later, or a <code>zstd</code> program on
          your <code>PATH</code>.
        </li>
      </ul>

      <H2 id="short-history">History only goes back a month</H2>
      <p>
        Claude Code deletes transcripts 30 days after they last changed, and Gemini CLI deletes chats after 30 days, unless you raise their
        settings. AI Insights cannot read what is gone. Raise the setting now so the next run can look further back; see{" "}
        <DocLink href="/docs/agents#retention">How long agents keep history</DocLink>. AI Insights keeps the stats of sessions it has already read, so running
        it regularly keeps more of your history in the report.
      </p>

      <H2 id="unpriced">Cost says some requests are unpriced</H2>
      <p>
        The cost estimate prices each request from a table of exact model ids. A new or renamed model, a provider tier without a published price,
        or a model routed through another provider is counted as unpriced instead of borrowing a price. The report and{" "}
        <code>ai_insights_report</code> show the unpriced share next to the estimate, so you can see how much of the total it covers. Upgrading
        with <code>npx ai-insights@latest</code> picks up newer pricing tables. Cursor sessions carry no token counts at all, so they are never
        priced.
      </p>

      <H2 id="no-tools">The MCP tools do not appear</H2>
      <ol>
        <li>
          Start a new session or restart the agent. Agents usually load new MCP servers and skills only at startup.
        </li>
        <li>
          Check the package starts: <code>npx -y ai-insights --version</code>.
        </li>
        <li>
          Check the server is registered, for example with <code>claude mcp get ai-insights</code> or <code>codex mcp get ai-insights</code>.
          Register it by hand if needed; see <DocLink href="/docs/agent-review#install-manual">By hand</DocLink>.
        </li>
        <li>
          Ask your agent to run the <code>ai-insights-setup</code> skill. It checks each step and tells you the fix.
        </li>
      </ol>
      <p>
        On Pi, a build without MCP support loads the skills but shows a warning that the <code>ai_insights_*</code> tools are unavailable.
      </p>

      <H2 id="store">The store is not writable</H2>
      <p>
        If <code>doctor</code> prints <code>NOT writable: set AI_INSIGHTS_HOME to a folder you own</code>, point AI Insights at a folder you can
        write to:
      </p>
      <Code label="Terminal">{`AI_INSIGHTS_HOME="$HOME/ai-insights-data" npx ai-insights@latest`}</Code>
      <p>
        For a full error trace on any failing command, set <code>AI_INSIGHTS_DEBUG=1</code> and include the output when you{" "}
        <a href={`${REPO}/issues`}>open an issue</a>, after checking it for anything private.
      </p>

      <H2 id="faq">FAQ</H2>
      <H3 id="faq-model">Does AI Insights send my history to a model?</H3>
      <p>
        No. It never calls a model API. Only if you run the agent review does your own agent read short, redacted excerpts, under the account and
        settings you already use.
      </p>
      <H3 id="faq-plugin">Do I need the plugin?</H3>
      <p>
        No. <code>npx ai-insights@latest</code> gives you the cards, the video, the findings and the suggestions. The plugin adds the agent review and the
        coach that turns findings into edits you approve.
      </p>
      <H3 id="faq-same">Why does every run give the same findings?</H3>
      <p>
        The deterministic layer has no randomness: the same history gives the same result. Findings change when your history does, and{" "}
        <DocLink href="/docs/report#over-time">Since your last run</DocLink> shows which look resolved.
      </p>
      <H3 id="faq-agent-hours">Why are agent-hours larger than the hours in a day?</H3>
      <p>
        Agent-hours add up the active time of every session, so two sessions running side by side for an hour count as two agent-hours. Active
        hours count the clock time when at least one agent was working.
      </p>
      <H3 id="faq-cost">Is the cost what I paid?</H3>
      <p>
        No. It is an estimate at API list prices. On a subscription your spend is different. Where an agent records its own cost, the report shows
        that separately.
      </p>
      <H3 id="faq-cursor">Why does Cursor show no tokens?</H3>
      <p>Cursor&apos;s local transcripts hold prompts and tool calls but no token counts.</p>
      <H3 id="faq-delete">How do I remove everything?</H3>
      <p>
        Delete <code>~/.ai-insights/</code> (or the folder <code>AI_INSIGHTS_HOME</code> points to). If you published, use Remove my entry on the
        website; see <DocLink href="/docs/privacy#removing">Removing what you published</DocLink>.
      </p>
      <H3 id="faq-matrix">Do I need Matrix OS?</H3>
      <p>
        No. AI Insights is free, MIT licensed and works without it. A Matrix OS account is used only to sign in on the website if you choose to
        publish.
      </p>
      <H3 id="faq-bug">Where do I report a bug?</H3>
      <p>
        In <a href={`${REPO}/issues`}>GitHub issues</a>. Include the output of <code>npx ai-insights@latest doctor</code>, and never paste transcript
        content or prompts you would not want public.
      </p>
    </DocShell>
  )
}
