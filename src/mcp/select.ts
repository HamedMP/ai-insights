import type { Harness, Session } from "../schema/types.js";
import { isSlashCommandOnly } from "../store/pipeline.js";

/** A transcript written to this recently is probably a session that is still running. */
export const LIVE_WINDOW_MS = 10 * 60 * 1000;

export function isLive(mtimeMs: number, now: Date): boolean {
  return Number.isFinite(mtimeMs) && now.getTime() - mtimeMs < LIVE_WINDOW_MS;
}

export { isSlashCommandOnly };

/** Other agents spoke more than the person did, so the session was mostly steered by automation. */
export function isAgentDriven(session: Session): boolean {
  return (session.agentMessageCount ?? 0) > session.userMessageCount;
}

/** Default floor of the person's own prompts for a session to be worth a facet. */
export const DEFAULT_MIN_USER_MESSAGES = 2;

export interface SkipCounts {
  live: number;
  slashCommandOnly: number;
  fewPrompts: number;
}

export interface CandidateRules {
  harness?: Harness | undefined;
  /** Only sessions that need a facet: none saved yet, or a stale one (see `staleFacet`). */
  missingOnly: boolean;
  minUserMessages: number;
  skipLive: boolean;
  skipSlashCommandOnly: boolean;
  hasFacet: (session: Session) => boolean;
  /** The saved facet no longer describes the session; offered again unless this is absent or returns false. */
  staleFacet?: (session: Session) => boolean;
  live: (session: Session) => boolean;
}

/** The sessions a listing offers under `rules`, how many each rule held back, and how many are re-judgements. */
export function filterCandidates(sessions: Session[], rules: CandidateRules): { matching: Session[]; skipped: SkipCounts; stale: number } {
  const skipped: SkipCounts = { live: 0, slashCommandOnly: 0, fewPrompts: 0 };
  const stale = (session: Session) => rules.hasFacet(session) && (rules.staleFacet?.(session) ?? false);
  const matching = sessions.filter((session) => {
    if (rules.harness && session.harness !== rules.harness) return false;
    if (rules.missingOnly && rules.hasFacet(session) && !stale(session)) return false;
    if (rules.skipLive && rules.live(session)) {
      skipped.live += 1;
      return false;
    }
    if (rules.skipSlashCommandOnly && isSlashCommandOnly(session)) {
      skipped.slashCommandOnly += 1;
      return false;
    }
    if (session.userMessageCount < rules.minUserMessages) {
      skipped.fewPrompts += 1;
      return false;
    }
    return true;
  });
  return { matching, skipped, stale: rules.missingOnly ? matching.filter(stale).length : 0 };
}

/** What a default missing-facet listing would still offer: the number to tell the person, kept in step with that listing. */
export function facetBacklog(
  sessions: Session[],
  facets: { hasFacet: (session: Session) => boolean; staleFacet: (session: Session) => boolean },
  live: (session: Session) => boolean,
) {
  const { matching, skipped, stale } = filterCandidates(sessions, {
    missingOnly: true,
    minUserMessages: DEFAULT_MIN_USER_MESSAGES,
    skipLive: true,
    skipSlashCommandOnly: true,
    hasFacet: facets.hasFacet,
    staleFacet: facets.staleFacet,
    live,
  });
  return { toJudge: matching.length, stale, skipped };
}

/**
 * Chronological positions in an order where every prefix covers the range:
 * newest, oldest, then midpoints at ever finer steps (van der Corput).
 */
export function spreadPositions(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const order: number[] = [0, count - 1];
  const seen = new Set(order);
  for (let denominator = 2; order.length < count && denominator <= count * 2; denominator *= 2) {
    for (let numerator = 1; numerator < denominator; numerator += 2) {
      const position = Math.round((numerator / denominator) * (count - 1));
      if (!seen.has(position)) {
        seen.add(position);
        order.push(position);
      }
    }
  }
  for (let position = 0; position < count && order.length < count; position += 1) {
    if (!seen.has(position)) order.push(position);
  }
  return order;
}

/**
 * Orders sessions so that any prefix is a fair sample: every harness with
 * sessions appears early, harnesses then get slots in proportion to their
 * share, and within a harness picks spread across its whole time range. The
 * order depends only on the input set, so offset paging stays consistent.
 */
export function spreadOrder(sessions: Session[]): Session[] {
  const groups = new Map<Harness, Session[]>();
  for (const session of sessions) {
    const group = groups.get(session.harness) ?? [];
    group.push(session);
    groups.set(session.harness, group);
  }
  const queues = [...groups.entries()]
    .map(([harness, group]) => {
      const newestFirst = [...group].sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime) || a.id.localeCompare(b.id));
      return { harness, size: newestFirst.length, taken: 0, items: spreadPositions(newestFirst.length).map((index) => newestFirst[index]!) };
    })
    .sort((a, b) => b.size - a.size || a.harness.localeCompare(b.harness));

  const total = sessions.length;
  const out: Session[] = [];
  for (const queue of queues) {
    out.push(queue.items[0]!);
    queue.taken = 1;
  }
  while (out.length < total) {
    // Largest shortfall against a proportional share goes next.
    let best: (typeof queues)[number] | null = null;
    let bestDeficit = -Infinity;
    for (const queue of queues) {
      if (queue.taken >= queue.size) continue;
      const deficit = (queue.size * (out.length + 1)) / total - queue.taken;
      if (deficit > bestDeficit) {
        best = queue;
        bestDeficit = deficit;
      }
    }
    if (!best) break;
    out.push(best.items[best.taken]!);
    best.taken += 1;
  }
  return out;
}
