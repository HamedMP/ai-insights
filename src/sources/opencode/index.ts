import type { DiscoverOptions, ExcerptOptions, Session, SessionFile, Source, TranscriptTurn } from "../../schema/types.js";
import { excerptLimits, finishExcerpt } from "../common/excerpt.js";
import { sqliteAvailable } from "../common/sqlite.js";
import { buildSession } from "./parse.js";
import { DbReader, defaultRoots, LegacyReader, locate, storageForSessionFile, type Listed, type Reader } from "./store.js";

const SEP = "#";

/** `<db>#<session id>` for database rows; legacy sessions keep their own file path. */
function splitPath(path: string): { db: string; id: string } | null {
  const cut = path.lastIndexOf(SEP);
  if (cut <= 0) return null;
  const db = path.slice(0, cut);
  return db.endsWith(".db") ? { db, id: path.slice(cut + 1) } : null;
}

const LEGACY_TTL_MS = 5_000;
const legacyCache = new Map<string, { at: number; reader: Promise<LegacyReader> }>();

function legacyReader(storage: string, fresh = false): Promise<LegacyReader> {
  const cached = legacyCache.get(storage);
  if (!fresh && cached && Date.now() - cached.at < LEGACY_TTL_MS) return cached.reader;
  const reader = LegacyReader.scan(storage);
  legacyCache.set(storage, { at: Date.now(), reader });
  if (legacyCache.size > 8) legacyCache.delete(legacyCache.keys().next().value!);
  return reader;
}

/** Subagent sessions are read with the session that spawned them, so only top-level sessions are listed. */
function topLevel(listed: Listed[]): Listed[] {
  const byId = new Map(listed.map((row) => [row.id, { ...row }]));
  const topOf = (row: Listed): Listed => {
    let current = row;
    for (let hop = 0; hop < 16 && current.parentId; hop += 1) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const tops = new Map<string, Listed>();
  for (const row of byId.values()) {
    const top = topOf(row);
    const entry = tops.get(top.id) ?? { ...top };
    if (top.id !== row.id) {
      entry.changedMs = Math.max(entry.changedMs, row.changedMs);
      entry.sizeBytes += row.sizeBytes;
    }
    tops.set(top.id, entry);
  }
  return [...tops.values()];
}

async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const located = await locate(options.roots ?? defaultRoots());
  const since = options.since?.getTime();
  const files: SessionFile[] = [];
  const inDatabase = new Set<string>();
  for (const path of located.databases) {
    const reader = await DbReader.open(path);
    if (!reader) continue;
    try {
      for (const row of topLevel(reader.list())) {
        inDatabase.add(row.id);
        files.push({ harness: "opencode", path: `${path}${SEP}${row.id}`, mtimeMs: row.changedMs, sizeBytes: row.sizeBytes });
      }
      // Rows folded into a parent are still in this database; the legacy copy of them must not reappear.
      for (const row of reader.list()) inDatabase.add(row.id);
    } catch {
      // A database mid-migration or locked can be read on the next scan.
    } finally {
      reader.close();
    }
  }
  for (const storage of located.storages) {
    const reader = await legacyReader(storage, true);
    // OpenCode migrates these files into the database on upgrade; the database copy is the current one.
    const listed = reader.list().filter((row) => !inDatabase.has(row.id));
    for (const row of topLevel(listed)) {
      const path = reader.pathFor(row.id);
      if (path) files.push({ harness: "opencode", path, mtimeMs: row.changedMs, sizeBytes: row.sizeBytes });
    }
  }
  const kept = since === undefined ? files : files.filter((file) => file.mtimeMs >= since);
  kept.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return options.maxFiles !== undefined ? kept.slice(0, Math.max(0, options.maxFiles)) : kept;
}

async function withReader<T>(file: SessionFile, use: (reader: Reader, id: string, load?: (id: string) => Promise<void>) => Promise<T>): Promise<T | null> {
  const split = splitPath(file.path);
  if (split) {
    const reader = await DbReader.open(split.db);
    if (!reader) return null;
    try {
      return await use(reader, split.id);
    } finally {
      reader.close();
    }
  }
  if (!file.path.endsWith(".json")) return null;
  const reader = await legacyReader(storageForSessionFile(file.path));
  const id = reader.list().find((row) => reader.pathFor(row.id) === file.path)?.id;
  if (!id) return null;
  return use(reader, id, (sessionId) => reader.load(sessionId));
}

async function parse(file: SessionFile): Promise<Session | null> {
  try {
    return await withReader(file, async (reader, id, load) => (await buildSession(reader, file, id, load ? { load } : {})).session);
  } catch {
    return null;
  }
}

async function excerpt(file: SessionFile, options: ExcerptOptions = {}): Promise<TranscriptTurn[]> {
  try {
    const { maxChars } = excerptLimits(options);
    const turns = await withReader(file, async (reader, id, load) => {
      const built = await buildSession(reader, file, id, load ? { load, turnChars: maxChars } : { turnChars: maxChars });
      return built.builder.turns;
    });
    return turns ? finishExcerpt(turns, options) : [];
  } catch {
    return [];
  }
}

async function diagnose(): Promise<string | null> {
  try {
    const located = await locate(defaultRoots());
    if (located.databases.length === 0) return null;
    if (!(await sqliteAvailable())) {
      return `OpenCode history is in a SQLite database, which needs Node 22.5 or later to read (this is Node ${process.versions.node})`;
    }
    for (const path of located.databases) {
      const reader = await DbReader.open(path);
      if (!reader) return "an OpenCode database could not be opened read-only";
      reader.close();
    }
    return null;
  } catch {
    return null;
  }
}

export const opencodeSource: Source = {
  // Bump whenever a parser change would give a different Session from the same history.
  parserVersion: "1",
  harness: "opencode",
  label: "OpenCode",
  defaultRoots: () => defaultRoots(),
  discover,
  parse,
  excerpt,
  diagnose,
};
