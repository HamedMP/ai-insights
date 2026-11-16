import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

/** Caps what we will read back from our own store, so a corrupted or planted file cannot exhaust memory. */
export const MAX_STORE_FILE_BYTES = 64 * 1024 * 1024;

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIR_MODE });
  // mkdir's mode is masked by umask and ignored for directories that already exist.
  await chmod(path, DIR_MODE).catch(() => undefined);
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

/** Write to a sibling temp file then rename, so a crash never leaves a half-written file behind. */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await ensureDir(dirname(path));
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temp, "wx", FILE_MODE);
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Parsed JSON, or undefined when the file is missing, oversized or not JSON. */
export async function readJsonFile(path: string): Promise<unknown> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_STORE_FILE_BYTES) return undefined;
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
