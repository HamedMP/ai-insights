import { DocShell } from "@/components/docs/doc-shell"
import { Code, H2, Table } from "@/components/docs/prose"
import { docMetadata } from "@/lib/docs-metadata"

export const metadata = docMetadata("import")

export default function ImportChatHistory() {
  return (
    <DocShell slug="import">
      <p>
        Coding agents keep their history in folders AI Insights reads on its own. A chat product such as Claude (claude.ai and the Claude apps) or
        ChatGPT keeps your conversations on its servers, so you request a data export, download it, and point AI Insights at the file. It never looks in
        your downloads folder by itself.
      </p>

      <H2 id="export-claude">Get your Claude export</H2>
      <ol>
        <li>Open claude.ai on a computer (the web app or Claude Desktop). The phone apps cannot export.</li>
        <li>Click your name, then Settings, then Privacy.</li>
        <li>Click Export data and choose a date range.</li>
        <li>Open the email within 24 hours and download the export. You have to be signed in, and the link may work only once.</li>
        <li>
          Keep the &ldquo;conversations&rdquo; zip and run <code>npx ai-insights@latest import claude &lt;path&gt;</code>. The other files are not needed.
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

      <H2 id="export-chatgpt">Get your ChatGPT export</H2>
      <ol>
        <li>In ChatGPT, open Settings, then Data controls.</li>
        <li>Under Export data, choose Export and confirm.</li>
        <li>
          Open the email when it arrives (it can take up to 7 days) and choose Download data export. Download it soon: the link expires, often
          after 24 hours, and then you request a new one.
        </li>
        <li>
          Run <code>npx ai-insights@latest import openai &lt;path&gt;</code> on the zip, or on the folder you unzipped it into.
        </li>
      </ol>
      <p>
        Business and Enterprise workspaces cannot export this way; on Edu it depends on your role and the workspace settings. See OpenAI&apos;s{" "}
        <a href="https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data">Exporting your ChatGPT history and data</a>.
      </p>
      <p>
        Newer exports split the conversations into <code>conversations-000.json</code>, <code>conversations-001.json</code> and so on beside an{" "}
        <code>export_manifest.json</code>; older ones hold a single <code>conversations.json</code>. The export also holds your account details,
        settings, conversation summaries and every file you uploaded: AI Insights reads only the conversations files and never
        opens the rest.
      </p>

      <H2 id="other-products">Other chat products</H2>
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
      <Code label="Terminal">{`npx ai-insights@latest import claude ~/Downloads/<your-export>.zip
npx ai-insights@latest import openai ~/Downloads/<your-chatgpt-export>.zip`}</Code>
      <p>The path can be any of:</p>
      <ul>
        <li>the export <code>.zip</code> as you downloaded it (it is read in place and never unpacked to disk);</li>
        <li>the folder you unzipped it into, or a folder holding several Claude <code>conversations-*.zip</code> parts;</li>
        <li>
          the <code>conversations.json</code> file itself (for ChatGPT, also one <code>conversations-000.json</code> part).
        </li>
      </ul>
      <p>
        The file is read a piece at a time, so a large history does not need much memory: an export of about 1,300 conversations (a 76 MB{" "}
        <code>conversations.json</code>) imports in about a second. From then on every run includes your chats as their own agent,{" "}
        <strong>Claude chat</strong> (<code>claude-chat</code> in <code>--harness</code>), separate from Claude Code, or{" "}
        <strong>ChatGPT</strong> (<code>chatgpt</code>), separate from Codex.
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
        Each conversation becomes one session, the same shape as a coding agent&apos;s, stored under <code>~/.ai-insights/imports/claude-chat/</code> or{" "}
        <code>~/.ai-insights/imports/chatgpt/</code>.
        The export itself is not copied.
      </p>
      <Table
        caption="What an import keeps"
        head={["From the export", "Kept"]}
        rows={[
          ["Your own messages", "As prompts, with secrets and email addresses redacted and each cut to 2,000 characters. Only what you typed: text the product added to a message and attachment text are not prompts. A message with only an attachment counts as a turn with no words."],
          ["When each message was sent", "Times, for activity, streaks, your hour of day and how fast you replied."],
          ["Claude's or ChatGPT's replies", "Counted only. The text is never kept."],
          ["Thinking", "How many times the model thought, and for Claude how long. The thinking text and ChatGPT's reasoning summaries are not read."],
          ["The model (ChatGPT only)", "The public model family, such as gpt-5.6, from each reply. Internal variant names are dropped. Nothing about tokens or cost."],
          ["Tools Claude used", "Claude's own tools by name (web search, artifacts, code execution, file creation and similar) and whether a call failed. Connectors and MCP servers are counted as one label, never by their name. Tool inputs and results are not read."],
          ["Tools ChatGPT used", "ChatGPT's own tools by kind (web search, code runs, image generation, canvas, file search, memory and similar) and whether a call failed. Custom GPT actions, plugins and connectors are counted as one label, never by their name. Newer exports record web searches only, as the results on a reply."],
          ["Attachments and files", "Counted only. File names and extracted text are not read."],
          ["Regenerated answers and edited prompts", "The export keeps every version as a tree. Prompts, replies and tools are counted on the branch you ended on (Claude: the newest; ChatGPT: the one the export marks as current); the replaced versions are counted as branches."],
          ["Voice notes", "Counted only. A ChatGPT voice message's transcript is your prompt; ChatGPT's spoken replies are not read."],
          ["Chat titles and summaries", "Not read."],
          ["ChatGPT custom instructions, memories and system messages", "Not read: they are hidden context, not something you typed in that chat."],
          ["Custom GPT and project ids", "Not read."],
          ["Projects, memories, design chats, account details and login history", "Never opened."],
          ["ChatGPT's account, settings, summary, library and uploaded files", "Never opened."],
        ]}
      />
      <p>
        The agent review (the <code>analyze-ai-usage</code> skill) sees only what an import keeps: your prompts and the product&apos;s tool names,
        never its answers.
      </p>

      <H2 id="not-measured">What chat exports cannot show</H2>
      <ul>
        <li>
          <strong>No tokens, no cost.</strong> The exports record neither (and Claude&apos;s records no model), so they are shown as not measured, never as zero and
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
      <Code label="Terminal">{`npx ai-insights@latest import --list
npx ai-insights@latest import --remove claude
npx ai-insights@latest import --remove openai`}</Code>
      <p>
        Removing deletes the imported sessions, their cached copies and any labels your agent saved for them. It never touches the export file you
        downloaded.
      </p>
    </DocShell>
  )
}
