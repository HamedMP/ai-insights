import { basename } from "node:path";
import type { ExcerptOptions, SessionFile, TranscriptTurn } from "../../schema/types.js";
import { truncate } from "../shared.js";
import { scrub, toolCategory, type PromptKind } from "./classify.js";
import { DEFAULT_LIMITS, readJsonl, type JsonlLimits } from "./jsonl.js";
import { classifyQueuedCommand, classifyUserRecord, isoTime, obj, str, toolResultText } from "./parse.js";

const DEFAULT_MAX_TURNS = 40;
const DEFAULT_MAX_CHARS = 1_200;
const HARD_MAX_TURNS = 500;
const HARD_MAX_CHARS = 20_000;
/** A tool call is context, not content: one short line. */
const TOOL_LINE_CHARS = 120;
/** How much of the failing call is repeated in front of its error. */
const ERROR_CONTEXT_CHARS = 80;
/**
 * What the model pass reads per session by default (the MCP server fits every
 * excerpt into 4,000 characters). The source fits itself first, so the server
 * never has to trim every turn evenly and cut the brief to a line.
 */
const MIN_BUDGET_CHARS = 4_000;
/** Below this, a turn says too little; drop the least useful turn instead of trimming further. */
const MIN_TURN_CHARS = 150;
// Candidates kept while streaming; beyond this the least useful tier is thinned so memory stays bounded.
const MAX_CANDIDATES = 20_000;

/**
 * What survives when an excerpt has to be squeezed, most important first.
 * A long session is thousands of tool calls; how it went lives in the
 * person's prompts, the interruptions, what failed and how it ended.
 */
const TIER = {
  anchor: 0, // the first prompt and the final answer
  person: 1, // prompts and interruptions
  failure: 2, // failed tool results
  agent: 3, // messages from other agents or automations
  answer: 4, // other assistant text
  tool: 5, // tool calls
  harness: 6, // task notifications, monitor events, wake-ups: only when nothing else is left
} as const;
type Tier = (typeof TIER)[keyof typeof TIER];

interface Candidate {
  turn: TranscriptTurn;
  tier: Tier;
  seq: number;
}

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

const oneLine = (text: string, max: number) => scrub(text.replace(/\s+/g, " "), max);

function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  if (count <= 0) return [];
  if (count === 1) return [items[0]!];
  const picked: T[] = [];
  for (let i = 0; i < count; i += 1) picked.push(items[Math.round((i * (items.length - 1)) / (count - 1))]!);
  return picked;
}

/** Fill the slots tier by tier; a tier that does not fit is spread evenly across the session. */
function byPriority(candidates: Candidate[], count: number): Candidate[] {
  const picked: Candidate[] = [];
  for (let tier: number = TIER.anchor; tier <= TIER.harness && picked.length < count; tier += 1) {
    const items = candidates.filter((candidate) => candidate.tier === tier);
    picked.push(...pickEvenly(items, count - picked.length));
  }
  return picked.sort((a, b) => a.seq - b.seq);
}

function nearest(candidates: Candidate[], count: number, around: string): Candidate[] {
  const target = Date.parse(around);
  if (!Number.isFinite(target)) return byPriority(candidates, count);
  return candidates
    .map((candidate) => ({ candidate, distance: Math.abs(Date.parse(candidate.turn.timestamp) - target) }))
    .sort((a, b) => a.distance - b.distance || a.candidate.seq - b.candidate.seq)
    .slice(0, count)
    .map(({ candidate }) => candidate)
    .sort((a, b) => a.seq - b.seq);
}

/** Halve the least useful tier that still has more than one turn. */
function thin(candidates: Candidate[]): Candidate[] {
  for (let tier: number = TIER.harness; tier >= TIER.person; tier -= 1) {
    const count = candidates.filter((candidate) => candidate.tier === tier).length;
    if (count < 2) continue;
    let index = 0;
    return candidates.filter((candidate) => candidate.tier !== tier || index++ % 2 === 0);
  }
  return candidates;
}

const length = (candidates: Candidate[]) => candidates.reduce((sum, candidate) => sum + candidate.turn.text.length, 0);

/**
 * Fit the picked turns into `budget` characters. The first prompt is the brief
 * and keeps its full turn; the rest share what is left. When sharing would cut
 * turns below a useful length, the least useful turns go first.
 */
function fitBudget(picked: Candidate[], budget: number): Candidate[] {
  let kept = picked;
  const brief = kept.find((candidate) => candidate.tier === TIER.anchor && candidate.turn.role === "user");
  const briefChars = brief ? Math.min(brief.turn.text.length, Math.floor(budget / 2)) : 0;
  const room = budget - briefChars;
  const others = () => kept.filter((candidate) => candidate !== brief);
  const capFor = (rest: Candidate[]): number => {
    // Largest per-turn cap that fits: short turns stay whole, long ones share what is left.
    let low = 0;
    let high = Math.max(0, ...rest.map((candidate) => candidate.turn.text.length));
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (rest.reduce((sum, candidate) => sum + Math.min(candidate.turn.text.length, mid), 0) <= room) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  let cap = capFor(others());
  while (length(others()) > room && cap < MIN_TURN_CHARS) {
    let dropped = false;
    for (let tier: number = TIER.harness; tier > TIER.anchor && !dropped; tier -= 1) {
      const items = kept.filter((candidate) => candidate.tier === tier);
      if (items.length === 0) continue;
      const keep = new Set(pickEvenly(items, items.length - 1));
      kept = kept.filter((candidate) => candidate.tier !== tier || keep.has(candidate));
      dropped = true;
    }
    if (!dropped) break;
    cap = capFor(others());
  }
  return kept.map((candidate) => {
    const max = candidate === brief ? briefChars : cap;
    return candidate.turn.text.length <= max ? candidate : { ...candidate, turn: { ...candidate.turn, text: truncate(candidate.turn.text, max) } };
  });
}

/**
 * Redacted, truncated turns of the main conversation, home directories shown
 * as `~`. Subagent transcripts are left out (the model pass judges the
 * person's session, not delegated work), and so are thinking blocks and
 * successful tool output.
 */
export async function excerptClaudeTranscript(
  file: SessionFile,
  options: ExcerptOptions = {},
  limits: JsonlLimits = DEFAULT_LIMITS,
): Promise<TranscriptTurn[]> {
  const maxTurns = Math.max(0, Math.min(HARD_MAX_TURNS, Math.floor(options.maxTurns ?? DEFAULT_MAX_TURNS)));
  const maxChars = Math.max(1, Math.min(HARD_MAX_CHARS, Math.floor(options.maxCharsPerTurn ?? DEFAULT_MAX_CHARS)));
  if (maxTurns === 0) return [];

  let candidates: Candidate[] = [];
  let seq = 0;
  let sawPrompt = false;
  // Held back until a later answer replaces it, so the final answer is known when the stream ends.
  let lastAnswer: Candidate | null = null;
  const toolSummaries = new Map<string, { name: string; summary: string }>();

  const push = (turn: TranscriptTurn, tier: Tier): void => {
    if (!turn.text) return;
    const candidate: Candidate = { turn, tier, seq: seq++ };
    if (turn.role === "assistant") {
      if (lastAnswer) candidates.push(lastAnswer);
      lastAnswer = candidate;
    } else {
      if (turn.role === "user" && !sawPrompt) {
        sawPrompt = true;
        candidate.tier = TIER.anchor;
      }
      candidates.push(candidate);
    }
    if (candidates.length >= MAX_CANDIDATES) {
      while (candidates.length >= MAX_CANDIDATES / 2) {
        const before = candidates.length;
        candidates = thin(candidates);
        if (candidates.length === before) break;
      }
    }
  };

  const typed = (kind: PromptKind, time: string, queued: boolean): void => {
    switch (kind.kind) {
      case "prompt":
        push({ timestamp: time, role: "user", text: scrub(queued ? `[sent while the agent was working] ${kind.text}` : kind.text, maxChars) }, TIER.person);
        break;
      case "slash":
        push({ timestamp: time, role: "user", text: scrub(`${kind.name} ${kind.args}`.trim(), maxChars) }, TIER.person);
        break;
      case "bash":
        push({ timestamp: time, role: "user", text: scrub(`! ${kind.command}`, maxChars) }, TIER.person);
        break;
      case "interrupt":
        push({ timestamp: time, role: "user", text: "[interrupted the agent]" }, TIER.person);
        break;
      case "agent":
        push({ timestamp: time, role: "agent", text: scrub(kind.text, maxChars) }, TIER.agent);
        break;
      case "harness":
        push({ timestamp: time, role: "tool", toolName: "harness", text: scrub(kind.text, Math.min(maxChars, TOOL_LINE_CHARS)) }, TIER.harness);
        break;
      default:
        break;
    }
  };

  const stem = basename(file.path, ".jsonl");
  const stemIsSession = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem);
  for await (const row of readJsonl(file.path, limits)) {
    if (row.kind !== "record") continue;
    const record = row.value;
    if (record.isSidechain === true) continue;
    // History copied in from an earlier session on resume belongs to that session's excerpt.
    if (stemIsSession && typeof record.sessionId === "string" && record.sessionId !== stem) continue;
    const time = isoTime(record.timestamp);
    if (!time) continue;
    const message = obj(record.message);

    if (record.type === "assistant") {
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        const b = obj(block);
        if (b.type === "text") {
          push({ timestamp: time, role: "assistant", text: scrub(str(b.text), maxChars) }, TIER.answer);
        } else if (b.type === "tool_use") {
          const name = str(b.name) || "unknown";
          const id = str(b.id);
          // Claude Code writes some tool blocks twice (once rewritten); show the call once.
          if (id && toolSummaries.has(id)) continue;
          const summary = toolSummary(name, obj(b.input));
          if (id && toolSummaries.size < MAX_CANDIDATES) toolSummaries.set(id, { name, summary });
          push({ timestamp: time, role: "tool", toolName: name, text: oneLine(summary || name, Math.min(maxChars, TOOL_LINE_CHARS)) }, TIER.tool);
        }
      }
    } else if (record.type === "user") {
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = obj(block);
          if (b.type !== "tool_result" || b.is_error !== true) continue;
          // Only failures are shown: they explain friction, and successful output is noise (and often private).
          const call = toolSummaries.get(str(b.tool_use_id));
          const context = call?.summary ? `${oneLine(call.summary, ERROR_CONTEXT_CHARS)} → ` : "";
          push(
            { timestamp: time, role: "tool", toolName: call?.name ?? "unknown", isError: true, text: scrub(`${context}${toolResultText(b.content)}`, maxChars) },
            TIER.failure,
          );
        }
      }
      if (record.isCompactSummary === true) continue;
      typed(classifyUserRecord(record), time, false);
    } else if (record.type === "attachment") {
      const attachment = obj(record.attachment);
      if (attachment.type !== "queued_command") continue;
      typed(classifyQueuedCommand(attachment), isoTime(attachment.timestamp) ?? time, true);
    }
  }
  const final = lastAnswer as Candidate | null;
  if (final) {
    final.tier = TIER.anchor;
    candidates.push(final);
  }

  const picked = options.around ? nearest(candidates, maxTurns, options.around) : byPriority(candidates, maxTurns);
  // About a quarter of the turns at full length, and never less than the default read.
  const budget = Math.max(MIN_BUDGET_CHARS, Math.floor((maxTurns * maxChars) / 4));
  return fitBudget(picked, budget).map((candidate) => candidate.turn);
}
