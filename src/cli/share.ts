import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";

/**
 * `ai-insights share`: the stats share link printed in the terminal, for a person on a machine with no browser.
 * The link is built by the report's own client script (src/render/client/sharelink.js), run here in a sandboxed
 * context, from the data block of the report that was just written: the same code and the same input as the
 * report's "Publish to the leaderboard" button, so the two links are the same bytes. Nothing here contacts the
 * network: the command only prints text (and, with --copy, asks the terminal to put it on the clipboard).
 */

export const SITE_URL = "https://ai-insights.app/";
/** The report data block's opening tag, exactly as src/render/index.ts writes it. */
const DATA_OPEN = '<script id="report-data" type="application/json">';

export interface ShareChoices {
  /** Display name for the card; empty for none ("Someone"). */
  name: string;
  /** Name for this computer; empty for none. */
  deviceName: string;
  /** Include which days were active (the share box's checkbox, on by default). */
  days: boolean;
}

export interface SharePayload {
  v: number;
  device?: { id: string; name: string };
  days?: { from: string; bits: string } | null;
  [key: string]: unknown;
}

interface ShareLinkApi {
  payload(rc: unknown, name: string, ratios: unknown, device: { id: string; name: string; days: boolean } | null): SharePayload | null;
  url(payload: SharePayload, base: string): string;
  describe(payload: SharePayload, names: Record<string, string>): string[];
  AGENTS: Record<string, string>;
}

let api: ShareLinkApi | null = null;

/** sharelink.js as the page loads it: a classic script in its own global scope, with only what it uses. */
function shareLink(): ShareLinkApi {
  if (api) return api;
  const code = readFileSync(new URL("../render/client/sharelink.js", import.meta.url), "utf8");
  const context = createContext({ TextEncoder, btoa, atob, console });
  new Script(code, { filename: "sharelink.js" }).runInContext(context);
  api = new Script("ShareLink").runInContext(context) as ShareLinkApi;
  return api;
}

/** The report's data block, read the way the page reads it. Null when the file is not a report with data. */
export function reportData(html: string): Record<string, unknown> | null {
  const start = html.indexOf(DATA_OPEN);
  if (start < 0) return null;
  const from = start + DATA_OPEN.length;
  // `<` is escaped inside the block, so the first closing tag after it ends it.
  const end = html.indexOf("</script>", from);
  if (end < 0) return null;
  try {
    const data = JSON.parse(html.slice(from, end)) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export interface ShareLink {
  url: string;
  payload: SharePayload;
  /** What the link carries, line by line: the share box's "See exactly what's in the link" list. */
  lines: string[];
}

/** The link the report's share box shows for these choices, or null when the report has no recap to share. */
export function buildShareLink(view: Record<string, unknown>, choices: ShareChoices): ShareLink | null {
  const SL = shareLink();
  const deviceId = typeof view.deviceId === "string" ? view.deviceId : null;
  const device = deviceId ? { id: deviceId, name: choices.deviceName, days: choices.days } : null;
  const payload = SL.payload(view.recap ?? null, choices.name, view.ratios ?? null, device);
  if (!payload) return null;
  return { url: SL.url(payload, SITE_URL), payload, lines: SL.describe(payload, SL.AGENTS) };
}

/** The link only ever holds printable ASCII; anything else must never reach a terminal escape sequence. */
const PRINTABLE = /^[\x21-\x7e]+$/;

/** OSC 52: asks the terminal to put `text` on the clipboard. Many terminals allow it; some, and tmux by default, ignore it. */
export function osc52(text: string): string {
  if (!PRINTABLE.test(text)) throw new Error("refusing to send a non-printable value to the terminal");
  return `\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`;
}

export interface ShareScreen {
  link: ShareLink;
  /** Where the link was saved, or null when it could not be. */
  savedTo: string | null;
  /** What --copy did: not asked, sent to the terminal, or not possible because stdout is not a terminal. */
  copy: "off" | "sent" | "no-terminal";
}

/** The disclosure, then the link on a line of its own so it can be selected and copied whole. */
export function shareScreen(screen: ShareScreen): string {
  const { link } = screen;
  const lines = [
    "Your stats share link. It holds exactly these lines:",
    ...link.lines.map((line) => `  ${line}`),
    "",
    "The numbers travel in the link's #fragment, which browsers do not send to any server. Nothing is uploaded:",
    "open the link on your laptop or phone to see your card, then sign in there and press Publish to join the leaderboard.",
    "",
    link.url,
    "",
  ];
  if (screen.savedTo) lines.push(`Also saved to ${screen.savedTo}, in case your terminal wraps the link.`);
  if (screen.copy === "sent") lines.push("Asked your terminal to copy it (OSC 52). If nothing was copied, your terminal or tmux does not allow that: use the file.");
  if (screen.copy === "no-terminal") lines.push("--copy needs a terminal; the link was not copied.");
  return `${lines.join("\n")}\n`;
}
