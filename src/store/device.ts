import { randomBytes } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
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

/** This installation's device id, made on first use and kept in the store home (`device.json`). */
export async function deviceId(home: string): Promise<string> {
  const path = join(home, DEVICE_FILE);
  const existing = await readId(path);
  if (existing) return existing;
  await ensureDir(home);
  try {
    // Exclusive create: two first runs at once agree on whichever id landed first.
    const handle = await open(path, "wx", FILE_MODE);
    try {
      await handle.writeFile(`${fresh()}\n`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await readId(path);
    if (raced) return raced;
    // The file exists but is damaged or was not written by us: replace it rather than pass its content on.
    await rm(path, { force: true });
    await writeFileAtomic(path, `${fresh()}\n`);
  }
  const made = await readId(path);
  if (!made) throw new Error("device id could not be saved");
  return made;
}
