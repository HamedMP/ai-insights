import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, DocLink, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("mcp")

type Param = [string, string, string]

function Params({ rows, name }: { rows: Param[]; name: string }) {
  return (
    <Table
      caption={`${name} parameters`}
      head={["Parameter", "Type", "Description"]}
      rows={rows.map(([param, type, desc]) => [<code key={param}>{param}</code>, type, desc])}
    />
  )
}

const HARNESS = "claude-code, codex, cursor, pi, opencode or gemini"

export default function Mcp() {
  return (
    <DocShell slug="mcp">
      <H2 id="server">The server</H2>
      <p>
        <code>ai-insights mcp</code> is a Model Context Protocol server over standard input and output, named <code>ai-insights</code>. The plugin
        and the install script register it as:
      </p>
      <Code label="MCP server config">{`{
  "mcpServers": {
    "ai-insights": {
      "command": "npx",
      "args": ["-y", "ai-insights", "mcp"]
    }
  }
}`}</Code>
      <p>
        Every tool reads local files and none reaches the network; each declares <code>openWorldHint: false</code>. Your agent may show the tools
        with a prefix, such as <code>mcp__ai-insights__ai_insights_scan</code>. Tools return JSON as text. A failed call returns a short error
        saying what went wrong.
      </p>
      <Callout title="The tools share one scan">
        <p>
          Later tools use the most recent <code>ai_insights_scan</code>. If none has run, the first tool that needs one scans with the defaults.
          Call <code>ai_insights_scan</code> again to change the window or the agent filter.
        </p>
      </Callout>

      <H2 id="flow">Typical flow</H2>
      <ol>
        <li>
          <code>ai_insights_scan</code>
        </li>
        <li>
          <code>ai_insights_report</code> for the findings
        </li>
        <li>
          <code>ai_insights_sessions</code> with <code>missingFacets: true</code>
        </li>
        <li>
          <code>ai_insights_excerpt</code> and <code>ai_insights_save_facets</code> for each session
        </li>
        <li>
          <code>ai_insights_save_narrative</code>
        </li>
        <li>
          <code>ai_insights_render</code>
        </li>
      </ol>
      <p>
        The <code>analyze-ai-usage</code> skill walks your agent through exactly this. See <DocLink href="/docs/agent-review#run-it">Run the review</DocLink>.
      </p>

      <H2 id="ai_insights_scan">ai_insights_scan</H2>
      <p>
        Start here. Finds and parses local transcripts (cached, so repeat calls are fast) and returns which agents were found, how far back history
        goes, headline numbers, the number of findings, and how many sessions already have labels, need one, or changed since they were labelled.
      </p>
      <Params
        name="ai_insights_scan"
        rows={[
          ["since", "string", "Only history from a window like 30d, 12w, 6m or 1y, or an ISO date."],
          ["harness", "string", `Only one agent: ${HARNESS}.`],
          ["maxSessions", "integer, 1 to 50,000", "Read at most this many transcripts, newest first. Default 5,000."],
          ["refresh", "boolean", "Re-parse every transcript, ignoring the cache."],
        ]}
      />

      <H2 id="ai_insights_report">ai_insights_report</H2>
      <p>
        The computed report for the current scan as JSON, with no model involved. Ask only for the sections you need. Findings carry evidence with
        session ids you can pass to <code>ai_insights_excerpt</code>, most severe first. Read-only.
      </p>
      <Params
        name="ai_insights_report"
        rows={[
          [
            "sections",
            "array",
            "Any of summary, coverage, activity, usage, findings, facets, narrative, recap. Default summary and findings.",
          ],
          [
            "detail",
            "digest or full",
            "Shape of the facets, activity, usage and recap sections. The digest (default) holds top-N lists and weekly series, about 3,000 characters for facets, activity and usage together; full holds every list and the daily series.",
          ],
          ["findingsLimit", "integer, 1 to 100", "Most findings to return. Default 20."],
          ["evidenceLimit", "integer, 0 to 20", "Evidence items per finding. Default 5."],
          ["weeks", "integer, 1 to 60", "Digest only: most recent weeks in weekly series. Default 8."],
          ["days", "integer, 1 to 400", "Full only: most recent days kept in daily series. Default 60."],
        ]}
      />

      <H2 id="ai_insights_sessions">ai_insights_sessions</H2>
      <p>
        Sessions from the current scan with counts, whether a label (facet) is saved, whether the session is still running, whether another agent
        drove it, and its first prompt, redacted and cut to 160 characters. Paginate with <code>offset</code>; the order is stable while the set is
        unchanged. Read-only.
      </p>
      <Params
        name="ai_insights_sessions"
        rows={[
          ["harness", "string", `Only one agent: ${HARNESS}.`],
          [
            "missingFacets",
            "boolean",
            "Only sessions that need a label: none saved yet, or one that is stale (judged while running, or the session has grown since).",
          ],
          ["includeStale", "boolean", "With missingFacets: also offer sessions whose label is stale. Default true."],
          [
            "strategy",
            "spread or newest",
            "spread: proportional across agents and time, at least one per agent. newest: newest first. Default spread with missingFacets, else newest.",
          ],
          [
            "minUserMessages",
            "integer, 0 to 10,000",
            "Skip sessions with fewer prompts than this, counting yours and other agents'. Default 2 with missingFacets, else 0.",
          ],
          ["includeLive", "boolean", "With missingFacets: include sessions still running. Default false."],
          ["includeSlashCommandOnly", "boolean", "With missingFacets: include sessions that were only slash commands. Default false."],
          ["limit", "integer, 1 to 100", "Page size. Default 20."],
          ["offset", "integer", "Skip this many matching sessions."],
        ]}
      />
      <p>With <code>missingFacets</code>, the response also says how many sessions it skipped and why.</p>

      <H2 id="ai_insights_excerpt">ai_insights_excerpt</H2>
      <p>
        A redacted, truncated slice of one session&apos;s transcript plus its numbers. Turns are labelled <code>user</code> (you),{" "}
        <code>agent</code> (a message another agent or automation sent), <code>assistant</code> and <code>tool</code>. Your prompts, agent
        messages, tool errors and the final reply are kept first; routine tool output is cut first. The text is read from the transcript on
        demand and not stored. Read-only.
      </p>
      <Params
        name="ai_insights_excerpt"
        rows={[
          ["sessionId", "string, required", "A session id from ai_insights_sessions or a finding's evidence."],
          ["harness", "string", `The session's agent, when an id could be ambiguous: ${HARNESS}.`],
          ["maxTurns", "integer, 1 to 80", "Turns to sample. Default 24."],
          ["maxCharsPerTurn", "integer, 100 to 4,000", "Characters per turn. Default 600."],
          [
            "maxChars",
            "integer, 500 to 40,000",
            "Size budget for the whole response. Default 4,000; when maxCharsPerTurn is given, maxTurns × maxCharsPerTurn if that is larger.",
          ],
          ["around", "ISO timestamp", "Keep the turns closest to this moment, for example a finding's evidence timestamp."],
        ]}
      />
      <p>A trimmed response from a synthetic session:</p>
      <Code label="Response, from a synthetic session; trimmed" copy={false}>{`{
  "session": { "sessionId": "00000011-2222-4333-8444-555555555555", "harness": "claude-code",
               "project": "work/acme-api", "durationMinutes": 11, "userMessages": 3,
               "toolCalls": 3, "toolErrors": 1, "hasFacet": false, … },
  "turns": [
    { "role": "user", "text": "run the tests and fix what fails", … },
    { "role": "tool", "toolName": "Bash", "text": "pnpm test", … },
    { "role": "tool", "toolName": "Bash", "isError": true, "text": "pnpm test → 1 failed", … },
    { "role": "assistant", "text": "Done.", … },
    …
  ]
}`}</Code>

      <H2 id="ai_insights_save_facets">ai_insights_save_facets</H2>
      <p>
        Saves your agent&apos;s judgement of one or more sessions, one facet per session, from the fixed lists in{" "}
        <DocLink href="/docs/agent-review#facets">Session labels</DocLink>. Valid facets are saved even if others in the batch are rejected; each rejection
        says what to fix. Saving again overwrites. The response lists what was saved and rejected, how many sessions still need a label, and how
        many were held back.
      </p>
      <Params
        name="ai_insights_save_facets"
        rows={[
          [
            "facets",
            "array of 1 to 50 objects",
            "Each with sessionId, harness, underlyingGoal, goalCategories, sessionType, outcome, helpfulness, satisfaction, primarySuccess, frictions, frictionDetail and summary; drivenBy is optional.",
          ],
        ]}
      />

      <H2 id="ai_insights_save_narrative">ai_insights_save_narrative</H2>
      <p>
        Saves the narrative for the report. Saving again replaces it. A suggestion whose <code>instructionText</code> holds an angle-bracket
        placeholder or an ellipsis is rejected, because that text is pasted into an instructions file as is.
      </p>
      <Params
        name="ai_insights_save_narrative"
        rows={[
          [
            "narrative",
            "object",
            "headline (2 or 3 sentences); workAreas (name, sessions, description; at most 12); interactionStyle; wins (title, description); frictions (title, description, examples); suggestions (type, title, action, and optionally instructionText, an http or https url, and findingId; at most 15); horizon (title, description, starterPrompt; at most 8).",
          ],
        ]}
      />

      <H2 id="ai_insights_render">ai_insights_render</H2>
      <p>
        Builds the report from the current scan plus saved labels and narrative, writes the HTML file, and returns its path and{" "}
        <code>file://</code> URL, the session and label counts, the headline numbers, and the top three findings with their suggested actions. It
        takes no parameters and works before the agent review too, with the deterministic sections only.
      </p>
      <Code label="Response, from a synthetic history; home folder shortened to ~; trimmed" copy={false}>{`{
  "path": "~/.ai-insights/reports/report.html",
  "url": "file://~/.ai-insights/reports/report.html",
  "sessions": 12,
  "sessionsWithFacets": 0,
  "hasNarrative": false,
  "headline": { "activeHours": 2.2, "agentHours": 2.2, "activeDays": 12,
                "cost": "about $1.13 at API list prices", … },
  "topFindings": [ { "title": "You keep telling the agent: \\"run the tests and fix what fails\\"",
                     "severity": "medium", … } ]
}`}</Code>
    </DocShell>
  )
}
