import type { Session, SessionFile, ToolCategory } from "../../schema/types.js";
import { isSafeId } from "../../store/schemas.js";
import { isoFrom, obj, SessionBuilder, str, type Obj } from "../common/builder.js";
import type { Spec } from "./json-stream.js";

/**
 * Turns one conversation of a Claude data export (`conversations.json`, checked against an export from
 * August 2026) into a `Session`. A conversation holds `uuid`, `name`, `summary`, `created_at`, `updated_at`,
 * `account` and `chat_messages`; each message holds `uuid`, `sender` (`human` / `assistant`), `text`,
 * `content` blocks, `created_at`, `attachments`, `files` and `parent_message_uuid`. Content blocks are `text`,
 * `thinking` (with start and stop times), `tool_use` / `tool_result` (a tool name, `is_error`, connector fields),
 * `voice_note` and `token_budget`. The export records no model, no token counts and no cost.
 *
 * Only the person's own messages are kept as prompts (redacted by the builder). The conversation's name and
 * summary, assistant text, thinking text, tool inputs and results, attachment text and file names are never read
 * into memory: `CONVERSATION_SPEC` leaves them out while the export is streamed.
 */

const BLOCK: Spec = {
  type: true,
  start_timestamp: true,
  stop_timestamp: true,
  // Tool blocks: the name decides the fixed label below; the connector fields only flag a connector.
  name: true,
  is_error: true,
  integration_name: true,
  mcp_server_url: true,
  is_mcp_app: true,
  // Text blocks are read only as the person's text when a human message has no `text` field.
  text: true,
};

const MESSAGE: Spec = {
  uuid: true,
  sender: true,
  created_at: true,
  updated_at: true,
  text: true,
  content: [BLOCK],
  // Counted, never read: each item is built as an empty object.
  attachments: [{}],
  files: [{}],
  parent_message_uuid: true,
};

/** The keys read from each conversation. Everything else is skipped while streaming. */
export const CONVERSATION_SPEC: Spec = {
  uuid: true,
  created_at: true,
  updated_at: true,
  chat_messages: [MESSAGE],
};

/**
 * Claude's own tools in the chat product, by the name the export records. Anything else (a connector, a
 * desktop extension, a remote MCP server) can carry a name the person or a third party chose, so it is counted
 * under one fixed label and never by its name.
 */
const PRODUCT_TOOLS: Record<string, ToolCategory> = {
  web_search: "web",
  web_fetch: "web",
  image_search: "web",
  launch_extended_search_task: "web",
  artifacts: "edit",
  repl: "other",
  bash_tool: "shell",
  create_file: "edit",
  str_replace: "edit",
  view: "read",
  present_files: "other",
  conversation_search: "search",
  recent_chats: "search",
  memory_user_edits: "other",
  places_search: "web",
  places_map_display_v0: "other",
  recipe_display_v0: "other",
  message_compose_v0: "other",
  user_time_v0: "other",
  ask_user_input_v0: "ask_user",
};

/** The label every tool outside `PRODUCT_TOOLS` is counted under. */
export const CONNECTOR_TOOL = "connector";

export function chatTool(block: Obj): { name: string; category: ToolCategory } {
  const name = str(block.name);
  const connector = !!(str(block.integration_name) || str(block.mcp_server_url) || block.is_mcp_app === true);
  const category = connector ? undefined : PRODUCT_TOOLS[name];
  return category ? { name, category } : { name: CONNECTOR_TOOL, category: "mcp" };
}

/** Extra replies under one parent: each regenerated answer or edited prompt adds a sibling. */
function branchesOf(messages: Obj[]): number {
  const children = new Map<string, number>();
  for (const message of messages) {
    const parent = str(message.parent_message_uuid) || "(root)";
    children.set(parent, (children.get(parent) ?? 0) + 1);
  }
  let branches = 0;
  for (const count of children.values()) branches += Math.max(0, count - 1);
  return branches;
}

function blocksOf(message: Obj): Obj[] {
  return Array.isArray(message.content) ? message.content.map(obj) : [];
}

function humanText(message: Obj): string {
  if (typeof message.text === "string") return message.text;
  return blocksOf(message)
    .filter((block) => block.type === "text")
    .map((block) => str(block.text))
    .join("\n\n");
}

function msBetween(start: string | null, stop: string | null): number | null {
  if (!start || !stop) return null;
  const ms = Date.parse(stop) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function byTime(messages: Obj[]): Obj[] {
  // Stable: messages with the same or no time keep the export's order.
  return messages
    .map((message, index) => ({ message, index, at: Date.parse(str(message.created_at)) }))
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) ? a.at - b.at : 0) || a.index - b.index)
    .map(({ message }) => message);
}

export interface ConversationExtras {
  /** Items the stream reader dropped past its array cap. */
  dropped?: number;
}

/** Null when the conversation has no usable id or no message with a time. */
export function conversationToSession(raw: unknown, file: SessionFile, extras: ConversationExtras = {}): Session | null {
  const conversation = obj(raw);
  const id = str(conversation.uuid);
  if (!isSafeId(id)) return null;
  const builder = new SessionBuilder("claude-chat");
  const messages = byTime(Array.isArray(conversation.chat_messages) ? conversation.chat_messages.map(obj) : []);
  let silentTurns = 0;
  let attachments = 0;
  let files = 0;
  let voiceNotes = 0;
  for (const message of messages) {
    const timestamp = isoFrom(message.created_at);
    attachments += Array.isArray(message.attachments) ? message.attachments.length : 0;
    files += Array.isArray(message.files) ? message.files.length : 0;
    if (message.sender === "human") {
      const text = humanText(message);
      if (text.trim()) builder.prompt(timestamp, text);
      else if (timestamp) {
        // Only an attachment or a file: still a turn the person took, with no words to keep.
        silentTurns += 1;
        builder.noteTime(timestamp);
      } else builder.issues += 1;
      continue;
    }
    if (message.sender !== "assistant") {
      builder.issues += 1;
      continue;
    }
    const blocks = blocksOf(message);
    let endedAt: string | null = null;
    for (const block of blocks) {
      const stop = isoFrom(block.stop_timestamp);
      if (stop && (!endedAt || stop > endedAt)) endedAt = stop;
    }
    builder.assistant(timestamp, { finished: true, endedAt });
    // A tool result follows its call in the same message; it is read only for whether it failed.
    const calls: Array<{ name: string; category: ToolCategory; timestamp: string; rawName: string; matched: boolean; error: boolean }> = [];
    for (const block of blocks) {
      const type = block.type;
      if (type === "thinking") builder.thought(msBetween(isoFrom(block.start_timestamp), isoFrom(block.stop_timestamp)));
      else if (type === "voice_note") voiceNotes += 1;
      else if (type === "tool_use") {
        const at = isoFrom(block.start_timestamp) ?? timestamp;
        if (!at) {
          builder.issues += 1;
          continue;
        }
        calls.push({ ...chatTool(block), timestamp: at, rawName: str(block.name), matched: false, error: false });
      } else if (type === "tool_result") {
        const call = calls.find((candidate) => !candidate.matched && candidate.rawName === str(block.name));
        if (call) {
          call.matched = true;
          call.error = block.is_error === true;
        }
      }
    }
    for (const call of calls) builder.tool({ name: call.name, category: call.category, timestamp: call.timestamp, ...(call.error ? { error: "other" as const } : {}) });
  }
  if (messages.length === 0) return null;
  const session = builder.build(file, id);
  if (!session) return null;
  session.userMessageCount += silentTurns;
  session.issues += extras.dropped ?? 0;
  session.chat = { attachments, files, voiceNotes, branches: branchesOf(messages) };
  return session;
}
