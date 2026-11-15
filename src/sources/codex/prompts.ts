/**
 * Codex wraps what the person typed in context it injects itself (IDE state, browser state, mentioned
 * files) and sends instructions and environment details as user-role messages. Only the typed part
 * counts as a prompt.
 */

/** Messages that are wholly injected context, never typed. */
const INJECTED_PREFIXES = [
  "<environment_context",
  "<user_instructions",
  "<external_code",
  "<permissions instructions",
  "<collaboration_mode",
  "<turn_aborted",
  "<user_shell_command",
  "<skill",
  "<apps_instructions",
  "<model_switch",
  "<personality",
  "<realtime",
  "# AGENTS.md instructions",
  "# AGENTS.md",
  "AGENTS.md instructions",
];

/** Blocks Codex prepends to a typed message; removed, the rest kept. */
const WRAPPER_BLOCKS = /<(in-app-browser-context|environment_context|ide_context|ide-context|editor_context|user_instructions|image|images)\b[^>]*>[\s\S]*?<\/\1>/g;
const REQUEST_HEADING = /^#{1,3} My request(?: for Codex)?:[ \t]*$/m;
const QUESTION_REPLY = /<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/;

export function isInjected(text: string): boolean {
  const start = text.trimStart();
  return INJECTED_PREFIXES.some((prefix) => start.startsWith(prefix));
}

/** Answers the person gave to the agent's `request_user_input` questions. */
function questionAnswers(body: string): string | null {
  try {
    const value: unknown = JSON.parse(body);
    if (!Array.isArray(value)) return null;
    const answers = value
      .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).answer : undefined))
      .filter((answer): answer is string => typeof answer === "string" && answer.trim().length > 0);
    return answers.length ? answers.join("\n") : null;
  } catch {
    return null;
  }
}

/**
 * The typed part of a user message, or null when nothing typed remains.
 * Runs before redaction; callers still pass the result through `clean`.
 */
export function typedText(raw: string): string | null {
  if (isInjected(raw)) return null;
  const reply = QUESTION_REPLY.exec(raw);
  if (reply) {
    const answers = questionAnswers(reply[1] ?? "");
    const rest = raw.replace(QUESTION_REPLY, "").trim();
    const parts = [answers, rest ? typedText(rest) : null].filter((part): part is string => !!part);
    return parts.length ? parts.join("\n") : null;
  }
  let text = raw;
  // Everything above "## My request:" is context Codex assembled (browser tab, mentioned files, IDE state).
  const heading = REQUEST_HEADING.exec(text);
  if (heading) {
    const parts = text.split(REQUEST_HEADING);
    text = parts.at(-1) ?? "";
  }
  text = text.replace(WRAPPER_BLOCKS, "").trim();
  return text.length ? text : null;
}

/** The person's prompt text from a list of content parts, joined the way Codex shows it. */
export function contentText(content: unknown, partType?: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (partType && record.type !== partType) continue;
    if (typeof record.text === "string") parts.push(record.text);
  }
  return parts.join("\n");
}

export function hasImage(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((part) => part && typeof part === "object" && /image/.test(String((part as Record<string, unknown>).type)))
  );
}

/** A prompt's text, or "[image]" when the person sent only a picture, or null for injected context. */
export function promptText(raw: string, image: boolean): string | null {
  if (isInjected(raw)) return null;
  return typedText(raw) ?? (image ? "[image]" : null);
}

/** Answers to the agent's own questions arrive mid-turn but are not interruptions. */
export function isQuestionReply(raw: string): boolean {
  return QUESTION_REPLY.test(raw);
}

/** Envelopes other agents and automations use when they write into a thread: a terminal hub, cross-session relays, notifications. */
const AGENT_ENVELOPE = /^<(hc|cross-session-message|teammate-message|task-notification|subagent_notification|inter_agent_message|agent_message)\b[^>]*>([\s\S]*?)(?:<\/\1>\s*$|$)/;
const AGENT_PREFIX = /^(Another (?:Claude|Codex|agent) session sent a message:|Message from (?:another )?agent\b|\[(?:orchestrator|automation|agent)[^\]]*\])/i;

/** The text of a message another agent or automation wrote, or null when it does not look like one. */
export function agentText(raw: string): string | null {
  const text = raw.trim();
  const envelope = AGENT_ENVELOPE.exec(text);
  if (envelope) return (envelope[2] ?? "").trim() || envelope[1]!;
  if (AGENT_PREFIX.test(text)) return text;
  return null;
}
