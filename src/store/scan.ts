import { HARNESSES, type Coverage, type Harness, type Session, type SessionFile, type Source } from "../schema/types.js";
import { sessionKey, type Store } from "./store.js";

export interface ScanOptions {
  /** Only history modified at or after this instant. */
  since?: Date;
  /** Only these harnesses. Coverage still lists every harness. */
  harness?: Harness | Harness[];
  /** Newest first across all harnesses; stop after this many transcript files. */
  maxSessions?: number;
  /** Parse everything again, ignoring the cache. */
  refresh?: boolean;
  /** Parallel parses. */
  concurrency?: number;
}

export interface ScanDeps {
  sources: Source[];
  store: Store;
}

export interface ScanResult {
  sessions: Session[];
  coverage: Coverage[];
  /** `harness:id` to the transcript it came from, for excerpts. */
  files: Map<string, SessionFile>;
  stats: { discovered: number; parsed: number; cached: number; failed: number; skippedEmpty: number; duplicates: number };
  scannedAt: string;
  options: { since: string | null; harness: Harness[] | null; maxSessions: number };
}

export const DEFAULT_MAX_SESSIONS = 5_000;
export const HARD_MAX_SESSIONS = 50_000;
export const DEFAULT_CONCURRENCY = 6;

/** Labels for harnesses that have no source yet, so coverage can still name them. */
const FALLBACK_LABELS: Record<Harness, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  opencode: "OpenCode",
};

export function harnessLabel(harness: Harness, sources: Source[] = []): string {
  return sources.find((source) => source.harness === harness)?.label ?? FALLBACK_LABELS[harness];
}

/** Bytes on disk for a set of transcripts; a size a source could not measure counts as zero. */
export function totalBytes(files: SessionFile[]): number {
  let total = 0;
  for (const file of files) {
    if (Number.isFinite(file.sizeBytes) && file.sizeBytes > 0) total += file.sizeBytes;
  }
  return total;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function safeDiscover(source: Source, since: Date | undefined, maxFiles: number): Promise<SessionFile[] | null> {
  try {
    const files = await source.discover({ ...(since ? { since } : {}), maxFiles });
    return Array.isArray(files) ? files.filter((file) => file && file.harness === source.harness) : [];
  } catch {
    return null;
  }
}

function newer(a: Session, b: Session): Session {
  return Date.parse(b.endTime) > Date.parse(a.endTime) ? b : a;
}

/**
 * Discover across every source, parse with bounded concurrency, reuse the cache,
 * and build coverage for every harness. Never throws because one source failed.
 */
export async function scan(deps: ScanDeps, options: ScanOptions = {}): Promise<ScanResult> {
  const wanted = options.harness === undefined ? null : Array.isArray(options.harness) ? options.harness : [options.harness];
  const maxSessions = Math.max(1, Math.min(HARD_MAX_SESSIONS, Math.floor(options.maxSessions ?? DEFAULT_MAX_SESSIONS)));
  const concurrency = Math.max(1, Math.min(32, options.concurrency ?? DEFAULT_CONCURRENCY));
  const active = deps.sources.filter((source) => !wanted || wanted.includes(source.harness));

  const issues = new Map<Harness, number>();
  const bump = (harness: Harness, by = 1) => issues.set(harness, (issues.get(harness) ?? 0) + by);

  const discovered = new Map<Harness, SessionFile[]>();
  await Promise.all(
    active.map(async (source) => {
      const files = await safeDiscover(source, options.since, maxSessions);
      if (files === null) bump(source.harness);
      discovered.set(source.harness, files ?? []);
    }),
  );

  const all = [...discovered.values()].flat().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxSessions);
  const byHarness = new Map(deps.sources.map((source) => [source.harness, source]));
  const stats = { discovered: all.length, parsed: 0, cached: 0, failed: 0, skippedEmpty: 0, duplicates: 0 };

  const parsed = await mapLimit(all, concurrency, async (file) => {
    const source = byHarness.get(file.harness);
    if (!source) return null;
    if (!options.refresh) {
      const cached = await deps.store.cachedSession(file).catch(() => undefined);
      if (cached !== undefined) {
        stats.cached += 1;
        if (cached === null) stats.skippedEmpty += 1;
        return cached ? { file, session: cached } : null;
      }
    }
    let session: Session | null;
    try {
      session = await source.parse(file);
    } catch {
      stats.failed += 1;
      bump(file.harness);
      return null;
    }
    stats.parsed += 1;
    if (session && session.harness !== file.harness) session = null;
    if (!session) stats.skippedEmpty += 1;
    await deps.store.cacheSession(file, session).catch(() => false);
    return session ? { file, session } : null;
  });
  await deps.store.flush().catch(() => undefined);

  // Resumed or copied transcripts can yield the same id twice; keep the copy that ran latest.
  const unique = new Map<string, { file: SessionFile; session: Session }>();
  for (const entry of parsed) {
    if (!entry) continue;
    const key = sessionKey(entry.session.harness, entry.session.id);
    const existing = unique.get(key);
    if (existing) {
      stats.duplicates += 1;
      if (newer(existing.session, entry.session) === existing.session) continue;
    }
    unique.set(key, entry);
  }
  const sessions = [...unique.values()]
    .map((entry) => entry.session)
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  const files = new Map([...unique].map(([key, entry]) => [key, entry.file]));

  const coverage: Coverage[] = [];
  for (const harness of HARNESSES) {
    const source = byHarness.get(harness);
    const harnessFiles = discovered.get(harness) ?? [];
    const harnessSessions = sessions.filter((session) => session.harness === harness);
    let found = harnessFiles.length > 0;
    // A narrow `since` or a harness filter can hide history that does exist; check before saying "none".
    if (!found && source && (options.since || (wanted && !wanted.includes(harness)))) {
      found = ((await safeDiscover(source, undefined, 1)) ?? []).length > 0;
    }
    const starts = harnessSessions.map((session) => session.startTime).filter((value) => Number.isFinite(Date.parse(value))).sort();
    const ends = harnessSessions.map((session) => session.endTime).filter((value) => Number.isFinite(Date.parse(value))).sort();
    coverage.push({
      harness,
      label: harnessLabel(harness, deps.sources),
      found,
      files: harnessFiles.length,
      // Every discovered transcript, including ones the session cap or an empty parse left out.
      bytes: totalBytes(harnessFiles),
      sessions: harnessSessions.length,
      issues: (issues.get(harness) ?? 0) + harnessSessions.reduce((sum, session) => sum + (session.issues || 0), 0),
      oldest: starts[0] ?? null,
      newest: ends[ends.length - 1] ?? null,
    });
  }

  return {
    sessions,
    coverage,
    files,
    stats,
    scannedAt: new Date().toISOString(),
    options: { since: options.since?.toISOString() ?? null, harness: wanted, maxSessions },
  };
}
