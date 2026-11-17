import { DocShell } from "@/components/docs/doc-shell"
import { Code, H2, H3, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("cli")

export default function Cli() {
  return (
    <DocShell slug="cli">
      <p>
        The package installs two commands, <code>ai-insights</code> and <code>hindsight</code>, which run the same program. With{" "}
        <code>npx</code> you do not need to install anything: <code>npx ai-insights &lt;command&gt;</code>.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights [options]          scan, write the report, print a summary
ai-insights scan [options]     scan and show what was found
ai-insights report [options]   write the report (or print JSON with --json)
ai-insights doctor             show which histories were found and where
ai-insights mcp                start the MCP server on stdio (for your agent)`}</Code>

      <H2 id="commands">Commands</H2>
      <H3 id="cmd-run">ai-insights</H3>
      <p>
        With no command, AI Insights scans, writes the report and prints a three-line summary, the report path, a history warning when one applies,
        and a tip until you have run the agent review. See <a href="/docs/getting-started#first-run">Your first run</a> for the output.
      </p>
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
      <Code label="Terminal">{`npx ai-insights report --json > report.json`}</Code>
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
      <H3 id="cmd-mcp">ai-insights mcp</H3>
      <p>
        Starts the MCP server on standard input and output. Your agent starts this for you once the plugin or server is installed; you do not run
        it by hand. See the <a href="/docs/mcp">MCP reference</a>.
      </p>
      <p>
        <code>help</code> is accepted as a command and prints the same text as <code>--help</code>.
      </p>

      <H2 id="options">Options</H2>
      <p>
        Options work with the default command, <code>scan</code> and <code>report</code>. Values can follow a space or an equals sign:{" "}
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
              year as 365), or from an ISO date like <code>2026-01-31</code>.
            </>,
          ],
          [
            <code key="h">--harness &lt;name&gt;</code>,
            <>
              Only one agent: <code>claude-code</code>, <code>codex</code>, <code>cursor</code>, <code>pi</code>, <code>opencode</code> or{" "}
              <code>gemini</code>.
            </>,
          ],
          [<code key="m">--max-sessions &lt;n&gt;</code>, "Read at most n transcripts, newest first. The default is 5,000; the most is 50,000."],
          [<code key="r">--refresh</code>, "Re-parse every transcript, ignoring the cache."],
          [<code key="j">--json</code>, <>With <code>report</code> only: print the report as JSON instead of writing HTML.</>],
          [<code key="o">--open</code>, "Open the written report in your default browser."],
          [<code key="hh">-h, --help</code>, "Show the help."],
          [<code key="v">-v, --version</code>, "Show the version."],
        ]}
      />
      <Code label="Examples">{`npx ai-insights --since 90d --open
npx ai-insights scan --harness codex
npx ai-insights --refresh`}</Code>

      <H2 id="environment">Environment variables</H2>
      <Table
        caption="Environment variables"
        head={["Variable", "Effect"]}
        rows={[
          [<code key="a">AI_INSIGHTS_HOME</code>, <>Where AI Insights keeps its cache, labels, snapshots and reports. Default <code>~/.ai-insights</code>.</>],
          [<code key="h">HINDSIGHT_HOME</code>, <>The pre-0.2 name, used when <code>AI_INSIGHTS_HOME</code> is not set.</>],
          [<code key="d">AI_INSIGHTS_DEBUG</code>, "When set, a failed command also prints the error's stack trace."],
          [
            "Agent variables",
            <>
              <code>CLAUDE_CONFIG_DIR</code>, <code>CODEX_HOME</code>, <code>OPENCODE_DB</code>, <code>PI_CODING_AGENT_DIR</code>,{" "}
              <code>CURSOR_CONFIG_DIR</code>, <code>GEMINI_CLI_HOME</code> and others move where history is read from. See{" "}
              <a href="/docs/agents#locations">Where each agent&apos;s history lives</a>.
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
              No sessions were found (the default command only), or the command failed. The message starts with <code>ai-insights:</code>.
            </>,
          ],
          [
            "2",
            <>
              A usage error: an unknown command or option, a missing or invalid value, or <code>--json</code> without <code>report</code>.
            </>,
          ],
        ]}
      />
      <Code label="Output" copy={false}>{`$ npx ai-insights --since 5x
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
