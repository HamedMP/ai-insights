/**
 * Read-only SQLite through `node:sqlite`, which ships with Node 22.5 and later. Hindsight supports Node 20,
 * so the module is loaded lazily and its absence is reported, never thrown.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface Statement {
  all(...params: SqlValue[]): SqlRow[];
  get(...params: SqlValue[]): SqlRow | undefined;
  iterate?(...params: SqlValue[]): IterableIterator<SqlRow>;
}

export interface Database {
  prepare(sql: string): Statement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: Record<string, unknown>) => Database;
}

export const SQLITE_UNSUPPORTED = `needs Node 22.5 or later (this is Node ${process.versions.node}) to read SQLite history`;

let loaded: Promise<SqliteModule | null> | null = null;

/** Test hook: pretend the running Node has no `node:sqlite`. */
export const sqliteSupport = { disabled: false };

/** Node 22 warns that `node:sqlite` is experimental; that warning would land in the person's terminal or MCP log. */
async function importQuietly(): Promise<SqliteModule | null> {
  const original = process.emitWarning;
  process.emitWarning = function (warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === "string" ? warning : warning?.message ?? "";
    if (/SQLite/i.test(text)) return;
    return (original as (...args: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    const specifier = "node:sqlite";
    const module = (await import(specifier)) as Partial<SqliteModule>;
    return typeof module.DatabaseSync === "function" ? (module as SqliteModule) : null;
  } catch {
    return null;
  } finally {
    process.emitWarning = original;
  }
}

export async function sqliteAvailable(): Promise<boolean> {
  if (sqliteSupport.disabled) return false;
  loaded ??= importQuietly();
  return (await loaded) !== null;
}

/**
 * Open `path` read-only, or return null. A database another process is writing in WAL mode stays readable;
 * a busy writer is waited on briefly rather than failing the scan.
 */
export async function openReadOnly(path: string): Promise<Database | null> {
  if (!(await sqliteAvailable())) return null;
  const module = await loaded!;
  if (!module) return null;
  try {
    const db = new module.DatabaseSync(path, { readOnly: true });
    try {
      db.prepare("PRAGMA busy_timeout = 2000").get();
      db.prepare("PRAGMA query_only = 1").get();
    } catch {
      // Older builds may refuse a pragma; reading still works.
    }
    return db;
  } catch {
    return null;
  }
}

export function closeQuietly(db: Database | null): void {
  try {
    db?.close();
  } catch {
    // Closing a read-only handle cannot lose data.
  }
}

/** Rows one at a time when the build supports it, so a large table is never held whole. */
export function* rows(statement: Statement, ...params: SqlValue[]): Generator<SqlRow> {
  if (typeof statement.iterate === "function") {
    yield* statement.iterate(...params);
    return;
  }
  yield* statement.all(...params);
}

export function tableNames(db: Database): Set<string> {
  try {
    return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)));
  } catch {
    return new Set();
  }
}

export function columnNames(db: Database, table: string): Set<string> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return new Set();
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
  } catch {
    return new Set();
  }
}

export const asString = (value: SqlValue | undefined): string | null => (typeof value === "string" ? value : null);
export const asNumber = (value: SqlValue | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : typeof value === "bigint" ? Number(value) : null;
