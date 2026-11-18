import type { UsageHolder } from "../analysis/period-usage.js";
import { HARD_MAX_SESSIONS, newer, safeDiscover, DEFAULT_MAX_SESSIONS, DEFAULT_CONCURRENCY, type ScanDeps } from "./scan.js";
import { mapLimit } from "./fs.js";
import { sessionKey } from "./store.js";
import type { Harness, Session, SessionFile, Source } from "../schema/types.js";
import type { UsageOnly } from "../sources/claude/usage.js";

/**
 * The scan reduced to what tokens and cost need, for numbers on screen within a second. It finds the same
 * transcripts, reuses cached sessions, and keeps cached sessions whose transcripts are gone, as `scan` does. A
 * Claude Code transcript that is not cached is read for its usage lines only (`readClaudeUsage`); everything else is
 * parsed in full. Wherever the usage-only reading could change the answer (two copies of one session, or a request
 * two sessions share, whose owner depends on start times it does not read), those transcripts are parsed in full,
 * so `periodUsage` over the result equals `periodUsage` over the full scan. It writes nothing to the store.
 */

export interface UsageScanDeps extends ScanDeps {
  /** Usage-only reading for a file, or null to parse it in full. Default: none (everything is parsed in full). */
  readUsage?: (source: Source, file: SessionFile) => Promise<UsageOnly | null>;
}

export interface UsageScanOptions {
  since?: Date;
  harness?: Harness | Harness[];
  maxSessions?: number;
  /** Told each time one agent's transcripts are all read, with that agent's sessions so far. */
  onHarness?: (harness: Harness, sessions: UsageSession[]) => void;
}

export interface UsageSession extends UsageHolder {
  endTime: string | null;
  /** The full Session, when it was parsed or cached. */
  session: Session | null;
}

export interface UsageScanResult {
  sessions: UsageSession[];
  stats: { discovered: number; cached: number; usageOnly: number; parsed: number; reparsed: number };
}

function fromSession(session: Session): UsageSession {
  return { harness: session.harness, id: session.id, startTime: session.startTime, endTime: session.endTime, requests: session.requests, session };
}

export async function usageScan(deps: UsageScanDeps, options: UsageScanOptions = {}): Promise<UsageScanResult> {
  const wanted = options.harness === undefined ? null : Array.isArray(options.harness) ? options.harness : [options.harness];
  const maxSessions = Math.max(1, Math.min(HARD_MAX_SESSIONS, Math.floor(options.maxSessions ?? DEFAULT_MAX_SESSIONS)));
  const active = deps.sources.filter((source) => !wanted || wanted.includes(source.harness));
  const byHarness = new Map(deps.sources.map((source) => [source.harness, source]));
  const parseOne = deps.parse ?? ((source: Source, file: SessionFile) => source.parse(file));
  const stats = { discovered: 0, cached: 0, usageOnly: 0, parsed: 0, reparsed: 0 };

  const discovered = await Promise.all(active.map(async (source) => (await safeDiscover(source, options.since, maxSessions)) ?? []));
  const all = discovered.flat().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxSessions);
  stats.discovered = all.length;

  const remaining = new Map<Harness, number>();
  for (const file of all) remaining.set(file.harness, (remaining.get(file.harness) ?? 0) + 1);
  const perHarness = new Map<Harness, UsageSession[]>();
  const settled = (harness: Harness, entry: UsageSession | null) => {
    if (entry) {
      let list = perHarness.get(harness);
      if (!list) perHarness.set(harness, (list = []));
      list.push(entry);
    }
    const left = (remaining.get(harness) ?? 1) - 1;
    remaining.set(harness, left);
    if (left === 0 && options.onHarness) {
      try {
        options.onHarness(harness, [...(perHarness.get(harness) ?? [])]);
      } catch {
        // A display callback must never cost the numbers.
      }
    }
  };

  const fullParse = async (source: Source, file: SessionFile): Promise<Session | null> => {
    try {
      const session = await parseOne(source, file, {});
      return session && session.harness === file.harness ? session : null;
    } catch {
      return null;
    }
  };

  const order = all.map((file, index) => ({ file, index })).sort((a, b) => b.file.sizeBytes - a.file.sizeBytes || a.index - b.index);
  const read = new Array<{ file: SessionFile; entry: UsageSession } | null>(all.length);
  await mapLimit(order, Math.max(DEFAULT_CONCURRENCY, deps.concurrency ?? DEFAULT_CONCURRENCY), async ({ file, index }) => {
    const source = byHarness.get(file.harness);
    let entry: UsageSession | null = null;
    if (source) {
      const cached = await deps.store.cachedSession(file, source.parserVersion).catch(() => undefined);
      if (cached !== undefined) {
        stats.cached += 1;
        entry = cached ? fromSession(cached) : null;
      } else {
        const usage = deps.readUsage ? await deps.readUsage(source, file).catch(() => null) : null;
        if (usage) {
          stats.usageOnly += 1;
          entry = { harness: file.harness, id: usage.id, startTime: null, endTime: null, requests: usage.requests, session: null };
        } else {
          stats.parsed += 1;
          const session = await fullParse(source, file);
          entry = session ? fromSession(session) : null;
        }
      }
    }
    read[index] = entry ? { file, entry } : null;
    settled(file.harness, entry);
  });

  const entries: Array<{ file: SessionFile; entry: UsageSession | null }> = read.filter((item) => item !== null);
  const known = new Set(all.map((file) => file.path));
  let room = maxSessions - all.length;
  for (const source of active) {
    if (room <= 0) break;
    const orphans = await deps.store
      .orphanSessions(source.harness, known, { limit: room, ...(options.since ? { sinceMs: options.since.getTime() } : {}) })
      .catch(() => []);
    for (const orphan of orphans) entries.push({ file: orphan.file, entry: fromSession(orphan.session) });
    room -= orphans.length;
  }

  // Which usage-only readings could change the answer: a session id seen twice (`scan` keeps the copy that ran
  // later), or a request id another session also holds (the earlier session keeps it).
  const ids = new Map<string, number>();
  const holders = new Map<string, number>();
  for (const { entry } of entries) {
    if (!entry) continue;
    ids.set(sessionKey(entry.harness, entry.id), (ids.get(sessionKey(entry.harness, entry.id)) ?? 0) + 1);
    for (const key of new Set(entry.requests.map((request) => `${entry.harness}\u0000${request.id}`))) holders.set(key, (holders.get(key) ?? 0) + 1);
  }
  const doubtful = entries.filter(
    ({ entry }) =>
      entry !== null &&
      entry.session === null &&
      ((ids.get(sessionKey(entry.harness, entry.id)) ?? 0) > 1 || entry.requests.some((request) => (holders.get(`${entry.harness}\u0000${request.id}`) ?? 0) > 1)),
  );
  await mapLimit(doubtful, DEFAULT_CONCURRENCY, async (item) => {
    const source = byHarness.get(item.file.harness);
    const session = source ? await fullParse(source, item.file) : null;
    stats.reparsed += 1;
    item.entry = session ? fromSession(session) : null;
  });

  // Every session id that occurs twice now has full sessions behind it, so this is `scan`'s own rule.
  const unique = new Map<string, UsageSession>();
  for (const { entry } of entries) {
    if (!entry) continue;
    const key = sessionKey(entry.harness, entry.id);
    const existing = unique.get(key);
    if (existing?.session && entry.session && newer(existing.session, entry.session) === existing.session) continue;
    unique.set(key, entry);
  }
  return { sessions: [...unique.values()], stats };
}
