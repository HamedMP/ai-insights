import type { ExcerptOptions, TranscriptTurn } from "../../schema/types.js";
import { scrub } from "../shared.js";

export const DEFAULT_TURNS = 40;
export const DEFAULT_TURN_CHARS = 1_200;

export function excerptLimits(options: ExcerptOptions = {}): { maxTurns: number; maxChars: number } {
  return {
    maxTurns: Math.max(1, Math.min(options.maxTurns ?? DEFAULT_TURNS, 500)),
    maxChars: Math.max(20, Math.min(options.maxCharsPerTurn ?? DEFAULT_TURN_CHARS, 20_000)),
  };
}

function pickEvenly<T>(items: T[], count: number): T[] {
  if (count <= 0) return [];
  if (items.length <= count) return items;
  if (count === 1) return [items[items.length - 1]!];
  const picked: T[] = [];
  for (let step = 0; step < count; step += 1) picked.push(items[Math.round((step * (items.length - 1)) / (count - 1))]!);
  return picked;
}

/**
 * Keep what carries the signal when turns must be dropped: the person's prompts (the first one always, up to
 * half the slots), the final answer, failures and other agents' messages, then an even spread of the rest.
 */
export function selectTurns(turns: TranscriptTurn[], maxTurns: number, around?: string): TranscriptTurn[] {
  if (turns.length <= maxTurns) return turns;
  const target = around ? Date.parse(around) : Number.NaN;
  if (Number.isFinite(target)) {
    return turns
      .map((turn, index) => ({ index, distance: Math.abs((Date.parse(turn.timestamp) || 0) - target) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, maxTurns)
      .sort((a, b) => a.index - b.index)
      .map(({ index }) => turns[index]!);
  }
  const indexed = turns.map((turn, index) => ({ turn, index }));
  let finalIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]!.role === "assistant") {
      finalIndex = index;
      break;
    }
  }
  const users = indexed.filter(({ turn }) => turn.role === "user");
  const signals = indexed.filter(({ turn, index }) => index !== finalIndex && (turn.isError || turn.role === "agent"));
  const rest = indexed.filter(({ turn, index }) => index !== finalIndex && turn.role !== "user" && !turn.isError && turn.role !== "agent");
  const picked: typeof indexed = [];
  let room = maxTurns;
  if (finalIndex >= 0) {
    picked.push(indexed[finalIndex]!);
    room -= 1;
  }
  const userTake = Math.min(users.length, room, Math.max(Math.ceil(maxTurns / 2), room - signals.length - rest.length));
  if (userTake > 0) picked.push(users[0]!, ...pickEvenly(users.slice(1), userTake - 1));
  room -= userTake;
  const signalTake = Math.min(signals.length, Math.max(Math.ceil(room / 2), room - rest.length));
  picked.push(...pickEvenly(signals, signalTake));
  room -= signalTake;
  picked.push(...pickEvenly(rest, Math.min(rest.length, room)));
  return picked.sort((a, b) => a.index - b.index).map(({ turn }) => turn);
}

/** Scrub, cap and select collected turns. Later prompts get half the room so a pasted log cannot crowd out the brief. */
export function finishExcerpt(turns: TranscriptTurn[], options: ExcerptOptions = {}): TranscriptTurn[] {
  const { maxTurns, maxChars } = excerptLimits(options);
  const laterPromptChars = Math.max(200, Math.floor(maxChars / 2));
  let briefSeen = false;
  const scrubbed = turns
    .map((turn) => {
      let cap = maxChars;
      if (turn.role === "user") {
        if (briefSeen) cap = Math.min(maxChars, laterPromptChars);
        briefSeen = true;
      }
      return { ...turn, text: scrub(turn.text, cap) };
    })
    .filter((turn) => turn.text.length > 0);
  return selectTurns(scrubbed, maxTurns, options.around);
}
