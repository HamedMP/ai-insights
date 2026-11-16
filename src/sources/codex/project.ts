import { closeSync, constants, existsSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A place the session did work, with how strongly it says "this is the project". */
export interface ProjectEvidence {
  path: string;
  weight: number;
}

export const MAX_EVIDENCE = 5_000;
const MAX_CACHE = 20_000;
const MIN_WEIGHT = 2;
const MIN_SHARE = 0.6;
/** A real `.git` file or `commondir` is one short line; anything bigger is not git's. */
const MAX_GIT_FILE_BYTES = 8 * 1024;

const roots = new Map<string, string | null>();
const mains = new Map<string, string>();

/** Paths a command wrote as `~/…`. */
export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

/** Codex Desktop records command directories as `file://` URLs. */
export function localPath(value: string): string | null {
  if (!value.startsWith("file:")) return value;
  try {
    return fileURLToPath(value);
  } catch {
    return null;
  }
}

/**
 * A rollout synced from another machine names that machine's home (`/Users/<name>/…`). When the same
 * path exists under this machine's home, it is the same checkout.
 */
function onThisMachine(path: string): string {
  if (existsSync(path)) return path;
  const match = /^\/(?:Users|home)\/[^/]+(\/.*)?$/.exec(path);
  if (!match) return path;
  const local = join(homedir(), match[1] ?? "");
  return local !== path && existsSync(local) ? local : path;
}

/**
 * The checkout a directory belongs to (the folder holding `.git`, a directory or a worktree's file), read
 * from the local filesystem; null when there is none. A worktree is its own checkout: Claude Code reports
 * a session started in one by that path, so Codex does too and the two harnesses group alike.
 */
export function repoRoot(dir: string): string | null {
  if (!isAbsolute(dir)) return null;
  dir = onThisMachine(dir);
  const visited: string[] = [];
  let current = resolve(dir);
  let found: string | null = null;
  for (let depth = 0; depth < 64; depth += 1) {
    const known = roots.get(current);
    if (known !== undefined) {
      found = known;
      break;
    }
    visited.push(current);
    const marker = join(current, ".git");
    try {
      const info = statSync(marker);
      found = info.isDirectory() || info.isFile() ? current : null;
      if (found) break;
    } catch {
      // No .git here; keep walking up.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (roots.size > MAX_CACHE) roots.clear();
  for (const path of visited) roots.set(path, found);
  return found;
}

/** A small regular file's text; null otherwise. Non-blocking, so a planted FIFO cannot hang the parse. */
function readSmall(path: string): string | null {
  let fd: number | null = null;
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_GIT_FILE_BYTES) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const buffer = Buffer.alloc(MAX_GIT_FILE_BYTES);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, read).toString("utf8");
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The main checkout a linked worktree belongs to (`gitdir: <main>/.git/worktrees/<name>`, with `commondir`);
 * the checkout itself when it is not a worktree or its repository can no longer be found.
 */
export function mainCheckout(checkout: string): string {
  const known = mains.get(checkout);
  if (known !== undefined) return known;
  let main = checkout;
  const text = readSmall(join(checkout, ".git"));
  const gitDirLine = text ? /^gitdir:\s*(.+)$/.exec(text.split(/\r?\n/, 1)[0]!.trim()) : null;
  if (gitDirLine) {
    const gitDir = resolve(checkout, gitDirLine[1]!);
    const common = readSmall(join(gitDir, "commondir"))?.split(/\r?\n/, 1)[0]?.trim();
    const commonDir = common ? resolve(gitDir, common) : basename(dirname(gitDir)) === "worktrees" ? dirname(dirname(gitDir)) : null;
    if (commonDir && isDir(gitDir) && isDir(commonDir)) {
      const candidate = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
      if (isDir(candidate)) main = candidate;
    }
  }
  if (mains.size > MAX_CACHE) mains.clear();
  mains.set(checkout, main);
  return main;
}

/** The entry with the largest weight, when it holds a clear majority of `total`. */
function clearWinner(weights: Map<string, number>, total: number): string | null {
  let best: string | null = null;
  let bestWeight = 0;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) {
      best = key;
      bestWeight = weight;
    }
  }
  return best && bestWeight >= MIN_WEIGHT && bestWeight / total >= MIN_SHARE ? best : null;
}

/**
 * The folder directly below the cwd that a path sits in, when that is a folder and not a loose file.
 * Used when the cwd is a plain parent folder and the work happened in a project that is not a repository.
 */
function folderBelow(cwd: string, path: string): string | null {
  if (!isInside(path, cwd) || path === cwd) return null;
  const rest = path.slice(cwd.length).replace(/^\/+/, "").split("/");
  const folder = join(cwd, rest[0]!);
  if (rest.length > 1) return folder;
  try {
    return statSync(folder).isDirectory() ? folder : null;
  } catch {
    return null;
  }
}

/**
 * Codex sessions often start in a parent folder of many repositories. When the cwd is not a repository,
 * or the work clearly happened in one repository below it, that repository is the project. When the cwd
 * is not a repository and the work happened in one plain folder below it, that folder is the project.
 * Work that hopped between worktrees of one repository, none holding a majority alone, belongs to that
 * repository's main checkout.
 */
export function chooseProject(cwd: string | null, evidence: ProjectEvidence[]): string | null {
  if (!evidence.length) return cwd;
  const cwdRepo = cwd ? repoRoot(cwd) : null;
  const checkouts = new Map<string, number>();
  const repositories = new Map<string, number>();
  let total = 0;
  for (const { path, weight } of evidence) {
    total += weight;
    const repo = repoRoot(path);
    const root = repo ?? (!cwdRepo && cwd ? folderBelow(cwd, path) : null);
    if (!root) continue;
    // A repository the cwd already sits in is the cwd's project; only a different one can replace it.
    if (cwdRepo && (root === cwdRepo || !cwd || !isInside(root, cwd))) continue;
    checkouts.set(root, (checkouts.get(root) ?? 0) + weight);
    if (!cwdRepo) {
      const main = repo ? mainCheckout(repo) : root;
      repositories.set(main, (repositories.get(main) ?? 0) + weight);
    }
  }
  return clearWinner(checkouts, total) ?? clearWinner(repositories, total) ?? cwd;
}

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith("/") ? dir : `${dir}/`);
}

/** Directories a shell script worked in: `git -C <dir>` and a leading `cd <dir>`. */
export function scriptDirs(script: string, base: string | null): ProjectEvidence[] {
  const out: ProjectEvidence[] = [];
  const add = (raw: string, weight: number) => {
    const path = expandHome(raw.replace(/^["']|["']$/g, ""));
    if (!path || path.includes("$")) return;
    const full = isAbsolute(path) ? path : base ? join(base, path) : null;
    if (full) out.push({ path: full, weight });
  };
  for (const match of script.matchAll(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/g)) add(match[1]!, 2);
  const cd = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/.exec(script);
  if (cd) add(cd[1]!, 1);
  return out;
}
