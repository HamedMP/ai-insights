import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../store/fs.js";

// Remembers that the person said no to the install offer, so it is not asked on every run. It is asked again
// 30 days after a no, or once a newer minor version is running (which may bring something new to install).

export const OFFER_FILE = "install-offer.json";
export const ASK_AGAIN_DAYS = 30;
const DAY_MS = 86_400_000;

export interface OfferState {
  declinedAt: string;
  version: string;
}

export async function readOfferState(home: string): Promise<OfferState | null> {
  try {
    const value = JSON.parse(await readFile(join(home, OFFER_FILE), "utf8")) as Partial<OfferState>;
    if (typeof value.declinedAt !== "string" || typeof value.version !== "string") return null;
    return { declinedAt: value.declinedAt.slice(0, 40), version: value.version.slice(0, 40) };
  } catch {
    return null;
  }
}

export async function recordDecline(home: string, now: Date, version: string): Promise<void> {
  const state: OfferState = { declinedAt: now.toISOString(), version };
  await writeFileAtomic(join(home, OFFER_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

function minor(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

export function declineStillHolds(state: OfferState | null, now: Date, version: string): boolean {
  if (!state) return false;
  const at = Date.parse(state.declinedAt);
  if (!Number.isFinite(at)) return false;
  if (minor(state.version) !== minor(version)) return false;
  return now.getTime() - at < ASK_AGAIN_DAYS * DAY_MS;
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "" && !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export interface OfferContext {
  env: NodeJS.ProcessEnv;
  stdoutTTY: boolean;
  stdinTTY: boolean;
  /** --no-install-prompt was given. */
  disabled: boolean;
}

/** Only a person at an interactive terminal is asked; never in CI, never when piped, never when turned off. */
export function mayOffer(context: OfferContext): boolean {
  if (context.disabled) return false;
  if (!context.stdoutTTY || !context.stdinTTY) return false;
  if (truthy(context.env.CI)) return false;
  if (truthy(context.env.AI_INSIGHTS_NO_INSTALL_PROMPT)) return false;
  return true;
}
