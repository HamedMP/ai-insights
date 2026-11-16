import { readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { HARNESSES, type Harness, type Narrative, type Report, type Session, type SessionFacet, type SessionFile } from "../schema/types.js";
import { ensureDir, readJsonFile, writeFileAtomic } from "./fs.js";
import { NarrativeInputSchema, NarrativeSchema, SessionFacetSchema, SessionSchema, isSafeId } from "./schemas.js";

/** Where Hindsight keeps its cache: `HINDSIGHT_HOME`, else `~/.hindsight`. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HINDSIGHT_HOME?.trim();
  return override ? resolve(override) : join(homedir(), ".hindsight");
}

/** Bounds on how much of the store we will list in one go. */
export const MAX_FACETS = 20_000;
export const MAX_INDEX_ENTRIES = 50_000;
export const KEEP_REPORT_COPIES = 20;

interface IndexEntry {
  /** Null records a file that parsed to no session, so it is not re-parsed until it changes. */
  id: string | null;
  mtimeMs: number;
  /** `Source.parserVersion` that produced this entry; absent means "0". */
  parser?: string;
}

/** What the session looked like when its facet was written. */
export interface FacetJudgement {
  userMessages: number;
  endTime: string;
  /** The transcript was still being written to: the session was running. */
  live: boolean;
  at?: string;
}

export interface FacetRecord {
  facet: SessionFacet;
  judged: FacetJudgement | null;
  savedAtMs: number;
}

const JUDGED_KEY = "judged";

const JudgementSchema = z.strictObject({
  userMessages: z.number().int().min(0).max(1_000_000),
  endTime: z.string().max(40),
  live: z.boolean(),
  at: z.string().max(40).optional(),
});

/**
 * A facet describes the session as it was. Re-judge it when it was judged while still running, or the
 * session has since gained prompts or run later. Facets saved before snapshots existed fall back to
 * whether the session ran on after the facet file was written.
 */
export function isFacetStale(record: FacetRecord, session: Session): boolean {
  const end = Date.parse(session.endTime);
  // Without a snapshot, a transcript written to after the facet was saved means it was still running, or resumed.
  if (!record.judged) return (Number.isFinite(end) && end > record.savedAtMs) || session.sourceMtimeMs > record.savedAtMs;
  if (record.judged.live) return true;
  if (session.userMessageCount > record.judged.userMessages) return true;
  const judgedEnd = Date.parse(record.judged.endTime);
  return Number.isFinite(end) && Number.isFinite(judgedEnd) && end > judgedEnd;
}

/** What a source without a `parserVersion`, or a cache entry from before versions, counts as. */
export const DEFAULT_PARSER_VERSION = "0";
const MAX_PARSER_VERSION_CHARS = 64;

export function normaliseParserVersion(version: unknown): string {
  return typeof version === "string" && version.length > 0 && version.length <= MAX_PARSER_VERSION_CHARS ? version : DEFAULT_PARSER_VERSION;
}

export interface SavedReport {
  htmlPath: string;
  copyPath: string;
  jsonPath: string;
}

export class StoreError extends Error {}

function isHarness(value: string): value is Harness {
  return (HARNESSES as readonly string[]).includes(value);
}

function assertId(id: string): void {
  if (!isSafeId(id)) throw new StoreError("invalid session id");
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export class Store {
  readonly home: string;
  private readonly indexes = new Map<Harness, Map<string, IndexEntry>>();
  private readonly indexLoads = new Map<Harness, Promise<Map<string, IndexEntry>>>();
  private readonly dirtyIndexes = new Set<Harness>();

  constructor(home: string) {
    this.home = resolve(home);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Store {
    return new Store(resolveHome(env));
  }

  get reportsDir(): string {
    return join(this.home, "reports");
  }

  sessionPath(harness: Harness, id: string): string {
    assertId(id);
    return join(this.home, "sessions", harness, `${id}.json`);
  }

  facetPath(harness: Harness, id: string): string {
    assertId(id);
    return join(this.home, "facets", harness, `${id}.json`);
  }

  // -- session cache -------------------------------------------------------

  private indexPath(harness: Harness): string {
    return join(this.home, "sessions", harness, ".index.json");
  }

  private index(harness: Harness): Promise<Map<string, IndexEntry>> {
    // Concurrent parses ask at once; one shared load keeps them from each building a map and dropping the others' entries.
    let loading = this.indexLoads.get(harness);
    if (!loading) {
      loading = this.loadIndex(harness);
      this.indexLoads.set(harness, loading);
      loading.catch(() => this.indexLoads.delete(harness));
    }
    return loading;
  }

  private async loadIndex(harness: Harness): Promise<Map<string, IndexEntry>> {
    const map = new Map<string, IndexEntry>();
    const raw = await readJsonFile(this.indexPath(harness));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
        if (map.size >= MAX_INDEX_ENTRIES) break;
        if (!value || typeof value !== "object") continue;
        const { id, mtimeMs, parser } = value as Record<string, unknown>;
        if (typeof mtimeMs !== "number" || !(id === null || isSafeId(id))) continue;
        // Entries written before parser versions existed have none, which counts as "0".
        map.set(path, typeof parser === "string" && parser.length <= MAX_PARSER_VERSION_CHARS ? { id, mtimeMs, parser } : { id, mtimeMs });
      }
    }
    this.indexes.set(harness, map);
    return map;
  }

  /**
   * The cached parse of `file`, if it is still current.
   * `undefined`: no usable cache, parse it. `null`: known to hold no session.
   */
  async cachedSession(file: SessionFile, parserVersion?: string): Promise<Session | null | undefined> {
    const entry = (await this.index(file.harness)).get(file.path);
    if (!entry || entry.mtimeMs !== file.mtimeMs) return undefined;
    // A parser fix must reach history that has not changed on disk.
    if ((entry.parser ?? DEFAULT_PARSER_VERSION) !== normaliseParserVersion(parserVersion)) return undefined;
    if (entry.id === null) return null;
    const parsed = SessionSchema.safeParse(await readJsonFile(this.sessionPath(file.harness, entry.id)));
    if (!parsed.success) return undefined;
    const session = parsed.data as Session;
    if (session.sourcePath !== file.path || session.sourceMtimeMs !== file.mtimeMs || session.harness !== file.harness) return undefined;
    return session;
  }

  /** Caches a parse result. Sessions whose id is not file-name safe are returned but not cached. */
  async cacheSession(file: SessionFile, session: Session | null, parserVersion?: string): Promise<boolean> {
    const index = await this.index(file.harness);
    const parser = normaliseParserVersion(parserVersion);
    if (session === null) {
      index.set(file.path, { id: null, mtimeMs: file.mtimeMs, parser });
      this.dirtyIndexes.add(file.harness);
      return true;
    }
    if (!isSafeId(session.id) || session.harness !== file.harness) return false;
    await writeFileAtomic(this.sessionPath(session.harness, session.id), JSON.stringify(session));
    if (index.size < MAX_INDEX_ENTRIES || index.has(file.path)) {
      index.set(file.path, { id: session.id, mtimeMs: file.mtimeMs, parser });
      this.dirtyIndexes.add(file.harness);
    }
    return true;
  }

  async flush(): Promise<void> {
    for (const harness of [...this.dirtyIndexes]) {
      const index = this.indexes.get(harness);
      if (!index) continue;
      await writeFileAtomic(this.indexPath(harness), JSON.stringify(Object.fromEntries(index)));
      this.dirtyIndexes.delete(harness);
    }
  }

  // -- facets --------------------------------------------------------------

  /**
   * Validates and saves one facet, with what the session looked like when it was judged so a later scan can
   * tell whether it has changed since. Throws a `ZodError` or `StoreError` the caller can describe.
   */
  async saveFacet(input: unknown, judged?: FacetJudgement): Promise<SessionFacet> {
    const facet = SessionFacetSchema.parse(input) as SessionFacet;
    const stamp = judged ? JudgementSchema.safeParse({ ...judged, at: judged.at ?? new Date().toISOString() }) : null;
    const record = stamp?.success ? { ...facet, [JUDGED_KEY]: stamp.data } : facet;
    await writeFileAtomic(this.facetPath(facet.harness, facet.sessionId), `${JSON.stringify(record, null, 2)}\n`);
    return facet;
  }

  async readFacet(harness: Harness, id: string): Promise<SessionFacet | null> {
    return (await this.readFacetRecord(harness, id))?.facet ?? null;
  }

  /** The facet, its judgement snapshot (null when it has none or a broken one), and when the file was written. */
  async readFacetRecord(harness: Harness, id: string): Promise<FacetRecord | null> {
    if (!isSafeId(id)) return null;
    const path = this.facetPath(harness, id);
    const raw = await readJsonFile(path);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    // The snapshot is ours, not part of the facet contract; split it off before the strict facet check.
    const { [JUDGED_KEY]: stamp, ...rest } = raw as Record<string, unknown>;
    const parsed = SessionFacetSchema.safeParse(rest);
    if (!parsed.success) return null;
    const judged = JudgementSchema.safeParse(stamp);
    const savedAtMs = await stat(path).then((info) => info.mtimeMs, () => Date.now());
    return { facet: parsed.data as SessionFacet, judged: judged.success ? judged.data : null, savedAtMs };
  }

  /** Ids with a saved file per harness. Cheap: lists names, does not read or validate them. */
  async facetIds(): Promise<Map<Harness, Set<string>>> {
    const out = new Map<Harness, Set<string>>();
    const root = join(this.home, "facets");
    let harnessDirs: string[];
    try {
      harnessDirs = await readdir(root);
    } catch {
      return out;
    }
    let total = 0;
    for (const dir of harnessDirs) {
      if (!isHarness(dir)) continue;
      const ids = new Set<string>();
      let names: string[] = [];
      try {
        names = await readdir(join(root, dir));
      } catch {
        continue;
      }
      for (const name of names) {
        if (total >= MAX_FACETS) break;
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        if (!isSafeId(id)) continue;
        ids.add(id);
        total += 1;
      }
      out.set(dir, ids);
    }
    return out;
  }

  /** Every valid saved facet, optionally limited to the given `harness:id` keys. Invalid files are skipped. */
  async listFacets(only?: Set<string>): Promise<SessionFacet[]> {
    return (await this.listFacetRecords(only)).map((record) => record.facet);
  }

  /** Every valid saved facet with its judgement snapshot, optionally limited to the given `harness:id` keys. */
  async listFacetRecords(only?: Set<string>): Promise<FacetRecord[]> {
    const records: FacetRecord[] = [];
    for (const [harness, ids] of await this.facetIds()) {
      for (const id of ids) {
        if (only && !only.has(sessionKey(harness, id))) continue;
        const record = await this.readFacetRecord(harness, id);
        if (record && record.facet.sessionId === id && record.facet.harness === harness) records.push(record);
      }
    }
    return records;
  }

  // -- narrative -----------------------------------------------------------

  async saveNarrative(input: unknown): Promise<Narrative> {
    const narrative = NarrativeInputSchema.parse(input) as Narrative;
    await writeFileAtomic(join(this.home, "narrative.json"), `${JSON.stringify(narrative, null, 2)}\n`);
    return narrative;
  }

  async readNarrative(): Promise<Narrative | null> {
    const parsed = NarrativeSchema.safeParse(await readJsonFile(join(this.home, "narrative.json")));
    return parsed.success ? (parsed.data as Narrative) : null;
  }

  // -- reports -------------------------------------------------------------

  /** Writes `report.html`, a timestamped copy, and `report.json`; prunes old copies. */
  async saveReport(html: string, report: Report, now: Date = new Date()): Promise<SavedReport> {
    const dir = this.reportsDir;
    await ensureDir(dir);
    const htmlPath = join(dir, "report.html");
    const copyPath = join(dir, `report-${timestampForFile(now)}.html`);
    const jsonPath = join(dir, "report.json");
    await writeFileAtomic(copyPath, html);
    await writeFileAtomic(htmlPath, html);
    await writeFileAtomic(jsonPath, `${JSON.stringify(report)}\n`);
    await this.pruneReportCopies();
    return { htmlPath, copyPath, jsonPath };
  }

  private async pruneReportCopies(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.reportsDir);
    } catch {
      return;
    }
    // ISO timestamps sort lexically, so the oldest copies come first.
    const copies = names.filter((name) => /^report-\d{4}-.*\.html$/.test(name)).sort();
    for (const name of copies.slice(0, Math.max(0, copies.length - KEEP_REPORT_COPIES))) {
      await rm(join(this.reportsDir, name), { force: true }).catch(() => undefined);
    }
  }
}

export function sessionKey(harness: Harness, id: string): string {
  return `${harness}:${id}`;
}
