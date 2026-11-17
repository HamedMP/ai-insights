import { DocShell } from "@/components/docs/doc-shell"
import { Callout, Code, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("import")

export default function ImportChatHistory() {
  return (
    <DocShell slug="import">
      <p>
        Coding agents keep their history in folders AI Insights reads on its own. A chat product such as Claude (claude.ai and the Claude apps)
        keeps your conversations on its servers, so you request a data export, download it, and point AI Insights at the file. It never looks in
        your downloads folder by itself.
      </p>

      <H2 id="export-claude">Get your Claude export</H2>
      <Callout title="Placeholder: steps to be filled in" tone="warn">
        <p>
          The step-by-step instructions for requesting and downloading a Claude data export will be written from Anthropic&apos;s current help
          pages, so they match what the settings screens say today. Until then, follow the data export instructions in Claude&apos;s own help
          centre.
        </p>
      </Callout>
      <p>
        The download is a <code>.zip</code>, sometimes split into several parts such as <code>conversations-000.zip</code>. AI Insights reads the
        conversations in it and ignores the rest.
      </p>

      <H2 id="import">Import it</H2>
      <Code label="Terminal">{`npx ai-insights import claude ~/Downloads/<your-export>.zip`}</Code>
      <p>The path can be any of:</p>
      <ul>
        <li>the export <code>.zip</code> as you downloaded it (it is read in place and never unpacked to disk);</li>
        <li>the folder you unzipped it into, or a folder holding several <code>conversations-*.zip</code> parts;</li>
        <li>
          the <code>conversations.json</code> file itself.
        </li>
      </ul>
      <p>
        The file is read a piece at a time, so a large history does not need much memory: an export of about 1,300 conversations (a 76 MB{" "}
        <code>conversations.json</code>) imports in about a second. From then on every run includes your chats as their own agent,{" "}
        <strong>Claude chat</strong> (<code>claude-chat</code> in <code>--harness</code>), separate from Claude Code.
      </p>
      <Code label="Output, from a synthetic export" copy={false}>{`Imported your Claude chat history
  Claude chat  300 conversations, 2026-03-01 to 2026-09-16
               964 prompts, 964 replies, 277 tool calls
               imported 2026-11-17

Kept: counts, tool names and your own prompts. Not kept: Claude's answers, thinking, tool results,
attachments and chat titles. Tokens and cost are not in the export, so they stay unmeasured.
Run \`ai-insights\` to see it in your report.`}</Code>

      <H2 id="what-is-read">What is read and kept</H2>
      <p>
        Each conversation becomes one session, the same shape as a coding agent&apos;s, stored under <code>~/.ai-insights/imports/claude-chat/</code>.
        The export itself is not copied.
      </p>
      <Table
        caption="What an import keeps"
        head={["From the export", "Kept"]}
        rows={[
          ["Your own messages", "As prompts, with secrets and email addresses redacted and each cut to 2,000 characters. A message with only an attachment counts as a turn with no words."],
          ["When each message was sent", "Times, for activity, streaks, your hour of day and how fast you replied."],
          ["Claude's replies", "Counted only. The text is never read into memory."],
          ["Thinking", "How many times Claude thought and for how long. The thinking text is not read."],
          ["Tools Claude used", "Claude's own tools by name (web search, artifacts, code execution, file creation and similar) and whether a call failed. Connectors and MCP servers are counted as one label, never by their name. Tool inputs and results are not read."],
          ["Attachments and files", "Counted only. File names and extracted text are not read."],
          ["Regenerated answers and edited prompts", "Counted, from messages that share a parent."],
          ["Voice notes", "Counted only."],
          ["Chat titles and summaries", "Not read."],
          ["Projects, memories, design chats, account details", "Not read."],
        ]}
      />
      <p>
        The agent review (the <code>analyze-ai-usage</code> skill) sees only what an import keeps: your prompts and Claude&apos;s tool names, never
        its answers.
      </p>

      <H2 id="not-measured">What chat exports cannot show</H2>
      <ul>
        <li>
          <strong>No model, no tokens, no cost.</strong> The export records none of them, so they are shown as not measured, never as zero and
          never estimated. Chats stay out of token and spend totals, out of the per-agent split in a share link and out of the leaderboard arenas
          built on it.
        </li>
        <li>
          <strong>No coding findings.</strong> Findings, work ratios and &ldquo;why sessions go wrong&rdquo; come from failed commands, edits,
          context resets and permission prompts, which a chat does not have. Chats are left out of them, so they neither trip nor dilute them.
        </li>
        <li>
          <strong>No parallel agents.</strong> Chats left open side by side are not agents working at once, so they are not counted as parallel.
        </li>
        <li>
          <strong>What still counts.</strong> Activity, streaks, your hour and day of the week, words, manners, thinking, reply times and your
          persona include your chats. A history of only chats earns the persona <em>Conversationalist</em>.
        </li>
      </ul>

      <H2 id="manage">Replace or remove an import</H2>
      <p>
        Importing a newer export replaces the earlier import whole, including conversations you have since deleted. To see or remove what is
        imported:
      </p>
      <Code label="Terminal">{`npx ai-insights import --list
npx ai-insights import --remove claude`}</Code>
      <p>
        Removing deletes the imported sessions, their cached copies and any labels your agent saved for them. It never touches the export file you
        downloaded.
      </p>
    </DocShell>
  )
}
