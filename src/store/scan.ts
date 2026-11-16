import { HARNESSES, type Coverage, type Harness, type Retention, type Session, type SessionFile, type Source } from "../schema/types.js";
import { mapLimit } from "./fs.js";
import { ProjectRoots, resolveProjectRoots } from "./project-root.js";
import { measureRetention, readRetentionPolicies, type RetentionPolicy } from "./retention.js";
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
  /** The clock retention is measured against. */
  now?: () => Date;
  /**
   * How long each harness keeps transcripts. Default: read from this machine's settings files. False skips
   * the retention measurement (the report then has no `retention`).
   */
  retentionPolicies?: false | (() => Promise<Map<Harness, RetentionPolicy>>);
}

export interface ScanResult {
  sessions: Session[];
  coverage: Coverage[];
  /** `harness:id` to the transcript it came from, for excerpts. */
  files: Map<string, SessionFile>;
  /** `orphaned`: cached sessions kept although their transcript is gone. */
  stats: { discovered: number; parsed: number; cached: number; failed: number; skippedEmpty: number; duplicates: number; orphaned: number };
  scannedAt: string;
  options: { since: string | null; harness: Harness[] | null; maxSessions: number };
  /** Absent when the scan did not measure it, or measuring failed. */
  retention?: Retention;
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
  gemini: "Gemini CLI",
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

async function safeDiscover(source: Source, since: Date | undefined, maxFiles: number): Promise<SessionFile[] | null> {
  try {
    const files = await source.discover({ ...(since ? { since } : {}), maxFiles });
    return Array.isArray(files) ? files.filter((file) => file && file.harness === source.harness) : [];
  } catch {
    return null;
  }
}

interface ScannedEntry {
  file: SessionFile;
  session: Session;
  fresh: boolean;
  rootChanged?: boolean;
}

/**
 * Sets `projectRoot` on every session from the file system, cached ones included, so history cached
 * before roots existed gains them without a re-parse. A root already cached is kept when its folder has
 * since been deleted, because worktrees are routinely removed once merged.
 */
async function assignProjectRoots(entries: ScannedEntry[]): Promise<void> {
  const paths = entries.map((entry) => entry.session.projectPath).filter((path): path is string => typeof path === "string");
  const knownRoots = entries.map((entry) => entry.session.projectRoot).filter((root): root is string => typeof root === "string");
  const roots = await resolveProjectRoots(paths, { knownRoots }).catch(() => new ProjectRoots());
  for (const entry of entries) {
    const { session } = entry;
    const before = session.projectRoot;
    let after: string | undefined;
    if (typeof session.projectPath !== "string") after = undefined;
    else if (!roots.has(session.projectPath)) continue;
    else after = roots.get(session.projectPath) ?? (roots.missing.has(session.projectPath) && typeof before === "string" ? before : undefined);
    if (after === before) continue;
    const { projectRoot: _dropped, ...rest } = session;
    entry.session = after === undefined ? rest : { ...rest, projectRoot: after };
    entry.rootChanged = true;
  }
}

/** Usage counters read but not counted, kept apart from unreadable lines; absent when there were none. */
function skippedUsage(sessions: Session[]): { skippedUsageRecords?: number } {
  const total = sessions.reduce((sum, session) => sum + (session.skippedUsageRecords || 0), 0);
  return total > 0 ? { skippedUsageRecords: total } : {};
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
  const stats = { discovered: all.length, parsed: 0, cached: 0, failed: 0, skippedEmpty: 0, duplicates: 0, orphaned: 0 };

  const parsed = await mapLimit(all, concurrency, async (file): Promise<ScannedEntry | null> => {
    const source = byHarness.get(file.harness);
    if (!source) return null;
    if (!options.refresh) {
      const cached = await deps.store.cachedSession(file, source.parserVersion).catch(() => undefined);
      if (cached !== undefined) {
        stats.cached += 1;
        if (cached === null) stats.skippedEmpty += 1;
        return cached ? { file, session: cached, fresh: false } : null;
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
    if (!session) {
      stats.skippedEmpty += 1;
      await deps.store.cacheSession(file, null, source.parserVersion).catch(() => false);
      return null;
    }
    return { file, session, fresh: true };
  });

  const entries = parsed.filter((entry): entry is ScannedEntry => entry !== null);
  // History the harness deleted lives on in the cache; without it a long recap would shrink to the harness's retention.
  const known = new Set(all.map((file) => file.path));
  let room = maxSessions - all.length;
  const cachedOnly = new Map<Harness, Session[]>();
  for (const source of active) {
    if (room <= 0) break;
    const orphans = await deps.store
      .orphanSessions(source.harness, known, { limit: room, ...(options.since ? { sinceMs: options.since.getTime() } : {}) })
      .catch(() => []);
    cachedOnly.set(source.harness, orphans.map((orphan) => orphan.session));
    for (const orphan of orphans) entries.push({ file: orphan.file, session: orphan.session, fresh: false });
    stats.orphaned += orphans.length;
    room -= orphans.length;
  }
  await assignProjectRoots(entries);
  // New parses are cached only now, with their root, so a first scan writes each session once.
  await mapLimit(entries, concurrency, async (entry) => {
    if (entry.fresh || entry.rootChanged) await deps.store.cacheSession(entry.file, entry.session, byHarness.get(entry.file.harness)?.parserVersion).catch(() => false);
  });
  await deps.store.flush().catch(() => undefined);

  // Resumed or copied transcripts can yield the same id twice; keep the copy that ran latest.
  const unique = new Map<string, { file: SessionFile; session: Session }>();
  for (const entry of entries) {
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
    const note = source?.diagnose && (!wanted || wanted.includes(harness)) ? await source.diagnose().catch(() => null) : null;
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
      ...skippedUsage(harnessSessions),
      oldest: starts[0] ?? null,
      newest: ends[ends.length - 1] ?? null,
      // History that exists but cannot be read here is found, and counted as an issue, not silently absent.
      ...(note ? { note, found: true, issues: (issues.get(harness) ?? 0) + 1 + harnessSessions.reduce((sum, session) => sum + (session.issues || 0), 0) } : {}),
    });
  }

  const retention = await retentionFor(deps, active, discovered, entries, cachedOnly, options.since).catch(() => undefined);
  return {
    sessions,
    coverage,
    files,
    stats,
    scannedAt: new Date().toISOString(),
    options: { since: options.since?.toISOString() ?? null, harness: wanted, maxSessions },
    ...(retention ? { retention } : {}),
  };
}

async function retentionFor(
  deps: ScanDeps,
  active: Source[],
  discovered: Map<Harness, SessionFile[]>,
  entries: ScannedEntry[],
  cachedOnly: Map<Harness, Session[]>,
  since: Date | undefined,
): Promise<Retention | undefined> {
  if (deps.retentionPolicies === false) return undefined;
  const all = await (deps.retentionPolicies ?? readRetentionPolicies)();
  const policies = new Map([...all].filter(([harness]) => active.some((source) => source.harness === harness)));
  const files = new Map(discovered);
  // Files about to be deleted are old, so a narrow `since` would hide exactly them: list deleting harnesses in full.
  if (since) {
    for (const source of active) {
      if (policies.get(source.harness)?.policy !== "deletes") continue;
      const full = await safeDiscover(source, undefined, HARD_MAX_SESSIONS);
      if (full) files.set(source.harness, full);
    }
  }
  const sessionsByPath = new Map(entries.map((entry) => [entry.file.path, entry.session]));
  return measureRetention({ now: deps.now?.() ?? new Date(), policies, files, sessionsByPath, cachedOnly });
}
