/**
 * One readable line per tool call for excerpts. Output is never included, except the first line of a
 * failure, because failures explain friction and successful output is noise (and often private).
 */

const MAX_LINE = 240;

export function oneLine(text: string, max = MAX_LINE): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function firstLine(text: unknown, max = 160): string {
  if (typeof text !== "string") return "";
  const line = text.split("\n").find((part) => part.trim().length > 0) ?? "";
  return oneLine(line, max);
}

/** `(repo: acme/widgets, pr: 12)`: scalar arguments only, so nested payloads never flood the excerpt. */
export function argsSummary(args: unknown, limit = 3): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (parts.length >= limit) break;
    if (typeof value === "string" && value.length > 0 && value.length <= 80 && !value.includes("\n")) parts.push(`${key}: ${value}`);
    else if (typeof value === "number" || typeof value === "boolean") parts.push(`${key}: ${value}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export function failure(reason: string): string {
  return reason ? ` → ${reason}` : " → failed";
}

export function shellLine(script: string, exitCode: unknown, output: unknown, failed: boolean): string {
  const base = `$ ${oneLine(script)}`;
  if (!failed) return base;
  const head = firstLine(output);
  const code = typeof exitCode === "number" ? `exit ${exitCode}` : "failed";
  return `${base}${failure(head ? `${code}: ${head}` : code)}`;
}

export interface ParsedCommand {
  type?: unknown;
  path?: unknown;
  query?: unknown;
  name?: unknown;
}

/** Codex already parsed reads and searches; say them the way a person would. */
export function parsedLine(parsed: unknown): string | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const reads: string[] = [];
  const searches: string[] = [];
  const lists: string[] = [];
  for (const entry of parsed as ParsedCommand[]) {
    if (!entry || typeof entry !== "object") return null;
    const path = typeof entry.path === "string" ? entry.path : typeof entry.name === "string" ? entry.name : "";
    if (entry.type === "read" && path) reads.push(path);
    else if (entry.type === "search") searches.push([typeof entry.query === "string" ? `"${entry.query}"` : "", path ? `in ${path}` : ""].filter(Boolean).join(" "));
    else if (entry.type === "list_files") lists.push(path || ".");
    else return null;
  }
  const parts: string[] = [];
  if (reads.length) parts.push(`read ${reads.slice(0, 4).join(", ")}${reads.length > 4 ? ", …" : ""}`);
  if (searches.length) parts.push(`search ${searches.slice(0, 3).join(", ")}`);
  if (lists.length) parts.push(`list ${lists.slice(0, 3).join(", ")}`);
  return oneLine(parts.join("; "));
}

export function editLine(files: Array<{ path: string; added: number; removed: number }>, failed: boolean): string {
  const counts = (added: number, removed: number) => {
    const parts = [added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean);
    return parts.length ? ` (${parts.join(" ")})` : "";
  };
  const shown = files.slice(0, 3).map((file) => `${file.path}${counts(file.added, file.removed)}`);
  const more = files.length > 3 ? `, … ${files.length - 3} more` : "";
  const head = files.length === 1 ? `edit ${shown[0]}` : `edit ${files.length} files: ${shown.join(", ")}${more}`;
  return oneLine(head) + (failed ? failure("failed") : "");
}

export function lastSegment(path: unknown): string {
  if (typeof path !== "string" || !path) return "";
  return path.slice(path.lastIndexOf("/") + 1) || path;
}
