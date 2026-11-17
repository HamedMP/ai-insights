import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, DocLink, H2, H3, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("agent-review")

export default function AgentReview() {
  return (
    <DocShell slug="agent-review">
      <H2 id="two-layers">Two layers</H2>
      <p>The report has two layers, and only the first needs nothing but the command line.</p>
      <ol>
        <li>
          <strong>Deterministic.</strong> <code>npx ai-insights</code> counts everything: activity, the recap, tokens, cost and findings. No model
          is involved.
        </li>
        <li>
          <strong>Judged by your agent.</strong> The <code>analyze-ai-usage</code> skill has the agent you already use read short, redacted excerpts
          of a sample of sessions, label each one from a fixed list, and write a short narrative. The labels add &ldquo;Did it work?&rdquo;, the
          work areas, the wins and the judged causes in &ldquo;Why sessions go wrong&rdquo;.
        </li>
      </ol>
      <Callout title="AI Insights never calls a model">
        <p>
          The judgement runs in your own agent, under your existing account and settings. The package has no model API client, makes no network
          calls and uploads nothing. Your agent reaches your history only through the MCP server below, which runs on your machine.
        </p>
      </Callout>

      <H2 id="install">Install the plugin</H2>
      <p>
        Each install adds the same MCP server, <code>npx -y ai-insights mcp</code>, and three skills. Start a new session afterwards: agents usually
        load new tools and skills only at startup.
      </p>
      <H3 id="install-claude-code">Claude Code</H3>
      <Code label="Claude Code">{`/plugin marketplace add hamedmp/ai-insights
/plugin install ai-insights@ai-insights`}</Code>
      <H3 id="install-codex">Codex</H3>
      <Code label="Terminal">{`codex plugin marketplace add hamedmp/ai-insights
codex plugin add ai-insights@ai-insights`}</Code>
      <H3 id="install-pi">Pi (untested)</H3>
      <Code label="Terminal">pi install git:github.com/hamedmp/ai-insights</Code>
      <p>
        Pi loads the skills and registers the MCP server through the package&apos;s Pi extension. A Pi build without MCP support still loads the
        skills and shows a warning that the <code>ai_insights_*</code> tools are unavailable.
      </p>
      <H3 id="install-cursor-opencode">Cursor and OpenCode (untested)</H3>
      <p>From a clone of the repository, run the install script for that agent:</p>
      <Code label="Terminal">{`git clone https://github.com/hamedmp/ai-insights
cd ai-insights
scripts/install.sh --harness cursor     # or: --harness opencode`}</Code>
      <p>
        For Cursor it adds the server to <code>~/.cursor/mcp.json</code> and the skills to <code>~/.cursor/skills</code>. For OpenCode it copies
        the skills to <code>~/.agents/skills</code> and runs <code>opencode mcp add</code>.
      </p>
      <H3 id="install-several">Several agents at once</H3>
      <p>
        Run <code>scripts/install.sh</code> with no options. It finds the agents on your machine, copies the skills into each one and registers the
        MCP server with each agent&apos;s own <code>mcp add</code> command. It needs no root, writes only inside your home folder, and is safe to
        run again. Add <code>--dry-run</code> to see what it would do first. All options are in the{" "}
        <DocLink href="/docs/cli#install-script">CLI reference</DocLink>.
      </p>
      <H3 id="install-manual">By hand</H3>
      <p>If you prefer to register only the MCP server:</p>
      <Code label="Terminal">{`claude mcp add --scope user ai-insights -- npx -y ai-insights mcp
codex mcp add ai-insights -- npx -y ai-insights mcp
opencode mcp add ai-insights -- npx -y ai-insights mcp`}</Code>
      <p>
        For Cursor, add this under <code>mcpServers</code> in <code>~/.cursor/mcp.json</code>:
      </p>
      <Code label="~/.cursor/mcp.json">{`"ai-insights": { "command": "npx", "args": ["-y", "ai-insights", "mcp"] }`}</Code>

      <H2 id="skills">The three skills</H2>
      <Table
        caption="Skills"
        head={["Skill", "What it does"]}
        rows={[
          [
            <code key="a">analyze-ai-usage</code>,
            "Builds the report with your agent labelling a sample of sessions and writing a narrative, then names the three findings most worth acting on.",
          ],
          [
            <code key="c">ai-insights-coach</code>,
            "Turns findings into changes you review: edits to CLAUDE.md or AGENTS.md, settings, plugins. It shows each change as a diff and writes only after a yes for that change.",
          ],
          [
            <code key="s">ai-insights-setup</code>,
            "Checks that the MCP server answers, runs doctor, and explains which histories were found and what limits the report.",
          ],
        ]}
      />

      <H2 id="run-it">Run the review</H2>
      <p>
        In a new session, run <code>/analyze-ai-usage</code> or ask your agent to &ldquo;analyze my AI usage&rdquo;. The skill tells your agent to:
      </p>
      <ol>
        <li>Scan, and show you which agents and dates it covers.</li>
        <li>Read the summary and findings.</li>
        <li>
          List sessions that still need a label, spread across your agents and the whole period rather than only the newest, and label at most 30
          in one run. It skips sessions still running, slash-command-only sessions and sessions with fewer than 2 prompts, and tells you how many it
          skipped. Labels are saved in batches, so an interrupted run keeps its progress.
        </li>
        <li>Write a narrative from the digest of all labels, replacing any earlier narrative.</li>
        <li>Render the report and give you its path and <code>file://</code> link.</li>
        <li>Close with the three most useful findings and offer the coach.</li>
      </ol>
      <p>
        Running the skill again continues where it stopped: labelled sessions are not judged again unless they changed since (for example, a
        session that was still running when it was labelled).
      </p>

      <H2 id="what-the-model-sees">What your agent sees</H2>
      <p>Your agent sees only what the MCP tools return:</p>
      <ul>
        <li>The numbers and findings, with session ids as evidence.</li>
        <li>
          Session listings with counts and the first prompt, cut to 160 characters and redacted. Project paths are shown with your home folder as{" "}
          <code>~</code>.
        </li>
        <li>
          <strong>Excerpts</strong> of one session at a time, about 4,000 characters by default. An excerpt is the only place your agent sees the
          other agent&apos;s replies and tool output: your prompts, messages from other agents, tool errors and the final reply are kept first, and
          routine tool output is cut first. Excerpts are read from the transcript on demand, redacted, and not stored by AI Insights.
        </li>
      </ul>
      <p>
        The tools tell your agent that excerpt text is data, not instructions, and the skill tells it never to copy a secret into a label even if
        redaction missed it. Redaction is pattern-based; see <DocLink href="/docs/privacy#redaction">Redaction</DocLink>.
      </p>

      <H2 id="facets">Session labels</H2>
      <p>
        Each labelled session gets one facet, saved under <code>~/.ai-insights/facets/</code>. Values outside the fixed lists are rejected, so
        charts stay comparable from run to run.
      </p>
      <Table
        caption="Facet fields"
        head={["Field", "Values"]}
        rows={[
          ["underlyingGoal, summary, frictionDetail", "Short sentences in plain words."],
          [
            "goalCategories",
            "1 to 5 of: feature, bug_fix, refactor, tests, review, debugging, research, planning, docs, devops, git_and_prs, data_analysis, configuration, writing, orchestration, tooling, other",
          ],
          ["sessionType", "single_task, multi_task, iterative_refinement, exploration, quick_question"],
          ["outcome", "fully_achieved, mostly_achieved, partially_achieved, not_achieved, in_progress, unclear"],
          ["helpfulness", "essential, very_helpful, moderately_helpful, slightly_helpful, unhelpful"],
          ["satisfaction", "satisfied, likely_satisfied, neutral, dissatisfied, unclear"],
          [
            "frictions",
            "A count per type: misunderstood_request, wrong_approach, buggy_code, incomplete_work, ignored_instructions, over_engineering, permission_block, tool_failure, environment_issue, external_blocker, context_loss, slow_or_stuck",
          ],
          [
            "primarySuccess",
            "null, or one of: correct_code_edits, multi_file_changes, good_debugging, fast_accurate_search, good_explanations, proactive_help, good_planning, autonomous_execution",
          ],
          ["drivenBy", "person, agent, mixed (optional)"],
        ]}
      />
      <p>
        The narrative has a headline, work areas, your interaction style, wins, frictions, suggestions and &ldquo;horizon&rdquo; ideas with starter
        prompts. Suggestion text meant for pasting is rejected if it holds a placeholder such as <code>&lt;n&gt;</code> or an ellipsis. Tool
        details are in the <DocLink href="/docs/mcp">MCP reference</DocLink>.
      </p>
    </DocShell>
  )
}
