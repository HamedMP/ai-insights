import { DocShell } from "@/components/docs/doc-shell"
import { Code, DocLink, H2, Shot } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"
import { SAMPLE } from "@/lib/site"

export const metadata = docMetadata("")

export default function DocsHome() {
  return (
    <DocShell slug="">
      <p>
        AI Insights reads the history your AI coding agents already keep on your computer (Claude Code, Codex, Cursor, Pi, OpenCode and Gemini
        CLI) and turns it into one HTML page: a recap of animated cards you can post, and a private analysis of what to change. It runs on your
        machine, makes no network calls and never calls a model API.
      </p>
      <Code label="Terminal">npx ai-insights</Code>
      <p>
        That is the whole install. You need Node.js 20 or newer. The rest of these docs explain what the page shows, what the tool reads, and the
        optional parts: an agent review that adds judgement to the numbers, and a public leaderboard you can join from the website.
      </p>

      <H2 id="what-you-get">What you get</H2>
      <ul>
        <li>
          <strong>A recap to share.</strong> Up to 25 animated cards about how you work, in three styles and four shapes, with video and image
          export. Cards hold counts and a few allowlisted words, never your prompts, paths or project names. See <DocLink href="/docs/recap-cards">Recap cards</DocLink>.
        </li>
        <li>
          <strong>A private analysis.</strong> Your rhythm, parallel sessions on a timeline, tokens and an estimated cost at API list prices,
          findings with the evidence behind them, and the changes ranked, each with text you can paste into <code>CLAUDE.md</code> or{" "}
          <code>AGENTS.md</code>. See <DocLink href="/docs/report">The report</DocLink>.
        </li>
        <li>
          <strong>Change over time.</strong> Every run saves a small snapshot. The next run shows what changed: findings that look resolved, still
          open, or new.
        </li>
      </ul>
      <Shot
        src="/media/report-studio.webp"
        width={1400}
        height={1094}
        alt="The card studio in a report: card thumbnails in a grid, with shape, platform and export controls above them."
        caption="The card studio, from the sample report. The sample is built from invented sessions."
      />
      <p>
        You can open the <a href={SAMPLE}>sample report</a> to click around before you run it on your own history.
      </p>

      <H2 id="how-it-works">How it works</H2>
      <ol>
        <li>
          <strong>Read.</strong> AI Insights finds each agent&apos;s transcripts and parses them into sessions: numbers, tool metadata and the prompts
          you typed, with secrets redacted. It does not keep the agent&apos;s replies or tool output.
        </li>
        <li>
          <strong>Count.</strong> From those sessions it computes activity, the recap, token usage, cost and findings. No model is involved, so the same
          history always gives the same result.
        </li>
        <li>
          <strong>Write.</strong> It writes one self-contained HTML file to <code>~/.ai-insights/reports/report.html</code>. The page loads nothing
          from the network.
        </li>
        <li>
          <strong>Optionally, review.</strong> From inside your agent, the <code>analyze-ai-usage</code> skill has your own agent read short,
          redacted excerpts of a sample of sessions, label each one from a fixed list, and write a short narrative. The next report includes it.
          See <DocLink href="/docs/agent-review">The agent review</DocLink>.
        </li>
      </ol>

      <H2 id="when-not-to-use-it">What it is not</H2>
      <ul>
        <li>
          <strong>Not a monitor.</strong> It reads files after the fact. It does not watch your agents or run in the background.
        </li>
        <li>
          <strong>Not a bill.</strong> Cost is an estimate at API list prices. If you pay through a subscription, your real spend is different.
        </li>
        <li>
          <strong>Not a backup.</strong> It can only look back as far as your agents keep their files, and it keeps the stats of deleted sessions,
          not the transcripts. See <DocLink href="/docs/agents#retention">How long agents keep history</DocLink>.
        </li>
        <li>
          <strong>Not verified.</strong> Leaderboard numbers are self-reported. The site checks the format of what you publish, not that it is true.
        </li>
      </ul>

      <H2 id="next">Next</H2>
      <div className="docs-cards">
        <a className="docs-card" href="/docs/getting-started">
          <strong>Getting started</strong>
          Run it, read the output, find the report.
        </a>
        <a className="docs-card" href="/docs/agents">
          <strong>What it reads</strong>
          Every supported agent and where its history lives.
        </a>
        <a className="docs-card" href="/docs/agent-review">
          <strong>The agent review</strong>
          Install the plugin and let your own agent add judgement.
        </a>
        <a className="docs-card" href="/docs/privacy">
          <strong>Privacy</strong>
          What stays local, and exactly what a share link holds.
        </a>
      </div>
    </DocShell>
  )
}
