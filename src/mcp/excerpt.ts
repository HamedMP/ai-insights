import type { TranscriptTurn } from "../schema/types.js";
import { truncate } from "../sources/shared.js";
import { spreadPositions } from "./select.js";

/** Default excerpt budget: enough to judge a session, small enough to read thirty of them. */
export const DEFAULT_EXCERPT_CHARS = 4_000;
export const DEFAULT_EXCERPT_TURNS = 24;
export const DEFAULT_EXCERPT_CHARS_PER_TURN = 600;
/** The first prompt is usually the brief: what the session was for. It keeps this much before anything else is cut. */
export const FIRST_PROMPT_CHARS = 600;
/** Below this, a turn says too little to judge from; sampling fewer turns beats cutting all of them shorter. */
export const MIN_TURN_CHARS = 160;

const ROUTINE_TOOL_CHARS = 160;
const ROUTINE_ASSISTANT_CHARS = 300;

export interface FitOptions {
  /** Characters a turn costs besides its text, such as the JSON around it. Default none. */
  overhead?: (turn: TranscriptTurn) => number;
  firstPromptChars?: number;
  minTurnChars?: number;
}

interface Slot {
  turn: TranscriptTurn;
  important: boolean;
  routineTool: boolean;
  /** The first prompt: cut only when nothing else is left to cut. */
  pinned: boolean;
  /** Never dropped: the first prompt and the final reply. */
  kept: boolean;
  overhead: number;
}

function cost(slots: Slot[]): number {
  return slots.reduce((sum, slot) => sum + slot.turn.text.length + slot.overhead, 0);
}

function shorten(slot: Slot, max: number): void {
  if (slot.turn.text.length > max) slot.turn = { ...slot.turn, text: max <= 0 ? "" : truncate(slot.turn.text, max) };
}

/** Largest per-turn cap that fits `budget`, Infinity when everything fits whole, 0 when even empty turns do not. */
function bestCap(slots: Slot[], budget: number): number {
  if (cost(slots) <= budget) return Infinity;
  let low = 0;
  let high = Math.max(0, ...slots.map((slot) => slot.turn.text.length));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const used = slots.reduce((sum, slot) => sum + Math.min(slot.turn.text.length, mid) + slot.overhead, 0);
    if (used <= budget) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** The turn to drop next from `group`: an interior one, so what is left still spans the session. */
function leastSpread(group: Slot[]): Slot | undefined {
  if (group.length === 0) return undefined;
  return group[spreadPositions(group.length).at(-1)!];
}

/**
 * Fit turns into `maxChars`. The first prompt (usually the brief) keeps up to `firstPromptChars`. What the
 * person and other agents said, tool errors and the final reply carry the signal, so routine tool output is
 * cut first, then routine assistant text, then routine tool turns are thinned out. Only then are the rest
 * trimmed evenly, and when that would leave turns too short to read, fewer turns are kept, spread across
 * the session, instead.
 */
export function fitTurns(turns: TranscriptTurn[], maxChars: number, options: FitOptions = {}): { turns: TranscriptTurn[]; omitted: number } {
  const overhead = options.overhead ?? (() => 0);
  const firstPromptChars = options.firstPromptChars ?? FIRST_PROMPT_CHARS;
  const minTurnChars = options.minTurnChars ?? MIN_TURN_CHARS;
  let lastAssistant = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "assistant") lastAssistant = index;
  });
  const firstUser = turns.findIndex((turn) => turn.role === "user");
  let slots: Slot[] = turns.map((turn, index) => ({
    turn,
    important: turn.role === "user" || turn.role === "agent" || turn.isError === true || index === lastAssistant,
    routineTool: turn.role === "tool" && turn.isError !== true,
    pinned: index === firstUser,
    kept: index === firstUser || index === lastAssistant,
    overhead: Math.max(0, overhead(turn)),
  }));
  const original = slots.length;
  if (cost(slots) <= maxChars) return { turns: slots.map((slot) => slot.turn), omitted: 0 };

  for (const slot of slots) if (slot.routineTool) shorten(slot, ROUTINE_TOOL_CHARS);
  if (cost(slots) > maxChars) {
    for (const slot of slots) if (!slot.important && !slot.routineTool) shorten(slot, ROUTINE_ASSISTANT_CHARS);
  }
  if (cost(slots) > maxChars) {
    const routine = slots.filter((slot) => slot.routineTool);
    const room = maxChars - cost(slots.filter((slot) => !slot.routineTool));
    const each = ROUTINE_TOOL_CHARS + (routine.length ? routine.reduce((sum, slot) => sum + slot.overhead, 0) / routine.length : 0);
    const keep = Math.max(0, Math.min(routine.length, Math.floor(room / each)));
    const keepSet = new Set<Slot>();
    for (let index = 0; index < keep; index += 1) keepSet.add(routine[Math.floor(((index + 0.5) * routine.length) / keep)]!);
    slots = slots.filter((slot) => !slot.routineTool || keepSet.has(slot));
  }
  if (cost(slots) > maxChars) {
    for (const slot of slots) if (slot.pinned) shorten(slot, firstPromptChars);
  }

  while (cost(slots) > maxChars) {
    const pinned = slots.filter((slot) => slot.pinned);
    const rest = slots.filter((slot) => !slot.pinned);
    const cap = bestCap(rest, maxChars - cost(pinned));
    if (cap >= minTurnChars) {
      for (const slot of rest) shorten(slot, cap);
      break;
    }
    const droppable = rest.filter((slot) => !slot.kept);
    const next =
      leastSpread(droppable.filter((slot) => slot.routineTool)) ??
      leastSpread(droppable.filter((slot) => !slot.important)) ??
      leastSpread(droppable);
    if (!next) {
      // Nothing left to drop: share what there is, the first prompt included.
      const shared = bestCap(slots, maxChars);
      for (const slot of slots) shorten(slot, shared);
      break;
    }
    slots = slots.filter((slot) => slot !== next);
  }
  return { turns: slots.map((slot) => slot.turn), omitted: original - slots.length };
}
