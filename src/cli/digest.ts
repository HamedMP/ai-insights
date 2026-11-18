import { currentRange, isoInZone, PERIOD_KINDS, periodStartDay, startOfDay, summarizePeriods, type PeriodKind, type PeriodRange, type PeriodSummary, type SummarizeOptions } from "../analysis/periods.js";
import { makeClock } from "../analysis/time.js";
import { DIGEST_PERIODS, DIGEST_VERSION, writeDigest, type Digest, type DigestPeriod, type DigestPeriodKind } from "../nudge/digest.js";
import { isChatHarness, type Session } from "../schema/types.js";

/**
 * The digest (docs/digest-json.md) the commands a person runs leave in the store, for readers that must not read
 * history: the session-start hook, the statusline and scheduled notifications. Counts, cost and a tip kind only.
 */
/** The whole period of `kind` before the current one: yesterday, last week (Mon to Sun), last month. */
export function previousRange(kind: PeriodKind, now: Date, timeZone: string): PeriodRange {
  const clock = makeClock(timeZone);
  const today = clock.dayOfMs(now.getTime());
  const scope = { today: "yesterday", week: "last week", month: "last month" }[kind];
  return { kind, from: startOfDay(periodStartDay(kind, today, 1), clock), to: currentRange(kind, now, timeZone).from, scope };
}

const PREVIOUS_KEY: Record<PeriodKind, DigestPeriodKind> = { today: "yesterday", week: "lastWeek", month: "lastMonth" };

/**
 * The digest (docs/digest-json.md) for the current and the previous day, week and month. Periods the caller has
 * already summarised with the same clock are passed in `known` and not worked out again: the tips cost most.
 */
export function buildDigest(sessions: Session[], options: Omit<SummarizeOptions, "byProject" | "noTip">, known: Partial<Record<PeriodKind, PeriodSummary>> = {}): Digest {
  const wanted: Array<{ key: DigestPeriodKind; range: PeriodRange; summary?: PeriodSummary }> = [];
  for (const kind of PERIOD_KINDS) {
    wanted.push({ key: kind, range: currentRange(kind, options.now, options.timeZone), ...(known[kind] ? { summary: known[kind] } : {}) });
    wanted.push({ key: PREVIOUS_KEY[kind], range: previousRange(kind, options.now, options.timeZone) });
  }
  const missing = wanted.filter((entry) => !entry.summary);
  summarizePeriods(sessions, missing.map((entry) => entry.range), options).forEach((summary, index) => (missing[index]!.summary = summary));
  const now = options.now.getTime();
  const periods: Partial<Record<DigestPeriodKind, DigestPeriod>> = {};
  for (const { key, range, summary } of wanted) {
    let contextResets = 0;
    for (const session of sessions) {
      if (isChatHarness(session.harness)) continue;
      const start = Date.parse(session.startTime);
      const end = Date.parse(session.endTime);
      if (start < range.to && end >= range.from) contextResets += Math.max(0, session.features.compactions || 0);
    }
    periods[key] = {
      from: isoInZone(range.from, options.timeZone),
      to: isoInZone(Math.min(range.to, now), options.timeZone),
      sessions: summary!.sessions,
      activeMinutes: summary!.activeMinutes,
      prompts: summary!.prompts,
      contextResets,
      tokens: summary!.tokens ? summary!.tokens.total : null,
      costUsd: summary!.costUsd,
      tip: summary!.tip ? { id: summary!.tip.id } : null,
    };
  }
  const ordered = Object.fromEntries(DIGEST_PERIODS.map((key) => [key, periods[key]!])) as Digest["periods"];
  return { v: DIGEST_VERSION, writtenAt: options.now.toISOString(), timezone: options.timeZone, periods: ordered };
}

/** Writes the digest; a store that cannot be written loses only the digest, never the command's own output. */
export async function saveDigest(home: string, digest: Digest): Promise<boolean> {
  try {
    await writeDigest(home, digest);
    return true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return false;
  }
}

/** A digest written this recently is left as it is by the quick views, which people and tray apps run often. */
export const DIGEST_FRESH_MS = 10 * 60_000;

export async function digestIsFresh(home: string, now: Date): Promise<boolean> {
  const { readDigest } = await import("../nudge/digest.js");
  const saved = await readDigest(home);
  const age = saved ? now.getTime() - Date.parse(saved.writtenAt) : Number.POSITIVE_INFINITY;
  return age >= 0 && age < DIGEST_FRESH_MS;
}
