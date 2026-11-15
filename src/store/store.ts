import { readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { HARNESSES, type Harness, type Narrative, type Report, type Session, type SessionFacet, type SessionFile } from "../schema/types.js";
import { ensureDir, readJsonFile, writeFileAtomic } from "./fs.js";
import { NarrativeSchema, SessionFacetSchema, SessionSchema, isSafeId } from "./schemas.js";

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

  private async index(harness: Harness): Promise<Map<string, IndexEntry>> {
    const loaded = this.indexes.get(harness);
    if (loaded) return loaded;
    const map = new Map<string, IndexEntry>();
    const raw = await readJsonFile(this.indexPath(harness));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
        if (map.size >= MAX_INDEX_ENTRIES) break;
        if (!value || typeof value !== "object") continue;
        const { id, mtimeMs } = value as Record<string, unknown>;
        if (typeof mtimeMs !== "number" || !(id === null || isSafeId(id))) continue;
        map.set(path, { id, mtimeMs });
      }
    }
    this.indexes.set(harness, map);
    return map;
  }

  /**
   * The cached parse of `file`, if it is still current.
   * `undefined`: no usable cache, parse it. `null`: known to hold no session.
   */
  async cachedSession(file: SessionFile): Promise<Session | null | undefined> {
    const entry = (await this.index(file.harness)).get(file.path);
    if (!entry || entry.mtimeMs !== file.mtimeMs) return undefined;
    if (entry.id === null) return null;
    const parsed = SessionSchema.safeParse(await readJsonFile(this.sessionPath(file.harness, entry.id)));
    if (!parsed.success) return undefined;
    const session = parsed.data as Session;
    if (session.sourcePath !== file.path || session.sourceMtimeMs !== file.mtimeMs || session.harness !== file.harness) return undefined;
    return session;
  }

  /** Caches a parse result. Sessions whose id is not file-name safe are returned but not cached. */
  async cacheSession(file: SessionFile, session: Session | null): Promise<boolean> {
    const index = await this.index(file.harness);
    if (session === null) {
      index.set(file.path, { id: null, mtimeMs: file.mtimeMs });
      this.dirtyIndexes.add(file.harness);
      return true;
    }
    if (!isSafeId(session.id) || session.harness !== file.harness) return false;
    await writeFileAtomic(this.sessionPath(session.harness, session.id), JSON.stringify(session));
    if (index.size < MAX_INDEX_ENTRIES || index.has(file.path)) {
      index.set(file.path, { id: session.id, mtimeMs: file.mtimeMs });
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

  /** Validates and saves one facet. Throws a `ZodError` or `StoreError` the caller can describe. */
  async saveFacet(input: unknown): Promise<SessionFacet> {
    const facet = SessionFacetSchema.parse(input) as SessionFacet;
    await writeFileAtomic(this.facetPath(facet.harness, facet.sessionId), `${JSON.stringify(facet, null, 2)}\n`);
    return facet;
  }

  async readFacet(harness: Harness, id: string): Promise<SessionFacet | null> {
    if (!isSafeId(id)) return null;
    const parsed = SessionFacetSchema.safeParse(await readJsonFile(this.facetPath(harness, id)));
    return parsed.success ? (parsed.data as SessionFacet) : null;
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
    const facets: SessionFacet[] = [];
    for (const [harness, ids] of await this.facetIds()) {
      for (const id of ids) {
        if (only && !only.has(sessionKey(harness, id))) continue;
        const facet = await this.readFacet(harness, id);
        if (facet && facet.sessionId === id && facet.harness === harness) facets.push(facet);
      }
    }
    return facets;
  }

  // -- narrative -----------------------------------------------------------

  async saveNarrative(input: unknown): Promise<Narrative> {
    const narrative = NarrativeSchema.parse(input) as Narrative;
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
