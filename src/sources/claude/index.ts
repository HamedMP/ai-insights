import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DiscoverOptions, Session, SessionFile, Source } from "../../schema/types.js";
import { excerptClaudeTranscript } from "./excerpt.js";
import { parseClaudeTranscript, subagentFiles } from "./parse.js";

const MAX_PROJECT_DIRS = 5_000;
const MAX_FILES_SCANNED = 100_000;

/**
 * Claude Code writes transcripts to `$CLAUDE_CONFIG_DIR/projects` (default
 * `~/.claude/projects`). Some versions used the XDG location instead.
 */
export function claudeDefaultRoots(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string[] {
  const configured = (env.CLAUDE_CONFIG_DIR ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (configured.length > 0) return configured.map((dir) => join(resolve(dir), "projects"));
  const xdg = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME.trim() : join(home, ".config");
  return [join(home, ".claude", "projects"), join(xdg, "claude", "projects")];
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
  const roots = options.roots ?? claudeDefaultRoots();
  const sinceMs = options.since ? options.since.getTime() : Number.NEGATIVE_INFINITY;
  const seenRoots = new Set<string>();
  const files: SessionFile[] = [];
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
          files.push({ harness: "claude-code", path, mtimeMs, sizeBytes });
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
  parserVersion: "2",
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
