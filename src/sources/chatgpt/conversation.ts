import type { Session, SessionFile, ToolCategory } from "../../schema/types.js";
import { isSafeId } from "../../store/schemas.js";
import { MCP_TOOL } from "../claude-chat/conversation.js";
import { eachKey, orScalar, type ObjectSpec } from "../claude-chat/json-stream.js";
import { isoFrom, obj, SessionBuilder, str, type Obj } from "../common/builder.js";

/**
 * Turns one conversation of a ChatGPT data export (`conversations.json`, or the `conversations-000.json` shards
 * of exports from 2026 on) into a `Session`. A conversation holds `id` / `conversation_id`, `title`,
 * `create_time` and `update_time` (epoch seconds), `current_node`, and `mapping`: an object keyed by node id,
 * each node holding `parent`, a `message` (null at the root) and, in older exports, `children`. A message holds
 * `author.role` (`system`, `user`, `assistant`, `tool`), `author.name` (the tool, on tool messages), `create_time`,
 * `content` (`content_type` plus `parts`, `text`, `thoughts` and others by type), `recipient` (the tool an
 * assistant message calls; `all` for a visible reply) and `metadata` (`model_slug`, `attachments`,
 * `search_result_groups`, `is_visually_hidden_from_conversation`, `voice_mode_message`, citations and more).
 * Exports from late 2026 drop `children`, `recipient` and tool messages; web search shows only as
 * `search_result_groups` on the reply. The export records no token counts and no cost.
 *
 * Only the person's own visible messages on the branch they ended on are kept as prompts (redacted by the
 * builder). The title, assistant text, thoughts and reasoning recaps, tool inputs and results, custom
 * instructions, memories, system messages, citations, attachment names and asset pointers are never read into
 * memory: `CONVERSATION_SPEC` leaves them out while the export is streamed.
 */

/** A part of a message: the person's text as a string, or an asset or transcription as an object. */
const PART = orScalar({
  content_type: true,
  // Only an `audio_transcription` part of the person's own message is read for its words.
  text: true,
});

const MESSAGE: ObjectSpec = {
  author: { role: true, name: true },
  create_time: true,
  content: { content_type: true, parts: [PART] },
  recipient: true,
  metadata: {
    model_slug: true,
    is_visually_hidden_from_conversation: true,
    is_user_system_message: true,
    voice_mode_message: true,
    // Counted, never read: whether each one is a big paste is all that is kept.
    attachments: [{ is_big_paste: true }],
    search_result_groups: [{}],
  },
};

/** The keys read from each conversation. Everything else is skipped while streaming. */
export const CONVERSATION_SPEC: ObjectSpec = {
  id: true,
  conversation_id: true,
  current_node: true,
  mapping: eachKey({ parent: true, message: MESSAGE }),
};

/**
 * ChatGPT's own tools, by the first segment of the name a call is addressed to (`web.run` is `web`). Anything
 * else (a custom GPT's action, a plugin, a connector, `api_tool`) carries a name the person or a third party
 * chose, so it is counted under one fixed label and never by its name.
 */
const PRODUCT_TOOLS: Record<string, { name: string; category: ToolCategory }> = {
  python: { name: "python", category: "other" },
  web: { name: "web_search", category: "web" },
  browser: { name: "web_search", category: "web" },
  research_kickoff_tool: { name: "deep_research", category: "web" },
  dalle: { name: "image_generation", category: "other" },
  image_gen: { name: "image_generation", category: "other" },
  canmore: { name: "canvas", category: "edit" },
  file_search: { name: "file_search", category: "search" },
  myfiles_browser: { name: "file_search", category: "search" },
  bio: { name: "memory", category: "other" },
  automations: { name: "scheduled_task", category: "other" },
  container: { name: "container", category: "shell" },
  computer: { name: "computer_use", category: "other" },
  user_info: { name: "user_info", category: "other" },
};

export function chatgptTool(target: string): { name: string; category: ToolCategory } {
  const head = target.split(".")[0] ?? "";
  return Object.prototype.hasOwnProperty.call(PRODUCT_TOOLS, head) ? PRODUCT_TOOLS[head]! : { name: MCP_TOOL, category: "mcp" };
}

/**
 * The public model family a slug belongs to (`gpt-5-6-thinking` and `gpt-5.6-…` are `gpt-5.6`), or null. Slugs
 * carry internal variant names, so only the family is kept and anything unrecognised is dropped.
 */
export function modelFamily(slug: string): string | null {
  const s = slug.trim().toLowerCase();
  if (s.startsWith("text-davinci-002-render")) return "gpt-3.5";
  const gpt = /^gpt-([1-9]\d?)(?:[.-](\d)(?!\d))?(o)?(?=$|[-.])/.exec(s);
  if (gpt) return `gpt-${gpt[1]}${gpt[2] ? `.${gpt[2]}` : ""}${gpt[3] ? "o" : ""}`;
  const reasoning = /^o([1-9])(?=$|-)/.exec(s);
  return reasoning ? `o${reasoning[1]}` : null;
}

const MAX_PATH = 50_000;

interface Node {
  id: string;
  parent: string;
  message: Obj | null;
}

function nodesOf(mapping: Obj): Map<string, Node> {
  const nodes = new Map<string, Node>();
  for (const [id, raw] of Object.entries(mapping)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const node = raw as Obj;
    nodes.set(id, { id, parent: str(node.parent), message: node.message && typeof node.message === "object" && !Array.isArray(node.message) ? (node.message as Obj) : null });
  }
  return nodes;
}

/** The newest node no other node points to: where the person most likely ended when `current_node` is unusable. */
function newestLeaf(nodes: Map<string, Node>): string | null {
  const parents = new Set<string>();
  for (const node of nodes.values()) if (node.parent) parents.add(node.parent);
  let best: { id: string; at: number } | null = null;
  for (const node of nodes.values()) {
    if (parents.has(node.id)) continue;
    const at = typeof node.message?.create_time === "number" ? node.message.create_time : -Infinity;
    if (!best || at >= best.at) best = { id: node.id, at };
  }
  return best?.id ?? null;
}

/**
 * The branch the person ended on, root first. The export points at it (`current_node`), so regenerated replies
 * and edited prompts on other branches are counted only as branches. Stops at a missing parent or a cycle.
 */
function activePath(nodes: Map<string, Node>, current: string): { path: Node[]; broken: boolean } {
  const start = nodes.has(current) ? current : newestLeaf(nodes);
  const path: Node[] = [];
  const seen = new Set<string>();
  let broken = false;
  for (let id = start; id; ) {
    const node = nodes.get(id);
    if (!node) {
      broken = true;
      break;
    }
    if (seen.has(id) || path.length >= MAX_PATH) {
      broken = true;
      break;
    }
    seen.add(id);
    path.push(node);
    id = node.parent;
  }
  return { path: path.reverse(), broken };
}

/** Extra children under one parent: each regenerated reply or edited prompt adds a sibling. */
function branchesOf(nodes: Map<string, Node>): number {
  const children = new Map<string, number>();
  for (const node of nodes.values()) if (node.parent) children.set(node.parent, (children.get(node.parent) ?? 0) + 1);
  let branches = 0;
  for (const count of children.values()) branches += Math.max(0, count - 1);
  return branches;
}

function partsOf(message: Obj): unknown[] {
  const parts = obj(message.content).parts;
  return Array.isArray(parts) ? parts : [];
}

const VOICE_PARTS = new Set(["audio_transcription", "audio_asset_pointer", "real_time_user_audio_video_asset_pointer"]);

/** What the person typed or said: string parts, and the transcription of a voice message. */
function personText(message: Obj): string {
  const out: string[] = [];
  for (const part of partsOf(message)) {
    if (typeof part === "string") out.push(part);
    else if (obj(part).content_type === "audio_transcription") out.push(str(obj(part).text));
  }
  return out.join("\n\n");
}

function hidden(message: Obj): boolean {
  const metadata = obj(message.metadata);
  return metadata.is_visually_hidden_from_conversation === true || metadata.is_user_system_message === true;
}

const PROMPT_TYPES = new Set(["text", "multimodal_text"]);
/** Assistant messages that are thinking, not a reply. */
const THOUGHT_TYPES = new Set(["thoughts", "reasoning_recap"]);

export interface ConversationExtras {
  /** Items the stream reader dropped past its array cap. */
  dropped?: number;
}

/** Null when the conversation has no usable id or no message with a time. */
export function conversationToSession(raw: unknown, file: SessionFile, extras: ConversationExtras = {}): Session | null {
  const conversation = obj(raw);
  const id = str(conversation.id) || str(conversation.conversation_id);
  if (!isSafeId(id)) return null;
  const nodes = nodesOf(obj(conversation.mapping));
  if (nodes.size === 0) return null;
  const builder = new SessionBuilder("chatgpt");
  const { path, broken } = activePath(nodes, str(conversation.current_node));
  if (broken) builder.issues += 1;
  const onPath = new Set(path);
  for (const node of nodes.values()) {
    // A reply or prompt the person later replaced: it took time, but it is counted under branches only.
    if (!onPath.has(node) && node.message) builder.noteTime(isoFrom(node.message.create_time));
  }
  let silentTurns = 0;
  let attachments = 0;
  let files = 0;
  let voiceNotes = 0;
  let webSinceLastPrompt = false;
  const open: Array<{ name: string; index: number }> = [];
  const calls: Array<{ name: string; category: ToolCategory; timestamp: string; error: boolean }> = [];
  for (const node of path) {
    const message = node.message;
    if (!message) continue;
    const timestamp = isoFrom(message.create_time);
    const role = str(obj(message.author).role);
    const contentType = str(obj(message.content).content_type);
    const metadata = obj(message.metadata);
    if (role === "system") continue;
    if (hidden(message)) {
      // Custom instructions, memories and context the product added: not a turn anyone took.
      continue;
    }
    if (role === "user") {
      if (!PROMPT_TYPES.has(contentType)) continue;
      const uploads = Array.isArray(metadata.attachments) ? metadata.attachments.map(obj) : [];
      const pastes = uploads.filter((item) => item.is_big_paste === true).length;
      const images = partsOf(message).filter((part) => obj(part).content_type === "image_asset_pointer").length;
      attachments += pastes;
      files += Math.max(uploads.length - pastes, images);
      if (metadata.voice_mode_message === true || partsOf(message).some((part) => VOICE_PARTS.has(str(obj(part).content_type)))) voiceNotes += 1;
      webSinceLastPrompt = false;
      const words = personText(message);
      if (words.trim()) builder.prompt(timestamp, words);
      else if (timestamp) {
        // Only an upload, a paste or audio: still a turn the person took, with no words to keep.
        silentTurns += 1;
        builder.noteTime(timestamp);
      } else builder.issues += 1;
      continue;
    }
    if (role === "tool") {
      builder.noteTime(timestamp);
      const name = str(obj(message.author).name);
      const failed = contentType === "system_error";
      const call = open.findLast((candidate) => candidate.name === name);
      if (call) {
        open.splice(open.indexOf(call), 1);
        if (failed) calls[call.index]!.error = true;
      } else if (timestamp) {
        // Exports that record the tool's answer but not the call: the answer stands for it.
        const tool = chatgptTool(name);
        if (tool.category === "web") webSinceLastPrompt = true;
        calls.push({ ...tool, timestamp, error: failed });
      }
      continue;
    }
    if (role !== "assistant") {
      builder.issues += 1;
      continue;
    }
    const family = modelFamily(str(metadata.model_slug));
    if (family) builder.noteModel(family);
    if (THOUGHT_TYPES.has(contentType)) {
      if (contentType === "thoughts") builder.thought(null);
      builder.noteTime(timestamp);
      continue;
    }
    const recipient = str(message.recipient);
    if (recipient && recipient !== "all") {
      if (!timestamp) {
        builder.issues += 1;
        continue;
      }
      const tool = chatgptTool(recipient);
      if (tool.category === "web") webSinceLastPrompt = true;
      open.push({ name: recipient, index: calls.length });
      calls.push({ ...tool, timestamp, error: false });
      builder.noteTime(timestamp);
      continue;
    }
    builder.assistant(timestamp, { finished: true });
    // Late-2026 exports keep no search call, only the results it fed into this reply.
    if (!webSinceLastPrompt && timestamp && Array.isArray(metadata.search_result_groups) && metadata.search_result_groups.length > 0) {
      calls.push({ ...PRODUCT_TOOLS.web!, timestamp, error: false });
      webSinceLastPrompt = true;
    }
  }
  for (const call of calls) builder.tool({ name: call.name, category: call.category, timestamp: call.timestamp, ...(call.error ? { error: "other" as const } : {}) });
  const session = builder.build(file, id);
  if (!session) return null;
  session.userMessageCount += silentTurns;
  session.issues += extras.dropped ?? 0;
  session.chat = { attachments, files, voiceNotes, branches: branchesOf(nodes) };
  return session;
}
