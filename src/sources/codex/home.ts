import { homedir } from "node:os";

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let cached: { home: string; pattern: RegExp } | null = null;

function pattern(): RegExp {
  const home = homedir().replace(/\/+$/, "");
  if (cached?.home !== home) {
    // This machine's home, plus any /home/<name> or /Users/<name> (rollouts synced from another machine).
    const own = home.length > 1 ? `${escape(home)}|` : "";
    cached = { home, pattern: new RegExp(`(?<![A-Za-z_.-])(?:${own}/home/[^/\\s"'\`]+|/Users/[^/\\s"'\`]+)(?=/|$|[\\s"'\`),:;\\]])`, "g") };
  }
  cached.pattern.lastIndex = 0;
  return cached.pattern;
}

/** Usernames in paths are personal; every string the source returns shows the home directory as `~`. */
export function shortenHome(text: string): string {
  if (!text || (!/\/(home|Users)\//.test(text) && !text.includes(homedir()))) return text;
  return text.replace(pattern(), "~");
}

/** The inverse, for paths a command wrote as `~/…`. */
export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}
