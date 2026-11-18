import { HARNESSES, type Coverage, type Harness, type Retention, type Session, type SessionFile, type Source } from "../schema/types.js";
import { mapLimit } from "./fs.js";
import { ProjectRoots, resolveProjectRoots } from "./project-root.js";
import { measureRetention, readRetentionPolicies, type RetentionPolicy } from "./retention.js";
import { sessionKey, type Store } from "./store.js";

export interface ScanOptions {
  /** Only history modified at or after this instant. */
  since?: Date;
  /** Only sessions that started before this instant. A session that ran on past it counts whole. */
  until?: Date;
  /** Only these harnesses. Coverage still lists every harness. */
  harness?: Harness | Harness[];
  /** Newest first across all harnesses; stop after this many transcript files. */
  maxSessions?: number;
  /** Parse everything again, ignoring the cache. */
  refresh?: boolean;
  /** Parallel parses. */
  concurrency?: number;
  /** Transcript bytes parsed at once, at most; one larger transcript is parsed on its own. */
  parseBudgetBytes?: number;
  /** Told what the scan is doing, for a progress display. A callback that throws is ignored. */
  onProgress?: (event: ScanProgress) => void;
}

/** What a scan is doing, in the order it happens. */
export type ScanProgress =
  | { stage: "find"; found: Array<{ harness: Harness; files: number }>; pending: number }
  | { stage: "read"; done: number; total: number; cached: number }
  | { stage: "save" }
  | { stage: "check" };

/** Calls a progress callback without letting it break the work it reports on. */
export function notify<T>(callback: ((event: T) => void) | undefined, event: T): void {
  if (!callback) return;
  try {
    callback(event);
  } catch {
    // A broken display (a closed terminal, a bug in the renderer) must never cost the scan or the report.
  }
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
  /**
   * Parses one transcript. Default: `source.parse(file)`. The CLI passes one that uses worker threads and resumes
   * appended transcripts; it must give the same Session `source.parse` would.
   */
  parse?: (source: Source, file: SessionFile, flags: { refresh?: boolean }) => Promise<Session | null>;
  /** Parses at once when `concurrency` is not given. Default: DEFAULT_CONCURRENCY. */
  concurrency?: number;
  /** Transcript bytes parsed at once when `parseBudgetBytes` is not given; workers each have their own heap. */
  parseBudgetBytes?: number;
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
/**
 * A 400 MB Codex rollout with its guardian threads needs about 300 MB of live parse state, so several of them at
 * once are the worst case; the parsed sessions themselves are small (about 150 MB for 545 sessions of a 4 GB
 * history). Most of the peak resident size seen on large histories is V8 deferring collection, not live data:
 * the same scan under `--max-old-space-size=400` gives the same result in the same time.
 */
export const DEFAULT_PARSE_BUDGET_BYTES = 512 * 1024 * 1024;

/** Admits work while the bytes in flight stay within the budget; something larger than it waits to run alone. */
class ByteBudget {
  private used = 0;
  private readonly waiting: Array<{ bytes: number; resolve: () => void }> = [];

  constructor(private readonly limit: number) {}

  async run<T>(bytes: number, work: () => Promise<T>): Promise<T> {
    const cost = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
    // The bytes are reserved before the work starts, here or by `wake` when a waiter is let in.
    if (this.fits(cost) && this.waiting.length === 0) this.used += cost;
    else await new Promise<void>((resolve) => this.waiting.push({ bytes: cost, resolve }));
    try {
      return await work();
    } finally {
      this.used -= cost;
      this.wake();
    }
  }

  private fits(cost: number): boolean {
    return this.used === 0 || this.used + cost <= this.limit;
  }

  /** First come, first served, so a large transcript is not starved by a stream of small ones. */
  private wake(): void {
    while (this.waiting.length && this.fits(this.waiting[0]!.bytes)) {
      const next = this.waiting.shift()!;
      this.used += next.bytes;
      next.resolve();
    }
  }
}

/** Labels for harnesses that have no source yet, so coverage can still name them. */
const FALLBACK_LABELS: Record<Harness, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  pi: "Pi",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  "claude-chat": "Claude chat",
  chatgpt: "ChatGPT",
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

export async function safeDiscover(source: Source, since: Date | undefined, maxFiles: number): Promise<SessionFile[] | null> {
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

export function newer<S extends Pick<Session, "endTime">>(a: S, b: S): S {
  return Date.parse(b.endTime) > Date.parse(a.endTime) ? b : a;
}

/**
 * Discover across every source, parse with bounded concurrency, reuse the cache,
 * and build coverage for every harness. Never throws because one source failed.
 */
export async function scan(deps: ScanDeps, options: ScanOptions = {}): Promise<ScanResult> {
  const wanted = options.harness === undefined ? null : Array.isArray(options.harness) ? options.harness : [options.harness];
  const maxSessions = Math.max(1, Math.min(HARD_MAX_SESSIONS, Math.floor(options.maxSessions ?? DEFAULT_MAX_SESSIONS)));
  const concurrency = Math.max(1, Math.min(32, options.concurrency ?? deps.concurrency ?? DEFAULT_CONCURRENCY));
  const parseOne = deps.parse ?? ((source: Source, file: SessionFile) => source.parse(file));
  const parseFlags = options.refresh ? { refresh: true } : {};
  const active = deps.sources.filter((source) => !wanted || wanted.includes(source.harness));

  const issues = new Map<Harness, number>();
  const bump = (harness: Harness, by = 1) => issues.set(harness, (issues.get(harness) ?? 0) + by);

  const discovered = new Map<Harness, SessionFile[]>();
  const progress = options.onProgress;
  const found: Array<{ harness: Harness; files: number }> = [];
  notify(progress, { stage: "find", found: [], pending: active.length });
  await Promise.all(
    active.map(async (source) => {
      const files = await safeDiscover(source, options.since, maxSessions);
      if (files === null) bump(source.harness);
      discovered.set(source.harness, files ?? []);
      if (files?.length) found.push({ harness: source.harness, files: files.length });
      notify(progress, { stage: "find", found: [...found], pending: active.length - discovered.size });
    }),
  );

  const all = [...discovered.values()].flat().sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxSessions);
  const byHarness = new Map(deps.sources.map((source) => [source.harness, source]));
  const stats = { discovered: all.length, parsed: 0, cached: 0, failed: 0, skippedEmpty: 0, duplicates: 0, orphaned: 0 };

  const budget = new ByteBudget(Math.max(1, options.parseBudgetBytes ?? deps.parseBudgetBytes ?? DEFAULT_PARSE_BUDGET_BYTES));
  let done = 0;
  const read = () => {
    done += 1;
    notify(progress, { stage: "read", done, total: all.length, cached: stats.cached });
  };
  notify(progress, { stage: "read", done: 0, total: all.length, cached: 0 });
  // Largest first, so the longest parse starts at once instead of holding up the end; results keep the newest-first order.
  const order = all.map((file, index) => ({ file, index })).sort((a, b) => b.file.sizeBytes - a.file.sizeBytes || a.index - b.index);
  const parsed = new Array<ScannedEntry | null>(all.length);
  await mapLimit(order, concurrency, async ({ file, index }) => {
    try {
      parsed[index] = await readOne(file);
    } finally {
      read();
    }
  });
  async function readOne(file: SessionFile): Promise<ScannedEntry | null> {
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
      session = await budget.run(file.sizeBytes, () => parseOne(source, file, parseFlags));
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
  }

  notify(progress, { stage: "save" });
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
  const until = options.until?.getTime();
  const sessions = [...unique.values()]
    .map((entry) => entry.session)
    .filter((session) => until === undefined || Date.parse(session.startTime) < until)
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  const files = new Map([...unique].map(([key, entry]) => [key, entry.file]));

  notify(progress, { stage: "check" });
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
