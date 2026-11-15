import type { ExcerptOptions, SessionFile, TranscriptTurn } from "../../schema/types.js";
import { clean } from "../shared.js";
import { classifyUserText, toolCategory } from "./classify.js";
import { DEFAULT_LIMITS, readJsonl, type JsonlLimits } from "./jsonl.js";
import { isoTime, obj, str, toolResultText, userText } from "./parse.js";

const DEFAULT_MAX_TURNS = 40;
const DEFAULT_MAX_CHARS = 1_200;
const HARD_MAX_TURNS = 500;
const HARD_MAX_CHARS = 20_000;
// Candidates kept while streaming; beyond this we thin evenly so memory stays bounded.
const MAX_CANDIDATES = 20_000;

/** One line that says what a tool call did, without its output. */
function toolSummary(name: string, input: Record<string, unknown>): string {
  const category = toolCategory(name);
  if (category === "shell") return str(input.command) || str(input.description);
  const path = str(input.file_path) || str(input.notebook_path) || str(input.path);
  if (category === "read" || category === "edit") return path;
  if (category === "search") return [str(input.pattern), path].filter(Boolean).join(" in ");
  if (category === "web") return str(input.url) || str(input.query);
  if (category === "subagent") return str(input.description) || str(input.subagent_type);
  if (category === "skill") return str(input.skill) || str(input.command);
  if (name === "AskUserQuestion") {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    return questions.map((q) => str(obj(q).question)).filter(Boolean).join(" / ");
  }
  return "";
}

function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  if (count <= 0) return [];
  if (count === 1) return [items[0]!];
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) picked.push(items[Math.round((i * (items.length - 1)) / (count - 1))]!);
  return picked;
}

/**
 * Spread evenly across the session, but give the person's own prompts up to
 * half the slots: they carry the goal and the corrections, and agent and tool
 * turns vastly outnumber them.
 */
function spread(items: TranscriptTurn[], count: number): TranscriptTurn[] {
  if (items.length <= count) return items;
  const indexed = items.map((turn, index) => ({ turn, index }));
  const users = indexed.filter(({ turn }) => turn.role === "user");
  const others = indexed.filter(({ turn }) => turn.role !== "user");
  const pickedUsers = pickEvenly(users, Math.min(users.length, Math.max(Math.ceil(count / 2), count - others.length)));
  const pickedOthers = pickEvenly(others, count - pickedUsers.length);
  return [...pickedUsers, ...pickedOthers].sort((a, b) => a.index - b.index).map(({ turn }) => turn);
}

function pickAround(items: TranscriptTurn[], count: number, around: string): TranscriptTurn[] {
  const target = Date.parse(around);
  if (!Number.isFinite(target)) return pickEvenly(items, count);
  return items
    .map((turn, index) => ({ index, distance: Math.abs(Date.parse(turn.timestamp) - target) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map(({ index }) => items[index]!);
}

/**
 * Redacted, truncated turns of the main conversation (subagent transcripts are
 * left out: the model pass judges the person's session, not delegated work).
 * Thinking blocks are never included.
 */
export async function excerptClaudeTranscript(
  file: SessionFile,
  options: ExcerptOptions = {},
  limits: JsonlLimits = DEFAULT_LIMITS,
): Promise<TranscriptTurn[]> {
  const maxTurns = Math.max(0, Math.min(HARD_MAX_TURNS, Math.floor(options.maxTurns ?? DEFAULT_MAX_TURNS)));
  const maxChars = Math.max(1, Math.min(HARD_MAX_CHARS, Math.floor(options.maxCharsPerTurn ?? DEFAULT_MAX_CHARS)));
  if (maxTurns === 0) return [];

  let turns: TranscriptTurn[] = [];
  const toolNames = new Map<string, string>();
  const push = (turn: TranscriptTurn): void => {
    if (!turn.text) return;
    turns.push(turn);
    if (turns.length >= MAX_CANDIDATES) {
      turns = pickEvenly(turns, MAX_CANDIDATES / 2);
    }
  };

  for await (const row of readJsonl(file.path, limits)) {
    if (row.kind !== "record") continue;
    const record = row.value;
    if (record.isSidechain === true) continue;
    const time = isoTime(record.timestamp);
    if (!time) continue;
    const message = obj(record.message);

    if (record.type === "assistant") {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        const b = obj(block);
        if (b.type === "text") {
          push({ timestamp: time, role: "assistant", text: clean(str(b.text), maxChars) });
        } else if (b.type === "tool_use") {
          const name = str(b.name) || "unknown";
          const summary = toolSummary(name, obj(b.input));
          push({ timestamp: time, role: "tool", toolName: name, text: clean(summary || name, maxChars) });
          const id = str(b.id);
          if (id && toolNames.size < MAX_CANDIDATES) toolNames.set(id, name);
        }
      }
    } else if (record.type === "user") {
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = obj(block);
          if (b.type !== "tool_result" || b.is_error !== true) continue;
          // Only failures are shown: they explain friction, and successful output is noise (and often private).
          push({
            timestamp: time,
            role: "tool",
            toolName: toolNames.get(str(b.tool_use_id)) ?? "unknown",
            isError: true,
            text: clean(toolResultText(b.content), maxChars),
          });
        }
      }
      if (record.isMeta === true || record.isCompactSummary === true || record.isVisibleInTranscriptOnly === true) continue;
      const origin = obj(record.origin);
      if (typeof origin.kind === "string" && origin.kind !== "human") continue;
      const { text, hasToolResult } = userText(message.content);
      if (hasToolResult) continue;
      const kind = classifyUserText(text);
      const shown =
        kind.kind === "prompt" ? kind.text : kind.kind === "slash" ? `${kind.name} ${kind.args}`.trim() : kind.kind === "bash" ? `! ${kind.command}` : kind.kind === "interrupt" ? "[interrupted]" : "";
      if (shown) push({ timestamp: time, role: "user", text: clean(shown, maxChars) });
    } else if (record.type === "attachment") {
      const attachment = obj(record.attachment);
      if (attachment.type !== "queued_command" || attachment.commandMode !== "prompt" || attachment.isMeta === true) continue;
      const origin = obj(attachment.origin);
      if (typeof origin.kind === "string" && origin.kind !== "human") continue;
      const prompt = attachment.prompt;
      const kind = classifyUserText(typeof prompt === "string" ? prompt : userText(prompt).text);
      if (kind.kind === "prompt") push({ timestamp: time, role: "user", text: clean(kind.text, maxChars) });
    }
  }

  return options.around ? pickAround(turns, maxTurns, options.around) : spread(turns, maxTurns);
}
