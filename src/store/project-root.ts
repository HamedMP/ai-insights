import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { mapLimit } from "./fs.js";

/**
 * Finds the repository a project folder belongs to from the file system alone, so git worktrees and
 * subfolders of one repository count as one project. Never runs git and never throws.
 */

/** Folders walked up from a project path before giving up. */
export const MAX_WALK_DEPTH = 64;
/** A real `.git` file or `commondir` is one short line; anything bigger is not git's and is not read. */
export const MAX_GIT_FILE_BYTES = 8 * 1024;
/** Worktree entries read per repository when placing a deleted worktree. */
export const MAX_WORKTREES_LISTED = 1_000;
/** Distinct project folders resolved per scan. */
export const MAX_PROJECT_PATHS = 10_000;
const MAX_PATH_CHARS = 4_096;
const CONCURRENCY = 8;

/** `projectPath` to its root, or undefined when there is none to give. `missing` holds folders that no longer exist. */
export class ProjectRoots extends Map<string, string | undefined> {
  readonly missing = new Set<string>();
}

type Lookup = { kind: "root"; root: string } | { kind: "missing" } | { kind: "none" };

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/** The file's text when it is a small regular file; null otherwise. Opens non-blocking so a planted FIFO cannot hang the scan. */
async function readSmallFile(path: string): Promise<string | null> {
  const info = await statOrNull(path);
  if (!info || !info.isFile() || info.size > MAX_GIT_FILE_BYTES) return null;
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    const buffer = Buffer.alloc(MAX_GIT_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_GIT_FILE_BYTES) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/, 1)[0] ?? "").trim();
}

/** The checkout a git common directory belongs to: the parent of `.git`, or the bare repository itself. */
function checkoutOf(commonDir: string): string {
  return basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
}

/** Root for a folder whose `.git` is a file: a linked worktree points into `<main>/.git/worktrees/<name>`. */
async function rootFromGitFile(folder: string, gitFile: string): Promise<string | null> {
  const text = await readSmallFile(gitFile);
  if (text === null) return null;
  const match = /^gitdir:\s*(.+)$/.exec(firstLine(text));
  if (!match || match[1]!.includes("\u0000")) return null;
  const gitDir = resolve(folder, match[1]!);
  const gitDirInfo = await statOrNull(gitDir);
  if (!gitDirInfo?.isDirectory()) return null;

  const common = await readSmallFile(join(gitDir, "commondir"));
  let commonDir: string | null = null;
  if (common !== null && firstLine(common) && !common.includes("\u0000")) commonDir = resolve(gitDir, firstLine(common));
  else if (basename(dirname(gitDir)) === "worktrees") commonDir = dirname(dirname(gitDir));

  // Not a linked worktree (a submodule, or a separate git dir): the folder is its own checkout.
  if (commonDir === null) return folder;
  const root = checkoutOf(commonDir);
  return (await statOrNull(root))?.isDirectory() ? root : null;
}

async function lookup(projectPath: string): Promise<Lookup> {
  if (!projectPath || projectPath.length > MAX_PATH_CHARS || !isAbsolute(projectPath) || projectPath.includes("\u0000")) {
    return { kind: "none" };
  }
  const start = resolve(projectPath);
  const info = await statOrNull(start);
  if (!info) return { kind: "missing" };
  if (!info.isDirectory()) return { kind: "none" };

  let folder = start;
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
    const gitPath = join(folder, ".git");
    const git = await statOrNull(gitPath);
    if (git?.isDirectory()) return { kind: "root", root: folder };
    if (git) {
      // The first .git entry decides; an unreadable or foreign one means we cannot say, not that we look higher.
      if (!git.isFile()) return { kind: "none" };
      const root = await rootFromGitFile(folder, gitPath);
      return root === null ? { kind: "none" } : { kind: "root", root };
    }
    const parent = dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return { kind: "none" };
}

/** Working folders git still lists for a repository, from `<root>/.git/worktrees/*\/gitdir`. */
async function listedWorktrees(root: string): Promise<string[]> {
  // A bare repository keeps `worktrees/` at its top; only look there when there is no `.git` to look in.
  const admin = (await statOrNull(join(root, ".git"))) ? join(root, ".git", "worktrees") : join(root, "worktrees");
  let names: string[];
  try {
    names = (await readdir(admin)).slice(0, MAX_WORKTREES_LISTED);
  } catch {
    return [];
  }
  const folders: string[] = [];
  for (const name of names) {
    const text = await readSmallFile(join(admin, name, "gitdir"));
    const line = text === null ? "" : firstLine(text);
    if (!line || line.includes("\u0000")) continue;
    const gitFile = resolve(join(admin, name), line);
    const folder = basename(gitFile) === ".git" ? dirname(gitFile) : gitFile;
    // A listing that names the file-system root would claim every deleted folder.
    if (dirname(folder) !== folder) folders.push(folder);
  }
  return folders;
}

function inside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);
}

export interface ResolveRootsOptions {
  /** Roots learned earlier (for example from cached sessions), also searched when placing a deleted worktree. */
  knownRoots?: Iterable<string>;
}

/**
 * Resolves each distinct project path once. A folder that is gone gets the root of a repository that
 * still lists it as a worktree, when some other path in this scan (or a known root) reached that repository.
 */
export async function resolveProjectRoots(paths: Iterable<string>, options: ResolveRootsOptions = {}): Promise<ProjectRoots> {
  const unique = [...new Set(paths)].slice(0, MAX_PROJECT_PATHS);
  const result = new ProjectRoots();
  const lookups = await mapLimit(unique, CONCURRENCY, (path) => lookup(path).catch((): Lookup => ({ kind: "none" })));

  const roots = new Set<string>();
  unique.forEach((path, index) => {
    const found = lookups[index]!;
    if (found.kind === "root") {
      result.set(path, found.root);
      roots.add(found.root);
    } else {
      result.set(path, undefined);
      if (found.kind === "missing") result.missing.add(path);
    }
  });
  if (result.missing.size === 0) return result;

  for (const root of options.knownRoots ?? []) if (typeof root === "string" && isAbsolute(root)) roots.add(root);
  const worktrees: Array<{ folder: string; root: string }> = [];
  for (const root of [...roots].slice(0, MAX_PROJECT_PATHS)) {
    for (const folder of await listedWorktrees(root).catch(() => [])) worktrees.push({ folder, root });
  }
  // Longest folder first, so a worktree nested inside another checkout maps to the most specific entry.
  worktrees.sort((a, b) => b.folder.length - a.folder.length);
  for (const path of result.missing) {
    const target = resolve(path);
    const hit = worktrees.find((entry) => inside(target, entry.folder));
    if (hit) result.set(path, hit.root);
  }
  return result;
}
