import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("agents")

export default function Agents() {
  return (
    <DocShell slug="agents">
      <H2 id="supported-agents">Supported agents</H2>
      <p>
        AI Insights reads six agents. &ldquo;Untested&rdquo; means the code exists and has tests on synthetic files, but nobody has confirmed it on
        that agent in daily use yet.
      </p>
      <Table
        caption="Supported agents"
        head={["Agent", "History", "Tokens and cost", "Skill install"]}
        rows={[
          ["Claude Code", "Read", "Yes", "Plugin"],
          ["Codex", "Read", "Yes", "Plugin"],
          ["OpenCode", "Read (the database needs Node 22.5 or later)", "Yes", "Untested"],
          ["Pi", "Read", "Yes", "Untested"],
          ["Cursor", "Read", "No: its local transcripts hold no token counts", "Untested"],
          ["Gemini CLI", "Untested: built from its source format, not yet tried on real history", "Yes", "None yet, use npx"],
        ]}
      />
      <p>
        Run <code>npx ai-insights doctor</code> to see which of these it found on your machine, where, how many transcripts and over which dates.
      </p>

      <H2 id="locations">Where each agent&apos;s history lives</H2>
      <p>These are the default places AI Insights looks. The environment variables are the ones each agent itself uses to move its files.</p>
      <Table
        caption="History locations"
        head={["Agent", "Default location", "Moved by"]}
        rows={[
          [
            "Claude Code",
            <>
              <code>~/.claude/projects</code> and <code>~/.config/claude/projects</code>, plus Claude Desktop&apos;s Code and Cowork session stores (
              <code>local-agent-mode-sessions</code> and <code>claude-code-sessions</code> in Claude Desktop&apos;s app data folder)
            </>,
            <>
              <code>CLAUDE_CONFIG_DIR</code> (then only <code>$CLAUDE_CONFIG_DIR/projects</code> is read for the CLI), <code>XDG_CONFIG_HOME</code>
            </>,
          ],
          [
            "Codex",
            <>
              <code>~/.codex/sessions</code> and <code>~/.codex/archived_sessions</code>, including compressed <code>.jsonl.zst</code> rollouts
            </>,
            <code key="c">CODEX_HOME</code>,
          ],
          [
            "OpenCode",
            <>
              <code>~/.local/share/opencode/opencode.db</code> (and channel databases such as <code>opencode-&lt;channel&gt;.db</code>), plus the
              older <code>storage/</code> files
            </>,
            <>
              <code>OPENCODE_DB</code>, <code>XDG_DATA_HOME</code>
            </>,
          ],
          [
            "Pi",
            <>
              <code>~/.pi/agent/sessions</code>, and OMP&apos;s <code>~/.omp/agent/sessions</code>, <code>~/.omp/profiles</code> and{" "}
              <code>~/.local/share/omp/</code>
            </>,
            <>
              <code>PI_CODING_AGENT_SESSION_DIR</code>, <code>PI_CODING_AGENT_DIR</code>, <code>PI_CONFIG_DIR</code>, <code>XDG_DATA_HOME</code>
            </>,
          ],
          [
            "Cursor",
            <>
              <code>~/.cursor/projects/*/agent-transcripts</code> (prompts and tool calls; no tokens)
            </>,
            <code key="c">CURSOR_CONFIG_DIR</code>,
          ],
          [
            "Gemini CLI",
            <>
              <code>~/.gemini/tmp/*/chats</code>
            </>,
            <code key="g">GEMINI_CLI_HOME</code>,
          ],
        ]}
      />
      <p>
        Claude Desktop&apos;s app data folder is <code>~/Library/Application Support/Claude</code> on macOS, <code>%APPDATA%\Claude</code> on Windows
        and <code>~/.config/Claude</code> on Linux.
      </p>

      <H2 id="what-is-kept">What is kept</H2>
      <p>
        From each transcript, AI Insights keeps numbers and metadata, and the prompts you typed. Everything below is stored only in your{" "}
        <code>~/.ai-insights/</code> folder.
      </p>
      <Table
        caption="What the cache keeps and drops"
        head={["Kept", "Not kept"]}
        rows={[
          ["When each session ran, how long, and in which project", "The agent's replies"],
          ["Token counts, models and estimated cost per request", "Tool output: file contents, command output, search results"],
          ["Which tools ran, failed or were declined, with shell commands redacted and cut to 300 characters", "Thinking text, images and attachments"],
          ["Your own prompts, secrets redacted and cut to 2,000 characters", "Anything needed to resume, rewind or replay a session"],
          ["Paths of files read or edited, lines changed, commits, skills, MCP servers and other feature use", ""],
          ["The session labels your agent saved, if you ran the agent review", ""],
        ]}
      />
      <p>
        During the <a href="/docs/agent-review">agent review</a>, your agent can ask for an excerpt of one session. That excerpt is read from the
        transcript on demand, redacted and cut to about 4,000 characters, and handed to your agent. It is not stored. See{" "}
        <a href="/docs/agent-review#what-the-model-sees">What your agent sees</a>.
      </p>

      <H2 id="retention">How long agents keep history</H2>
      <p>
        AI Insights can only look back as far as your agents keep their files. <code>doctor</code> prints what it found for each agent on a{" "}
        <code>keeps</code> line, and the report&apos;s &ldquo;Where your history lives&rdquo; section shows the same with links to each agent&apos;s
        docs.
      </p>
      <Table
        caption="Retention by agent"
        head={["Agent", "What it does by default", "Setting"]}
        rows={[
          [
            "Claude Code",
            "Deletes a transcript 30 days after it last changed, the next time it starts. Sessions started or last continued in Claude Desktop or Cowork are kept at any age (since v2.1.248).",
            <>
              <code>cleanupPeriodDays</code> in <code>~/.claude/settings.json</code>
            </>,
          ],
          [
            "Gemini CLI",
            "Deletes a project's chats 30 days after their last update, the next time it starts in that project.",
            <>
              <code>general.sessionRetention.maxAge</code> (or <code>enabled: false</code>) in <code>~/.gemini/settings.json</code>
            </>,
          ],
          ["Codex", "Keeps rollouts until you delete them.", "None needed"],
          ["OpenCode", "No automatic session cleanup.", "None needed"],
          ["Pi", "Keeps session files until you delete them.", "None needed"],
          ["Cursor", "Not documented; AI Insights reports it as unknown.", "Unknown"],
        ]}
      />
      <p>To keep a year of Claude Code transcripts, add this to the top-level object in <code>~/.claude/settings.json</code>:</p>
      <Code label="~/.claude/settings.json">{`{
  "cleanupPeriodDays": 365
}`}</Code>
      <p>
        When transcripts are due for deletion within 7 days, the command line and the report say how many, and the &ldquo;Keep your history&rdquo;
        finding lists the steps. Once a transcript is gone, AI Insights still has the stats it already read from it, but not the transcript.
      </p>
      <Callout title="Managed settings">
        <p>
          If your organization sets <code>cleanupPeriodDays</code> through Claude Code&apos;s managed settings, AI Insights says so and suggests
          asking an admin instead of editing your own file.
        </p>
      </Callout>

      <H2 id="limits">Limits</H2>
      <p>Every read is bounded, so a huge or malformed history cannot stall the run.</p>
      <ul>
        <li>
          A run reads the newest 5,000 transcripts by default. <code>--max-sessions</code> changes that, up to 50,000.
        </li>
        <li>
          Lines AI Insights does not understand are skipped and counted. <code>scan</code> shows the count as unreadable lines; a few are normal, many suggest an agent version newer than AI Insights knows.
        </li>
        <li>
          Per-session lists are capped, for example tool calls at 10,000 for Codex and 20,000 for the other agents. The cards then show the count as
          &ldquo;10,000+&rdquo;.
        </li>
        <li>
          Cursor sessions add no tokens or cost, because Cursor&apos;s local transcripts hold none.
        </li>
        <li>
          Models without a known price are counted as unpriced rather than guessed. See{" "}
          <a href="/docs/troubleshooting#unpriced">Cost says some requests are unpriced</a>.
        </li>
      </ul>
    </DocShell>
  )
}
