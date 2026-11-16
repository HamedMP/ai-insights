import { lstat, opendir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { obj, type Obj } from "../common/builder.js";
import { asNumber, asString, closeQuietly, columnNames, openReadOnly, rows, tableNames, type Database } from "../common/sqlite.js";

/**
 * Where OpenCode keeps its history. Since 1.2 it is one SQLite database, `opencode.db` in the data directory
 * (`$XDG_DATA_HOME/opencode`, default `~/.local/share/opencode`; `OPENCODE_DB` overrides it), with tables
 * `session`, `message` and `part` whose `data` columns hold the JSON OpenCode used to write as files, plus a
 * newer `session_message` table. Before that each record was a file under `storage/`. CodexBar's OpenCode
 * notes (docs/opencode.md, MIT) pointed at the database and its `$.cost` / `$.tokens` fields.
 */

export const MAX_ROW_CHARS = 4 * 1024 * 1024;
export const MAX_MESSAGES = 50_000;
export const MAX_PARTS_PER_MESSAGE = 2_000;
export const MAX_SESSIONS = 50_000;
export const MAX_CHILDREN = 500;
const MAX_LEGACY_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DIR_ENTRIES = 100_000;

export function dataDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const xdg = env.XDG_DATA_HOME?.trim();
  // OpenCode ignores a relative XDG_DATA_HOME, as the XDG spec says to.
  return join(xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "share"), "opencode");
}

/** The roots to look in: the data directory, or the database `OPENCODE_DB` names. */
export function defaultRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const dir = dataDir(env, home);
  const db = env.OPENCODE_DB?.trim();
  if (db) return [isAbsolute(db) ? db : join(dir, db), join(dir, "storage")];
  return [dir];
}

export interface Located {
  databases: string[];
  /** Legacy `storage/` folders holding `session/`, `message/` and `part/`. */
  storages: string[];
}

const DB_NAME = /^opencode(?:[-.][\w.-]+)?\.db$/;

/** Each root may be the data directory, a `storage/` folder, or a database file. Release channels get their own `opencode-<channel>.db`. */
export async function locate(roots: string[]): Promise<Located> {
  const databases = new Set<string>();
  const storages = new Set<string>();
  for (const raw of roots) {
    const root = resolve(raw);
    const info = await stat(root).catch(() => null);
    if (!info) continue;
    if (info.isFile()) {
      databases.add(root);
      continue;
    }
    if (!info.isDirectory()) continue;
    if (basename(root) === "storage") {
      storages.add(root);
      continue;
    }
    for (const name of await readdir(root).catch(() => [] as string[])) {
      if (DB_NAME.test(name)) databases.add(join(root, name));
    }
    const storage = join(root, "storage");
    if ((await stat(join(storage, "session")).catch(() => null))?.isDirectory()) storages.add(storage);
  }
  return { databases: [...databases], storages: [...storages] };
}

export interface SessionRow {
  id: string;
  parentId: string | null;
  directory: string | null;
  createdMs: number | null;
  updatedMs: number | null;
}

export interface MessageRecord {
  id: string;
  createdMs: number | null;
  /** Null when the row was too large or not JSON; the caller counts it. */
  data: Obj | null;
}

export interface PartRecord {
  id: string;
  data: Obj | null;
}

/** A newer-format record: `type` is "assistant", "compaction", "user", … */
export interface V2Record {
  id: string;
  type: string;
  createdMs: number | null;
  data: Obj | null;
}

export interface Listed extends SessionRow {
  /** Newest change across the session's own records. */
  changedMs: number;
  sizeBytes: number;
}

/** One read-only view of a history, over either storage form. */
export interface Reader {
  list(): Listed[];
  session(id: string): SessionRow | null;
  children(id: string): string[];
  messages(sessionId: string): Iterable<MessageRecord>;
  parts(messageId: string, sessionId: string): PartRecord[];
  v2(sessionId: string): Iterable<V2Record>;
  close(): void;
}

function parseJson(text: string | null): Obj | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

/** Only the history tables are ever queried: the same file holds account and credential tables. */
export class DbReader implements Reader {
  private readonly tables: Set<string>;
  private readonly sessionColumns: Set<string>;

  private constructor(private readonly db: Database) {
    this.tables = tableNames(db);
    this.sessionColumns = columnNames(db, "session");
  }

  static async open(path: string): Promise<DbReader | null> {
    const db = await openReadOnly(path);
    if (!db) return null;
    const reader = new DbReader(db);
    if (!reader.tables.has("session")) {
      reader.close();
      return null;
    }
    return reader;
  }

  private has(table: string): boolean {
    return this.tables.has(table);
  }

  private sessionSelect(): string {
    const col = (name: string) => (this.sessionColumns.has(name) ? name : "NULL");
    return `id, ${col("parent_id")} AS parent_id, ${col("directory")} AS directory, ${col("time_created")} AS created, ${col("time_updated")} AS updated`;
  }

  private toRow(row: Record<string, unknown>): SessionRow | null {
    const id = typeof row.id === "string" ? row.id : null;
    if (!id) return null;
    return {
      id,
      parentId: asString(row.parent_id as never),
      directory: asString(row.directory as never),
      createdMs: asNumber(row.created as never),
      updatedMs: asNumber(row.updated as never),
    };
  }

  list(): Listed[] {
    const sizes = (table: string) =>
      this.has(table) ? `(SELECT coalesce(sum(length(data)), 0) FROM ${table} t WHERE t.session_id = s.id)` : "0";
    const latest = (table: string) => (this.has(table) ? `(SELECT max(time_updated) FROM ${table} t WHERE t.session_id = s.id)` : "NULL");
    const sql = `SELECT ${this.sessionSelect()}, ${latest("message")} AS m_updated, ${latest("session_message")} AS v_updated,
      ${sizes("message")} + ${sizes("part")} + ${sizes("session_message")} AS bytes FROM session s LIMIT ${MAX_SESSIONS}`;
    const out: Listed[] = [];
    for (const row of rows(this.db.prepare(sql))) {
      const session = this.toRow(row);
      if (!session) continue;
      const changed = Math.max(session.updatedMs ?? 0, asNumber(row.m_updated) ?? 0, asNumber(row.v_updated) ?? 0, session.createdMs ?? 0);
      out.push({ ...session, changedMs: changed, sizeBytes: asNumber(row.bytes) ?? 0 });
    }
    return out;
  }

  session(id: string): SessionRow | null {
    const row = this.db.prepare(`SELECT ${this.sessionSelect()} FROM session WHERE id = ?`).get(id);
    return row ? this.toRow(row) : null;
  }

  children(id: string): string[] {
    if (!this.sessionColumns.has("parent_id")) return [];
    return this.db
      .prepare(`SELECT id FROM session WHERE parent_id = ? ORDER BY time_created LIMIT ${MAX_CHILDREN}`)
      .all(id)
      .map((row) => asString(row.id))
      .filter((value): value is string => value !== null);
  }

  *messages(sessionId: string): Iterable<MessageRecord> {
    if (!this.has("message")) return;
    const statement = this.db.prepare(
      `SELECT id, time_created AS created, CASE WHEN length(data) > ${MAX_ROW_CHARS} THEN NULL ELSE data END AS data
       FROM message WHERE session_id = ? ORDER BY time_created, id LIMIT ${MAX_MESSAGES}`,
    );
    for (const row of rows(statement, sessionId)) {
      const id = asString(row.id);
      if (id) yield { id, createdMs: asNumber(row.created), data: parseJson(asString(row.data)) };
    }
  }

  parts(messageId: string): PartRecord[] {
    if (!this.has("part")) return [];
    return this.db
      .prepare(
        `SELECT id, CASE WHEN length(data) > ${MAX_ROW_CHARS} THEN NULL ELSE data END AS data
         FROM part WHERE message_id = ? ORDER BY id LIMIT ${MAX_PARTS_PER_MESSAGE}`,
      )
      .all(messageId)
      .map((row) => ({ id: asString(row.id) ?? "", data: parseJson(asString(row.data)) }))
      .filter((part) => part.id);
  }

  *v2(sessionId: string): Iterable<V2Record> {
    if (!this.has("session_message")) return;
    const statement = this.db.prepare(
      `SELECT id, type, time_created AS created, CASE WHEN length(data) > ${MAX_ROW_CHARS} THEN NULL ELSE data END AS data
       FROM session_message WHERE session_id = ? ORDER BY time_created, id LIMIT ${MAX_MESSAGES}`,
    );
    for (const row of rows(statement, sessionId)) {
      const id = asString(row.id);
      if (id) yield { id, type: asString(row.type) ?? "", createdMs: asNumber(row.created), data: parseJson(asString(row.data)) };
    }
  }

  close(): void {
    closeQuietly(this.db);
  }
}

// ---------------------------------------------------------------------------
// Legacy JSON files: storage/session/<project>/<id>.json, storage/message/<session>/<id>.json, storage/part/<message>/<id>.json
// ---------------------------------------------------------------------------

async function readJsonFile(path: string): Promise<Obj | null> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_LEGACY_FILE_BYTES) return null;
    return parseJson(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function jsonFiles(dir: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  try {
    const handle = await opendir(dir);
    for await (const entry of handle) {
      if (out.length >= limit) break;
      if (entry.isFile() && entry.name.endsWith(".json")) out.push(join(dir, entry.name));
    }
  } catch {
    // A missing folder holds nothing.
  }
  return out.sort();
}

const time = (data: Obj | null, key: string) => {
  const value = obj(data?.time)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** Legacy storage is read ahead into memory per session, so it implements the same synchronous `Reader`. */
export class LegacyReader implements Reader {
  private readonly sessionFiles = new Map<string, string>();
  private readonly loaded = new Map<string, { row: SessionRow; messages: MessageRecord[]; parts: Map<string, PartRecord[]> }>();
  private listed: Listed[] = [];

  private constructor(private readonly storage: string) {}

  static async scan(storage: string): Promise<LegacyReader> {
    const reader = new LegacyReader(storage);
    const sessionRoot = join(storage, "session");
    let seen = 0;
    for (const project of await readdir(sessionRoot, { withFileTypes: true }).catch(() => [])) {
      if (!project.isDirectory()) continue;
      for (const file of await jsonFiles(join(sessionRoot, project.name), MAX_DIR_ENTRIES)) {
        if ((seen += 1) > MAX_SESSIONS) break;
        const data = await readJsonFile(file);
        const id = typeof data?.id === "string" ? data.id : basename(file, ".json");
        reader.sessionFiles.set(id, file);
        const fileInfo = await stat(file).catch(() => null);
        const messageDir = await stat(join(storage, "message", id)).catch(() => null);
        reader.listed.push({
          ...LegacyReader.row(id, data),
          changedMs: Math.max(fileInfo?.mtimeMs ?? 0, messageDir?.mtimeMs ?? 0, time(data, "updated") ?? 0),
          sizeBytes: fileInfo?.size ?? 0,
        });
      }
    }
    return reader;
  }

  private static row(id: string, data: Obj | null): SessionRow {
    return {
      id,
      parentId: typeof data?.parentID === "string" ? data.parentID : null,
      directory: typeof data?.directory === "string" ? data.directory : null,
      createdMs: time(data, "created"),
      updatedMs: time(data, "updated"),
    };
  }

  pathFor(id: string): string | null {
    return this.sessionFiles.get(id) ?? null;
  }

  /** Reads one session's message and part files; call before `messages` and `parts`. */
  async load(id: string): Promise<void> {
    if (this.loaded.has(id)) return;
    const file = this.sessionFiles.get(id);
    const data = file ? await readJsonFile(file) : null;
    const messages: MessageRecord[] = [];
    const parts = new Map<string, PartRecord[]>();
    for (const path of await jsonFiles(join(this.storage, "message", id), MAX_MESSAGES)) {
      const message = await readJsonFile(path);
      const messageId = typeof message?.id === "string" ? message.id : basename(path, ".json");
      messages.push({ id: messageId, createdMs: time(message, "created"), data: message });
      const list: PartRecord[] = [];
      for (const partPath of await jsonFiles(join(this.storage, "part", messageId), MAX_PARTS_PER_MESSAGE)) {
        list.push({ id: basename(partPath, ".json"), data: await readJsonFile(partPath) });
      }
      parts.set(messageId, list);
    }
    messages.sort((a, b) => (a.createdMs ?? 0) - (b.createdMs ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.loaded.set(id, { row: LegacyReader.row(id, data), messages, parts });
    if (this.loaded.size > 64) this.loaded.delete(this.loaded.keys().next().value!);
  }

  list(): Listed[] {
    return this.listed;
  }

  session(id: string): SessionRow | null {
    return this.loaded.get(id)?.row ?? this.listed.find((row) => row.id === id) ?? null;
  }

  children(id: string): string[] {
    return this.listed.filter((row) => row.parentId === id).slice(0, MAX_CHILDREN).map((row) => row.id);
  }

  messages(sessionId: string): Iterable<MessageRecord> {
    return this.loaded.get(sessionId)?.messages ?? [];
  }

  parts(messageId: string, sessionId: string): PartRecord[] {
    return this.loaded.get(sessionId)?.parts.get(messageId) ?? [];
  }

  v2(): Iterable<V2Record> {
    return [];
  }

  close(): void {
    this.loaded.clear();
  }
}

/** `storage/session/<project>/<id>.json` back to its storage folder. */
export function storageForSessionFile(path: string): string {
  return dirname(dirname(dirname(path)));
}
