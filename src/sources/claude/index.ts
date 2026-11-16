import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { DiscoverOptions, Session, SessionFile, Source } from "../../schema/types.js";
import { excerptClaudeTranscript } from "./excerpt.js";
import { parseClaudeTranscript, subagentFiles } from "./parse.js";

const MAX_PROJECT_DIRS = 5_000;
const MAX_FILES_SCANNED = 100_000;

/**
 * Claude Desktop keeps the Code and Cowork sessions it runs in these stores, each with embedded `.claude/projects`
 * roots. The store names, search depth and skipped folders follow CodexBar's ClaudeDesktopProjectsLocator
 * (https://github.com/steipete/CodexBar, MIT). Cowork's `audit.jsonl` files are not read: on the history this was
 * checked against they repeated the embedded transcripts' responses and nothing else.
 */
const DESKTOP_STORES = ["local-agent-mode-sessions", "claude-code-sessions"];

/**
 * Claude Desktop is an Electron app named "Claude", so its data lives in Electron's per-user `userData`
 * folder: `~/Library/Application Support/Claude` on macOS, `%APPDATA%\\Claude` on Windows and
 * `$XDG_CONFIG_HOME/Claude` (default `~/.config/Claude`) on Linux
 * (https://www.electronjs.org/docs/latest/api/app#appgetpathname).
 */
function desktopHome(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", "Claude");
  if (platform === "win32") return join(env.APPDATA?.trim() ? env.APPDATA.trim() : join(home, "AppData", "Roaming"), "Claude");
  return join(env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME.trim() : join(home, ".config"), "Claude");
}

/**
 * Claude Code writes transcripts to `$CLAUDE_CONFIG_DIR/projects`, default `~/.claude/projects`; some
 * versions used the XDG location instead. Claude Code reads `CLAUDE_CONFIG_DIR` as one literal directory
 * (`process.env.CLAUDE_CONFIG_DIR || ~/.claude`), so a comma is part of the path, not a separator.
 * Claude Desktop's session stores are listed as well; `discover` finds the project roots nested in them.
 */
export function claudeDefaultRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir(), platform: NodeJS.Platform = process.platform): string[] {
  const configured = env.CLAUDE_CONFIG_DIR;
  const xdg = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME.trim() : join(home, ".config");
  const cli = configured ? [join(resolve(configured), "projects")] : [join(home, ".claude", "projects"), join(xdg, "claude", "projects")];
  const desktop = desktopHome(env, home, platform);
  return [...cli, ...DESKTOP_STORES.map((store) => join(desktop, store))];
}

/** Folders inside a Desktop session store that hold workspace files, never transcripts. */
const SKIPPED_DIRS = new Set([".build", ".git", "build", "DerivedData", "node_modules", "outputs", "target"]);
const MAX_STORE_DEPTH = 4;
const MAX_STORE_DIRS = 5_000;

/** The `.claude/projects` roots nested in a Claude Desktop session store, breadth first and bounded. */
async function desktopProjectRoots(store: string): Promise<string[]> {
  const found: string[] = [];
  let queue: string[] = [store];
  let visited = 0;
  for (let depth = 0; depth <= MAX_STORE_DEPTH && queue.length; depth += 1) {
    const next: string[] = [];
    for (const dir of queue) {
      if (visited >= MAX_STORE_DIRS) return found;
      visited += 1;
      const entries = await listDir(dir);
      for (const entry of entries) {
        // Dirent.isDirectory() is false for symlinks, so links out of the store are not followed.
        if (!entry.isDirectory()) continue;
        if (entry.name === ".claude") {
          const projects = join(dir, ".claude", "projects");
          if ((await listDir(projects)).length) found.push(projects);
          continue;
        }
        if (!SKIPPED_DIRS.has(entry.name)) next.push(join(dir, entry.name));
      }
    }
    queue = next;
  }
  return found;
}

/** Roots to scan: a Desktop session store expands into its nested project roots; anything else is a projects root. */
async function projectRoots(roots: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const root of roots) {
    if (DESKTOP_STORES.includes(basename(root))) out.push(...(await desktopProjectRoots(root)));
    else out.push(root);
  }
  return out;
}

async function listDir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Session transcripts sit at `<root>/<project-dir>/<session-id>.jsonl`.
 * Deeper `.jsonl` files belong to a session's subagents and are read with
 * their parent, so they are not listed as sessions of their own.
 */
async function discover(options: DiscoverOptions = {}): Promise<SessionFile[]> {
  const roots = await projectRoots(options.roots ?? claudeDefaultRoots());
  const sinceMs = options.since ? options.since.getTime() : Number.NEGATIVE_INFINITY;
  const seenRoots = new Set<string>();
  const files: SessionFile[] = [];
  // Session id to the file kept for it and the root it came from: one session copied into two roots is listed once.
  const bySession = new Map<string, { file: SessionFile; root: string }>();
  let scanned = 0;

  for (const root of roots) {
    let real: string;
    try {
      real = await realpath(root);
    } catch {
      continue;
    }
    if (seenRoots.has(real)) continue;
    seenRoots.add(real);

    const projects = (await listDir(root)).filter((entry) => entry.isDirectory()).slice(0, MAX_PROJECT_DIRS);
    for (const project of projects) {
      const dir = join(root, project.name);
      for (const entry of await listDir(dir)) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        if (scanned >= MAX_FILES_SCANNED) break;
        scanned += 1;
        const path = join(dir, entry.name);
        try {
          const info = await stat(path);
          let mtimeMs = info.mtimeMs;
          let sizeBytes = info.size;
          // A background subagent can keep writing after the parent file goes quiet; the session is stale either way.
          for (const sub of await subagentFiles(path)) {
            try {
              const subInfo = await stat(sub);
              mtimeMs = Math.max(mtimeMs, subInfo.mtimeMs);
              sizeBytes += subInfo.size;
            } catch {
              // Vanished between listing and stat; ignore.
            }
          }
          if (mtimeMs < sinceMs) continue;
          const file: SessionFile = { harness: "claude-code", path, mtimeMs, sizeBytes };
          const sessionId = entry.name.slice(0, -".jsonl".length);
          const kept = bySession.get(sessionId);
          if (kept && kept.root !== real) {
            // The fuller copy wins; requests are de-duplicated by response id downstream either way.
            if (sizeBytes > kept.file.sizeBytes || (sizeBytes === kept.file.sizeBytes && mtimeMs > kept.file.mtimeMs)) {
              files[files.indexOf(kept.file)] = file;
              bySession.set(sessionId, { file, root: real });
            }
            continue;
          }
          if (!kept && bySession.size < MAX_FILES_SCANNED) bySession.set(sessionId, { file, root: real });
          files.push(file);
        } catch {
          continue;
        }
      }
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  return options.maxFiles !== undefined ? files.slice(0, Math.max(0, options.maxFiles)) : files;
}

async function parse(file: SessionFile): Promise<Session | null> {
  try {
    return await parseClaudeTranscript(file);
  } catch {
    // The parser is written not to throw; this guards the contract if a filesystem error slips through.
    return null;
  }
}

export const claudeSource: Source = {
  // Bump when the same transcript would parse to a different Session, so the store re-parses cached history.
  parserVersion: "6",
  harness: "claude-code",
  label: "Claude Code",
  defaultRoots: () => claudeDefaultRoots(),
  discover,
  parse,
  excerpt: async (file, options) => {
    try {
      return await excerptClaudeTranscript(file, options);
    } catch {
      return [];
    }
  },
};
