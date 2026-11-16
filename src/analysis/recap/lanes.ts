import type { RecapLanes, Session } from "../../schema/types.js";
import { activeSpans } from "../activity.js";

/** Six hours around the peak: long enough to show sessions coming and going, short enough to read. */
const WINDOW_MS = 6 * 60 * 60_000;
const MAX_LANES = 20;
const MAX_STRETCHES = 20;
const MINUTE = 60_000;

const minutes = (ms: number): number => Math.round((ms / MINUTE) * 100) / 100;

/** Merges the closest neighbours until at most `max` stretches remain, so a busy lane keeps its shape. */
function cap(stretches: Array<[number, number]>, max: number): Array<[number, number]> {
  const out = stretches.map(([a, b]) => [a, b] as [number, number]);
  while (out.length > max) {
    let best = 0;
    for (let index = 1; index < out.length - 1; index += 1) if (out[index + 1]![0] - out[index]![1] < out[best + 1]![0] - out[best]![1]) best = index;
    out.splice(best, 2, [out[best]![0], out[best + 1]![1]]);
  }
  return out;
}

/**
 * The lanes for the most-agents-at-once card. The peak is found the way `Activity.parallelSessions` finds
 * `maxConcurrent` (the same active spans, ends before starts at one instant), so the lanes agree with the count.
 */
export function buildLanes(sessions: Session[], maxConcurrent: number): RecapLanes | undefined {
  if (maxConcurrent < 2) return undefined;
  const spans = sessions.map((session) => activeSpans(session));
  const events: Array<{ at: number; delta: 1 | -1; session: number }> = [];
  spans.forEach((list, index) => {
    for (const [start, end] of list) events.push({ at: start, delta: 1, session: index }, { at: end, delta: -1, session: index });
  });
  events.sort((a, b) => a.at - b.at || a.delta - b.delta || a.session - b.session);
  const open = new Map<number, number>();
  let peak: number | null = null;
  for (const event of events) {
    if (event.delta === -1) {
      const left = (open.get(event.session) ?? 1) - 1;
      if (left <= 0) open.delete(event.session);
      else open.set(event.session, left);
      continue;
    }
    open.set(event.session, (open.get(event.session) ?? 0) + 1);
    if (open.size >= maxConcurrent) {
      peak = event.at;
      break;
    }
  }
  if (peak === null) return undefined;
  const from = peak - WINDOW_MS / 2;
  const to = peak + WINDOW_MS / 2;
  const activeAt = (list: Array<[number, number]>) => list.some(([start, end]) => start <= peak! && peak! < end);

  const candidates = sessions
    .map((session, index) => {
      const inside = spans[index]!
        .filter(([start, end]) => end > from && start < to)
        .map(([start, end]) => [Math.max(start, from), Math.min(end, to)] as [number, number]);
      return { session, inside, atPeak: activeAt(spans[index]!) };
    })
    .filter((lane) => lane.inside.length > 0);
  const atPeak = candidates.filter((lane) => lane.atPeak);
  const others = candidates
    .filter((lane) => !lane.atPeak)
    .map((lane) => ({ ...lane, overlap: lane.inside.reduce((sum, [a, b]) => sum + (b - a), 0) }))
    .sort((a, b) => b.overlap - a.overlap || a.inside[0]![0] - b.inside[0]![0] || a.session.id.localeCompare(b.session.id));
  const chosen = [...atPeak, ...others.slice(0, Math.max(0, MAX_LANES - atPeak.length))];

  const peakAt = minutes(peak - from);
  const step = 0.01;
  const lanes = chosen
    .sort((a, b) => a.inside[0]![0] - b.inside[0]![0] || a.session.harness.localeCompare(b.session.harness) || a.session.id.localeCompare(b.session.id))
    .map((lane) => {
      const active = cap(lane.inside, MAX_STRETCHES).map(([start, end]): [number, number] => {
        let a = minutes(start - from);
        let b = minutes(end - from);
        // Rounding must not move a stretch across the peak: the lanes drawn at the peak are the count shown.
        const covers = start <= peak! && peak! < end;
        if (covers) {
          a = Math.min(a, peakAt);
          b = Math.max(b, Math.round((peakAt + step) * 100) / 100);
        } else if (end <= peak!) b = Math.min(b, peakAt);
        else a = Math.max(a, Math.round((peakAt + step) * 100) / 100);
        return [a, Math.max(a, b)];
      });
      return { harness: lane.session.harness, start: active[0]![0], end: active.at(-1)![1], active };
    });
  return { windowMinutes: WINDOW_MS / MINUTE, peakAt, atPeak: atPeak.length, lanes };
}
