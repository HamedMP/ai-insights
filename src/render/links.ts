import { clip } from "./format.js";

const MAX_URL = 2000;

/**
 * A suggestion's URL as a parsed http(s) URL, or null. Anything else (javascript:,
 * data:, protocol-relative, credentials, garbage) is never rendered at all.
 */
export function safeLink(url: unknown): URL | null {
  if (typeof url !== "string" || url.length > MAX_URL) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  return parsed;
}

export function shortUrl(link: URL): string {
  return clip(link.href.replace(/^https?:\/\//i, "").replace(/\/$/, ""), 120);
}
