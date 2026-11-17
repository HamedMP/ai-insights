import { DocShell } from "@/components/docs/doc-shell"
import { Code, DocLink, H2, H3, Table } from "@/components/docs/prose"
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
ai-insights mcp                start the MCP server on stdio (for your agent)
ai-insights import claude <path>  add a Claude chat export`}</Code>

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
        At the end it asks <code>Open the report in your browser? [Y/n]</code>: Enter or <code>y</code> opens it, <code>n</code> does not, and
        Ctrl-C exits. It asks only when you are at a terminal: never when stdin or stdout is piped, in CI (<code>CI</code> set), or over SSH
        without a forwarded display, and never for <code>scan</code>, <code>report</code>, <code>doctor</code> or <code>mcp</code>. So an agent or
        a script running it never waits on the question. <code>--open</code>, <code>--no-open</code> and <code>AI_INSIGHTS_OPEN</code> skip it.
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
        it by hand. See the <DocLink href="/docs/mcp">MCP reference</DocLink>.
      </p>
      <H3 id="cmd-import">ai-insights import</H3>
      <p>
        Adds the history of a chat product from its data export. Chat exports are never looked for on their own: you point AI Insights at the
        file. See <DocLink href="/docs/import">Import chat history</DocLink> for what is read and what cannot be measured.
      </p>
      <Code label="Usage" copy={false}>{`ai-insights import claude <path>    the export .zip, its unzipped folder, or conversations.json
ai-insights import --list           show what has been imported
ai-insights import --remove claude  remove the import and everything made from it`}</Code>
      <p>
        A newer import replaces the earlier one. Imported conversations then appear in every run as their own agent, <code>claude-chat</code>{" "}
        (Claude chat).
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
              Only one agent: <code>claude-code</code>, <code>codex</code>, <code>cursor</code>, <code>pi</code>, <code>opencode</code>,{" "}
              <code>gemini</code> or <code>claude-chat</code> (an imported Claude chat export).
            </>,
          ],
          [<code key="m">--max-sessions &lt;n&gt;</code>, "Read at most n transcripts, newest first. The default is 5,000; the most is 50,000."],
          [<code key="r">--refresh</code>, "Re-parse every transcript, ignoring the cache."],
          [<code key="j">--json</code>, <>With <code>report</code> only: print the report as JSON instead of writing HTML.</>],
          [<code key="o">--open</code>, "Open the written report in your default browser without asking."],
          [<code key="no">--no-open</code>, "Do not ask whether to open the report, and do not open it."],
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
            <code key="ao">AI_INSIGHTS_OPEN</code>,
            <>
              <code>1</code> opens the report without asking, <code>0</code> never asks. <code>--open</code> and <code>--no-open</code> win over it.
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
