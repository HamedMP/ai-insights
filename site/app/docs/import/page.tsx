import { DocShell } from "@/components/docs/doc-shell"
import { Code, H2, Table } from "@/components/docs/prose"
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
      <ol>
        <li>Open claude.ai on a computer (the web app or Claude Desktop). The phone apps cannot export.</li>
        <li>Click your name, then Settings, then Privacy.</li>
        <li>Click Export data and choose a date range.</li>
        <li>Open the email within 24 hours and download the export. You have to be signed in, and the link may work only once.</li>
        <li>
          Keep the &ldquo;conversations&rdquo; zip and run <code>ai-insights import claude &lt;path&gt;</code>. The other files are not needed.
        </li>
      </ol>
      <p>
        Export is available on the Free, Pro, Max and Ultra plans. On a Team or Enterprise plan it works only if an owner allows it. The export
        does not include files you uploaded or Office and PDF files Claude made. See Anthropic&apos;s{" "}
        <a href="https://support.claude.com/en/articles/9450526-export-your-claude-data">Export your Claude data</a>.
      </p>
      <p>
        Newer exports arrive as one zip per kind of data (<code>conversations-000.zip</code>, <code>projects-000.zip</code>,{" "}
        <code>memories-000.zip</code>, <code>light_metadata-000.zip</code>, with more parts as <code>-001</code> and so on), sometimes with a{" "}
        <code>manifest-*.json</code>; older ones are a single <code>data-…-batch-0000.zip</code>. Point AI Insights at the conversations zip, the
        folder holding the parts, or the manifest: it reads every conversations part and never opens the others.
      </p>

      <H2 id="other-products">Other chat products</H2>
      <p>
        <strong>ChatGPT: coming next.</strong> The importer will read its export once it has been checked against a real one. To get it ready: in
        ChatGPT, open Settings, then Data controls, then Export data, and confirm. The email can take up to 7 days and its link expires after
        24 hours. Business and Enterprise workspaces cannot export this way. See OpenAI&apos;s{" "}
        <a href="https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data">How do I export my ChatGPT history and data?</a>
      </p>
      <ul>
        <li>
          <strong>Gemini:</strong> not supported yet. Its history comes from <a href="https://takeout.google.com/">Google Takeout</a>, under My
          Activity, then Gemini Apps.
        </li>
        <li>
          <strong>Microsoft Copilot:</strong> not supported yet. Its history downloads as a CSV from the{" "}
          <a href="https://account.microsoft.com/privacy">Microsoft privacy dashboard</a>.
        </li>
      </ul>

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
          ["Your own messages", "As prompts, with secrets and email addresses redacted and each cut to 2,000 characters. Only what you typed: text the product added to a message and attachment text are not prompts. A message with only an attachment counts as a turn with no words."],
          ["When each message was sent", "Times, for activity, streaks, your hour of day and how fast you replied."],
          ["Claude's replies", "Counted only. The text is never read into memory."],
          ["Thinking", "How many times Claude thought and for how long. The thinking text is not read."],
          ["Tools Claude used", "Claude's own tools by name (web search, artifacts, code execution, file creation and similar) and whether a call failed. Connectors and MCP servers are counted as one label, never by their name. Tool inputs and results are not read."],
          ["Attachments and files", "Counted only. File names and extracted text are not read."],
          ["Regenerated answers and edited prompts", "The export keeps every version as a tree. Prompts, replies and tools are counted on the branch you ended on (the newest); the replaced versions are counted as branches."],
          ["Voice notes", "Counted only."],
          ["Chat titles and summaries", "Not read."],
          ["Projects, memories, design chats, account details and login history", "Never opened."],
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
