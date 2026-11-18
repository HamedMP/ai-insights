import { currentRange, isoInZone, PERIOD_KINDS, summarizePeriods, type PeriodKind, type PeriodSummary, type SummarizeOptions } from "../analysis/periods.js";
import { DIGEST_FILE, DIGEST_SCHEMA_VERSION, type Digest, type DigestPeriod } from "../nudge/digest.js";
import { isChatHarness, type Session } from "../schema/types.js";
import { writeFileAtomic } from "../store/fs.js";
import { join } from "node:path";

/**
 * The digest (docs/digest-json.md) the commands a person runs leave in the store, for readers that must not read
 * history: the session-start hook, the statusline and scheduled notifications. Counts, cost and a tip kind only.
 */
export function buildDigest(sessions: Session[], options: Omit<SummarizeOptions, "byProject" | "noTip">, known: Partial<Record<PeriodKind, PeriodSummary>> = {}): Digest {
  const ranges = PERIOD_KINDS.map((kind) => currentRange(kind, options.now, options.timeZone));
  // Periods the caller has already summarised (with the same clock) are not worked out twice: the tips cost most.
  const missing = PERIOD_KINDS.map((kind, index) => ({ kind, index })).filter(({ kind }) => !known[kind]);
  const computed = summarizePeriods(sessions, missing.map(({ index }) => ranges[index]!), options);
  const summaries = PERIOD_KINDS.map((kind) => known[kind] ?? computed[missing.findIndex((entry) => entry.kind === kind)]!);
  const now = options.now.getTime();
  const entries = PERIOD_KINDS.map((kind, index): [string, DigestPeriod] => {
    const range = ranges[index]!;
    const summary = summaries[index]!;
    let contextResets = 0;
    for (const session of sessions) {
      if (isChatHarness(session.harness)) continue;
      const start = Date.parse(session.startTime);
      const end = Date.parse(session.endTime);
      if (start < range.to && end >= range.from) contextResets += Math.max(0, session.features.compactions || 0);
    }
    return [
      kind,
      {
        from: isoInZone(range.from, options.timeZone),
        to: isoInZone(Math.min(range.to, now), options.timeZone),
        sessions: summary.sessions,
        activeMinutes: summary.activeMinutes,
        prompts: summary.prompts,
        contextResets,
        tokens: summary.tokens ? summary.tokens.total : null,
        costUsd: summary.costUsd,
        tip: summary.tip ? { id: summary.tip.id } : null,
      },
    ];
  });
  return { schemaVersion: DIGEST_SCHEMA_VERSION, writtenAt: options.now.toISOString(), timezone: options.timeZone, periods: Object.fromEntries(entries) as Digest["periods"] };
}

/** Writes the digest; a store that cannot be written loses only the digest, never the command's own output. */
export async function saveDigest(home: string, digest: Digest): Promise<boolean> {
  try {
    await writeFileAtomic(join(home, DIGEST_FILE), `${JSON.stringify(digest)}\n`);
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
