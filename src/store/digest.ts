import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Node built-ins only: the session-start reminder (src/nudge/, compiled into the plugin hook) reads this file too.

/**
 * `digest.json` in the store: the last counts a scheduled run (`ai-insights schedule run`) saw, so the notification
 * and the session-start reminder can say the same thing without re-reading history. Counts and a finding id only:
 * no project names, prompts, commands or paths, because both places show it outside the report (a lock screen,
 * the top of an agent session).
 */
export const DIGEST_FILE = "digest.json";
const MAX_DIGEST_BYTES = 4096;

export interface Digest {
  v: 1;
  /** When the counts were taken (ISO, UTC). */
  generatedAt: string;
  /** The rolling window the counts cover: 1, 7 or 30 days ending at generatedAt. */
  days: number;
  sessions: number;
  activeMinutes: number;
  prompts: number;
  /** Estimate at API list prices; null when not measured or not priced. */
  costUsd: number | null;
  /** A deterministic finding kind (`context_resets`, ...), for a fixed-wording tip; null when none. */
  tipId: string | null;
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 1e9) : null);

/** The digest, validated, or null when it is missing, damaged or not ours. Never throws. */
export async function readDigest(home: string): Promise<Digest | null> {
  let text: string;
  try {
    text = await readFile(join(home, DIGEST_FILE), "utf8");
  } catch {
    return null;
  }
  if (text.length > MAX_DIGEST_BYTES) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.v !== 1 || typeof raw.generatedAt !== "string" || Number.isNaN(Date.parse(raw.generatedAt))) return null;
  const days = count(raw.days), sessions = count(raw.sessions), activeMinutes = count(raw.activeMinutes), prompts = count(raw.prompts);
  if (days === null || sessions === null || activeMinutes === null || prompts === null) return null;
  const cost = typeof raw.costUsd === "number" && Number.isFinite(raw.costUsd) && raw.costUsd >= 0 ? Math.round(raw.costUsd * 100) / 100 : null;
  const tipId = typeof raw.tipId === "string" && /^[a-z][a-z0-9_]{0,40}$/.test(raw.tipId) ? raw.tipId : null;
  return { v: 1, generatedAt: new Date(raw.generatedAt).toISOString(), days, sessions, activeMinutes, prompts, costUsd: cost, tipId };
}

/** Writes the digest atomically (temp file and rename), so a reader never sees half of it. */
export async function writeDigest(home: string, digest: Digest): Promise<void> {
  const path = join(home, DIGEST_FILE);
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(temp, `${JSON.stringify(digest)}\n`, { mode: 0o600 });
  await rename(temp, path);
}
