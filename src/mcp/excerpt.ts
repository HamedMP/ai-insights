import type { TranscriptTurn } from "../schema/types.js";
import { truncate } from "../sources/shared.js";

/** Default excerpt budget: enough to judge a session, small enough to read thirty of them. */
export const DEFAULT_EXCERPT_CHARS = 4_000;
export const DEFAULT_EXCERPT_TURNS = 24;
export const DEFAULT_EXCERPT_CHARS_PER_TURN = 600;

const ROUTINE_TOOL_CHARS = 160;
const ROUTINE_ASSISTANT_CHARS = 300;

interface Slot {
  turn: TranscriptTurn;
  important: boolean;
  routineTool: boolean;
}

function total(slots: Slot[]): number {
  return slots.reduce((sum, slot) => sum + slot.turn.text.length, 0);
}

function shorten(slot: Slot, max: number): void {
  if (slot.turn.text.length > max) slot.turn = { ...slot.turn, text: truncate(slot.turn.text, max) };
}

/**
 * Fit turns into `maxChars` of text. What the person and other agents said,
 * tool errors and the final assistant reply carry the signal, so routine tool
 * output is cut first, then routine assistant text, then routine tool turns are
 * thinned out, and only then is everything trimmed evenly.
 */
export function fitTurns(turns: TranscriptTurn[], maxChars: number): { turns: TranscriptTurn[]; omitted: number } {
  let lastAssistant = -1;
  turns.forEach((turn, index) => {
    if (turn.role === "assistant") lastAssistant = index;
  });
  let slots: Slot[] = turns.map((turn, index) => ({
    turn,
    important: turn.role === "user" || turn.role === "agent" || turn.isError === true || index === lastAssistant,
    routineTool: turn.role === "tool" && turn.isError !== true,
  }));
  const original = slots.length;
  if (total(slots) <= maxChars) return { turns: slots.map((slot) => slot.turn), omitted: 0 };

  for (const slot of slots) if (slot.routineTool) shorten(slot, ROUTINE_TOOL_CHARS);
  if (total(slots) > maxChars) {
    for (const slot of slots) if (!slot.important && !slot.routineTool) shorten(slot, ROUTINE_ASSISTANT_CHARS);
  }
  if (total(slots) > maxChars) {
    const routine = slots.filter((slot) => slot.routineTool);
    const room = maxChars - total(slots.filter((slot) => !slot.routineTool));
    const keep = Math.max(0, Math.min(routine.length, Math.floor(room / ROUTINE_TOOL_CHARS)));
    const kept = new Set<Slot>();
    for (let index = 0; index < keep; index += 1) kept.add(routine[Math.floor(((index + 0.5) * routine.length) / keep)]!);
    slots = slots.filter((slot) => !slot.routineTool || kept.has(slot));
  }
  if (total(slots) > maxChars && slots.length > 0) {
    // Largest per-turn cap that fits: short turns stay whole, long ones share what is left.
    let low = 1;
    let high = Math.max(...slots.map((slot) => slot.turn.text.length));
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const used = slots.reduce((sum, slot) => sum + Math.min(slot.turn.text.length, mid), 0);
      if (used <= maxChars) low = mid;
      else high = mid - 1;
    }
    for (const slot of slots) shorten(slot, low);
  }
  return { turns: slots.map((slot) => slot.turn), omitted: original - slots.length };
}
