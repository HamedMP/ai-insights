import { randomBytes } from "node:crypto";
import { link, open, readFile, rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { join } from "node:path";
import { ensureDir, FILE_MODE, writeFileAtomic } from "./fs.js";

/**
 * A stable random id for this installation, so a person who publishes from several machines gets one entry per
 * machine on the site. It is 16 random bytes and nothing else: never a hostname, username, MAC address or any
 * hardware detail. It is not a secret and grants nothing; it only tells this machine's publishes apart from others.
 */
export const DEVICE_FILE = "device.json";
export const DEVICE_ID = /^[0-9a-f]{32}$/;
const MAX_DEVICE_FILE_BYTES = 1024;

async function readId(path: string): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (text.length > MAX_DEVICE_FILE_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const id = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).id : undefined;
    return typeof id === "string" && DEVICE_ID.test(id) ? id : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

const fresh = () => JSON.stringify({ id: randomBytes(16).toString("hex"), createdAt: new Date().toISOString() });

/** Filesystems without hard links (some network and FAT mounts) say so with one of these. */
const NO_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EXDEV"]);

/**
 * Creates the file with its whole content in one step, or reports EEXIST. The content is written to a private
 * temporary file first and hard-linked into place, so no other run can ever see the file empty or half-written.
 * Where hard links are not available it falls back to an exclusive create, whose short empty moment readers
 * wait out (see deviceId).
 */
async function createWhole(path: string, content: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(temp, "wx", FILE_MODE);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  try {
    await link(temp, path);
    return;
  } catch (error) {
    if (!NO_LINKS.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
  } finally {
    await rm(temp, { force: true });
  }
  const direct = await open(path, "wx", FILE_MODE);
  try {
    await direct.writeFile(content, "utf8");
  } finally {
    await direct.close();
  }
}

/** Reads the id another run is creating right now: an exclusive create is empty until its write lands. */
async function readSettled(path: string): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = await readId(path);
    if (id) return id;
    await sleep(20);
  }
  return null;
}

/** This installation's device id, made on first use and kept in the store home (`device.json`). */
export async function deviceId(home: string): Promise<string> {
  const path = join(home, DEVICE_FILE);
  const existing = await readId(path);
  if (existing) return existing;
  await ensureDir(home);
  try {
    // Two first runs at once agree on whichever id landed first.
    await createWhole(path, `${fresh()}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await readSettled(path);
    if (raced) return raced;
    // The file exists but is damaged or was not written by us: replace it rather than pass its content on.
    await rm(path, { force: true });
    await writeFileAtomic(path, `${fresh()}\n`);
  }
  const made = await readId(path);
  if (!made) throw new Error("device id could not be saved");
  return made;
}
