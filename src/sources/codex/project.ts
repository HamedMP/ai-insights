import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome } from "./home.js";

/** A place the session did work, with how strongly it says "this is the project". */
export interface ProjectEvidence {
  path: string;
  weight: number;
}

export const MAX_EVIDENCE = 5_000;
const MAX_CACHE = 20_000;
const MIN_WEIGHT = 2;
const MIN_SHARE = 0.6;

const roots = new Map<string, string | null>();

/** A worktree's `.git` file points into `<main>/.git/worktrees/<name>`; the project is the main repository. */
function worktreeMain(gitFile: string): string | null {
  try {
    const line = readFileSync(gitFile, "utf8").slice(0, 4096);
    const match = /^gitdir:\s*(.+)$/m.exec(line);
    if (!match) return null;
    const target = resolve(dirname(gitFile), match[1]!.trim());
    const cut = target.lastIndexOf("/.git/worktrees/");
    return cut > 0 ? target.slice(0, cut) : null;
  } catch {
    return null;
  }
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

/** The repository a directory belongs to, read from the local filesystem; null when there is none. */
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
      found = info.isDirectory() ? current : info.isFile() ? (worktreeMain(marker) ?? current) : null;
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
 */
export function chooseProject(cwd: string | null, evidence: ProjectEvidence[]): string | null {
  if (!evidence.length) return cwd;
  const cwdRepo = cwd ? repoRoot(cwd) : null;
  const weights = new Map<string, number>();
  let total = 0;
  for (const { path, weight } of evidence) {
    total += weight;
    const root = repoRoot(path) ?? (!cwdRepo && cwd ? folderBelow(cwd, path) : null);
    if (!root) continue;
    // A repository the cwd already sits in is the cwd's project; only a different one can replace it.
    if (cwdRepo && (root === cwdRepo || !cwd || !isInside(root, cwd))) continue;
    weights.set(root, (weights.get(root) ?? 0) + weight);
  }
  let best: string | null = null;
  let bestWeight = 0;
  for (const [root, weight] of weights) {
    if (weight > bestWeight) {
      best = root;
      bestWeight = weight;
    }
  }
  if (!best || bestWeight < MIN_WEIGHT || bestWeight / total < MIN_SHARE) return cwd;
  return best;
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
