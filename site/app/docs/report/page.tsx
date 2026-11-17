import { DocShell } from "@/components/docs/doc-shell"
import { Callout, H2, H3, Shot, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("report")

const FINDINGS: Array<[string, string, string]> = [
  [
    "`<command>` keeps failing",
    "The same shell command failed 3 or more times in a row (in 2 or more sessions, or 5 times in one), or it failed in 3 or more sessions at an 80% failure rate or worse. Timeouts count.",
    "Tell the agent how this command should be run",
  ],
  [
    "You keep telling the agent: “…”",
    "A prompt of 3 to 40 words, or one close to it, was typed in 4 or more sessions on 3 or more different days.",
    "Write it down once",
  ],
  [
    "Corrections often come late",
    "3 or more times, in 2 or more sessions you drove, you stepped in after the agent had worked alone for 10 minutes or more.",
    "Agree on the plan before long runs",
  ],
  [
    "You interrupt the agent a lot",
    "10 or more prompts sent while the agent was still working, in 3 or more sessions, at 15% of your prompts or more.",
    "Front-load the request",
  ],
  [
    "Sessions often run out of context",
    "5 or more context compactions across 3 or more sessions.",
    "Hand off instead of compacting",
  ],
  [
    "Some sessions run very long",
    "3 or more sessions with 150 or more active minutes or 80 or more prompts.",
    "Split at natural checkpoints",
  ],
  [
    "<agent> reads little from the prompt cache",
    "Under 50% of input read from the cache across 1 million or more input tokens, where reaching 80% would have saved $5 or more at list prices.",
    "Keep the cache warm",
  ],
  [
    "Top-tier models answer quick questions",
    "8 or more quick sessions (3 prompts or fewer, 5 tool calls or fewer, 10 active minutes or fewer, 20 changed lines or fewer) ran on a top-tier model.",
    "Match the model to the task",
  ],
  [
    "Code gets committed without a test run",
    "3 or more sessions, and 25% or more of the sessions that commit, changed 50 or more lines over 3 or more edits and committed without running tests or a type check.",
    "Make checks part of done",
  ],
  [
    "<agent> keeps asking about the same commands, or keeps hitting permission walls",
    "10 or more tool calls blocked or refused, across 3 or more sessions, at 1 or more per 100 tool calls. The same safe command blocked 5 or more times in 2 or more sessions is named.",
    "Allow the commands you keep approving, or Tune permissions once",
  ],
  [
    "<tool> fails <n>% of the time",
    "One tool failed 8 or more times in 20 or more calls, at a 20% error rate or worse, across 2 or more sessions. The suggestion depends on why it failed.",
    "Re-read before editing, Describe the project layout, Stop files changing under the agent, Run long commands differently, Read big files in pieces, or Look at why this tool fails",
  ],
  [
    "You have not used <feature>",
    "With 10 or more sessions, a feature that would have helped in 2 or more of them was not used: subagents for long exploration, plan mode for big changes, MCP servers for services you call from the shell, skills for long prompts you repeat.",
    "Delegate exploration to a subagent, Start big changes in plan mode, Connect the services you use, Turn your long prompts into skills",
  ],
  [
    "All of this history is from <agent>",
    "5 or more sessions, all from one agent.",
    "Compare with a second agent",
  ],
  [
    "Keep your history",
    "An agent will delete transcripts within 7 days, deletes them at its default age, or your history goes back less than 32 days.",
    "Steps: keep transcripts longer, archive them compactly, keep them across machines",
  ],
  [
    "Agent history takes <n> MB on disk",
    "The transcripts AI Insights read take 500 MB or more.",
    "Compress and save disk space",
  ],
]

export default function Report() {
  return (
    <DocShell slug="report">
      <p>
        The report is one HTML file, <code>~/.ai-insights/reports/report.html</code>. Everything on it is computed from your history without a
        model, except the parts marked as coming from your agent, which appear only after you run the <a href="/docs/agent-review">agent review</a>.
      </p>

      <H2 id="layout">How the page is laid out</H2>
      <ol>
        <li>
          <strong>The recap.</strong> A headline with your hours and how many agents ran at once at the peak, a player for your recap cards, and the{" "}
          <a href="/docs/recap-cards#studio">card studio</a> where you pick cards, a shape and a style, export them, and make a{" "}
          <a href="/docs/sharing#share-links">share link</a>.
        </li>
        <li>
          <strong>How it actually went.</strong> The private analysis, in five numbered parts: Rhythm, How you work, What it cost, What went wrong,
          and Where your history lives.
        </li>
        <li>
          <strong>Start with these three.</strong> The changes worth making first, ranked, each with its type (Instructions, Feature, Plugin, Habit,
          Model choice), a copy button for text you can paste, and whether it is new or still open since your last run. More ideas and{" "}
          &ldquo;Bigger moves&rdquo; with starter prompts follow.
        </li>
        <li>
          <strong>Since your last run.</strong> Appears from your second run. See <a href="#over-time">below</a>.
        </li>
      </ol>

      <H2 id="how-it-went">How it actually went</H2>
      <H3 id="rhythm">01 Rhythm</H3>
      <p>
        Messages by hour in your time zone, a calendar of active days, and, under &ldquo;More detail&rdquo;, weekdays and how fast you reply to a
        finished turn. The calendar can show messages, agent time or cost.
      </p>
      <Shot
        src="/media/report-time.webp"
        width={1400}
        height={853}
        alt="The Rhythm section: a chart of messages by hour and a calendar of active days."
        caption="Rhythm, from the sample report (invented sessions)."
      />
      <H3 id="how-you-work">02 How you work</H3>
      <p>
        Your <a href="#ratios">work ratios</a> and any <a href="#titles">titles</a> they earned, a &ldquo;Side by side&rdquo; timeline of parallel
        sessions on your busiest days, delegation to other agents, and &ldquo;Did it work?&rdquo; once your agent has labelled sessions. More detail
        covers tool calls by kind, projects by agent time (your home folder shown as <code>~</code>), MCP servers, skills, thinking and approvals,
        and the work areas your agent saw.
      </p>
      <H3 id="what-it-cost">03 What it cost</H3>
      <p>
        The estimated cost at API list prices, tokens, how much input came from the prompt cache, cost per day and a sortable table by model. See{" "}
        <a href="#cost">Cost and unpriced models</a>.
      </p>
      <H3 id="what-went-wrong">04 What went wrong</H3>
      <p>
        <a href="#why-sessions-go-wrong">Why sessions go wrong</a>, why tool calls failed, the programs that failed most, and the{" "}
        <a href="#findings">findings</a>, filterable by severity.
      </p>
      <H3 id="where-your-history-lives">05 Where your history lives</H3>
      <p>
        How long each agent keeps its transcripts, how many are due for deletion, and the steps that keep them. See{" "}
        <a href="/docs/agents#retention">How long agents keep history</a>.
      </p>

      <H2 id="findings">Findings</H2>
      <p>
        A finding is a pattern in your history with the evidence behind it: the sessions, the counts and, where it helps, a timestamp your agent
        can open. Each has a severity (high, medium, low or info), up to 5 pieces of evidence, and a suggestion. A detector that trips over odd data
        is dropped on its own; it never costs you the whole report. These are all the findings and when they appear:
      </p>
      <Table caption="Findings" head={["Finding", "Appears when", "Suggestion"]} rows={FINDINGS.map(([title, when, fix]) => [title, when, fix])} />
      <p>
        Suggestions of the Instructions type come with text to paste into <code>CLAUDE.md</code> or <code>AGENTS.md</code>. Text with a placeholder
        such as <code>&lt;n&gt;</code> or an ellipsis is never offered for pasting.
      </p>

      <H2 id="why-sessions-go-wrong">Why sessions go wrong</H2>
      <p>
        This panel groups sessions by the kind of trouble they showed. A session counts under every cause it shows a sign of, so the shares can add
        up to more than 100%. It is a count of sessions, not a diagnosis. It appears once there are 10 sessions; the causes your agent judges
        appear once it has labelled 10 of them.
      </p>
      <Table
        caption="Causes and their signs"
        head={["Cause", "Signs counted"]}
        rows={[
          ["Not enough context given", "You typed an instruction you also typed in other sessions, or the agent looked for 2 or more files that were not there."],
          ["Request misread or unclear", "Your agent judged it misunderstood the request. Only the agent review can see this."],
          ["Context ran out", "The session was compacted, or your agent judged context was lost."],
          [
            "Tool or environment failures",
            "3 or more failed tool calls (edits, reads, timeouts; not permissions, missing files or a command's own exit code), the same command failing 3 or more times in a row, or your agent judged a tool, the environment or something outside failed.",
          ],
          ["Permissions and approvals", "2 or more tool calls blocked by permissions, refused at a prompt or stopped by an automatic reviewer, or your agent judged a permission blocked it."],
          [
            "Agent went off course",
            "You stepped in while the agent was working (twice, or once after 10 or more minutes alone), or your agent judged it took a wrong approach, ignored instructions, over-engineered, wrote buggy code, left the work incomplete, or was slow or stuck.",
          ],
        ]}
      />
      <p>Each cause shows its signs, up to two sessions as evidence, and a fix: the matching finding&apos;s suggestion when there is one.</p>

      <H2 id="ratios">Work ratios</H2>
      <p>
        Five ratios describe how you work. None grows by spending more tokens, and each shows the counts behind it under &ldquo;What each ratio
        counts&rdquo;. A session &ldquo;you drove&rdquo; is one where you typed and no other agent sent more messages than you.
      </p>
      <Table
        caption="Work ratios"
        head={["Ratio", "What it counts"]}
        rows={[
          ["Mid-run corrections", "Prompts you sent while the agent was still working on its turn, per session you drove."],
          ["Sessions that hit a context reset", "Sessions compacted at least once because the conversation outgrew the context window, out of all sessions."],
          ["Tool-call error rate", "Tool calls that came back with an error (a failed command, a missing file, a refusal), out of all tool calls."],
          [
            "Started with a plan",
            "Sessions you drove that changed files and began from plan mode, a plan step before the first edit, or a written brief, out of sessions you drove that changed files.",
          ],
          ["Sessions running at once", "Active time summed over every session, divided by the clock time when at least one was active. 2× means two at once on average."],
        ]}
      />

      <H2 id="titles">Earned titles</H2>
      <p>
        Titles come from the ratios with fixed rules, so the same numbers always earn the same titles. Each pair names two ways of working, both
        fine. A ratio needs enough data before it can earn anything, earns at most one title, and you hold at most three. Rules are checked in this
        order:
      </p>
      <Table
        caption="Title rules"
        head={["Title", "Earned when", "Needs at least"]}
        rows={[
          ["The Clear Briefer", "0.10 or fewer mid-run corrections per session", "10 sessions you drove"],
          ["The Hands-On Pilot", "1 or more mid-run corrections per session", "10 sessions you drove"],
          ["The Architect", "Half or more of the sessions that edited files started with a plan", "10 sessions that edited files"],
          ["The Improviser", "10% or fewer of the sessions that edited files started with a plan", "10 sessions that edited files"],
          ["The Conductor", "2 or more sessions running at once on average", "5 clock hours"],
          ["The Deep Focuser", "1.1 or fewer sessions running at once on average", "5 clock hours"],
          ["The Context Keeper", "5% or fewer of sessions hit a context reset", "10 sessions"],
          ["The Deep Diver", "30% or more of sessions hit a context reset", "10 sessions"],
          ["The Smooth Operator", "3% or fewer of tool calls failed", "200 tool calls"],
          ["The Stress Tester", "15% or more of tool calls failed", "200 tool calls"],
        ]}
      />
      <p>Titles appear in the report, on a &ldquo;Titles earned&rdquo; card, and, if you publish, on your profile.</p>

      <H2 id="persona">Persona</H2>
      <p>The persona card names you from two rules over your numbers. No model is involved.</p>
      <ul>
        <li>
          <strong>The time word</strong> comes from when you prompt: <em>Night</em> when 20% or more of your prompts fall between 22:00 and 04:59
          and under 5% between 05:00 and 09:59; <em>Dawn</em> when 20% or more fall between 05:00 and 09:59; otherwise by your busiest hour:{" "}
          <em>Golden-Hour</em> from 17:00, <em>Afternoon</em> from 12:00, <em>Morning</em> before that.
        </li>
        <li>
          <strong>The role</strong> is <em>Orchestrator</em> when 5 or more agents ran at once or your sessions averaged one subagent or more each;{" "}
          <em>Shipper</em> when 40% or more of your sessions ended in a commit; otherwise <em>Delegator</em>.
        </li>
      </ul>
      <p>
        So you might be The Night Orchestrator or The Morning Shipper. When your agent has labelled sessions, the reason line adds how many hit
        their goal.
      </p>

      <H2 id="cost">Cost and unpriced models</H2>
      <p>
        Cost is an estimate: tokens times the public API list price of each model at the time of each request, from a pricing table built into
        the package (the report names its version). It is not what you paid. On a subscription or a coding plan your real spend is different.
      </p>
      <ul>
        <li>
          Models without an exact entry in the table are <strong>unpriced</strong>: they are left out of the estimate and counted, rather than
          given a guessed price. The report says what share of requests was unpriced.
        </li>
        <li>
          Where an agent records its own cost per request, the report shows that recorded spend separately. A recorded $0 usually means a
          subscription, not free use.
        </li>
        <li>Cursor sessions have no token counts, so they add no cost.</li>
      </ul>
      <Shot
        src="/media/report-cost.webp"
        width={1400}
        height={536}
        alt="The What it cost section: estimated cost, tokens and cache share."
        caption="What it cost, from the sample report (invented sessions)."
      />

      <H2 id="over-time">Since your last run</H2>
      <p>
        Every run saves a small snapshot in <code>~/.ai-insights/snapshots/</code>. Two runs within 10 minutes of each other count as one; the later
        replaces the earlier. From your second run the report shows:
      </p>
      <ul>
        <li>a timeline of your runs, with how many days of history each covered;</li>
        <li>trends across runs: failed tool calls, passing test runs, compactions per session, input read from cache, cost and prompts;</li>
        <li>findings since the previous run, grouped as looks resolved, still open, and new.</li>
      </ul>
      <Callout title="Snapshots keep no prompt text">
        <p>
          A finding built from your own words (&ldquo;You keep telling the agent&rdquo;) is saved in a snapshot as a hash and a fixed title, so the
          snapshot never holds the prompt itself.
        </p>
      </Callout>
      <Shot
        src="/media/report-change.webp"
        width={1400}
        height={1006}
        alt="The Since your last run section: run history, trend charts, and findings grouped as resolved, still open and new."
        caption="Since your last run, from the sample report (invented sessions)."
      />
    </DocShell>
  )
}
