import { lstatSync, renameSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveHome } from "./home.js";

/**
 * The one-time move of a pre-0.2 store from `~/.hindsight` to `~/.ai-insights`, so a product called AI Insights
 * keeps its data under its own name. It runs only from the CLI's own commands (never from the session-start hook
 * in src/nudge/, never from the MCP server) and only when nothing else decides the folder: no AI_INSIGHTS_HOME or
 * HINDSIGHT_HOME, no `~/.ai-insights` of any kind, and `~/.hindsight` a real folder.
 *
 * It is one `rename` in the home folder (atomic on one filesystem), then a symlink `~/.hindsight` -> `~/.ai-insights`
 * so anything still using the old path (an older plugin's MCP server, a script) keeps working. Any failure leaves
 * the data where it was and the run carries on with whatever folder resolveHome then picks: a cross-device or
 * refused rename changes nothing, and a refused symlink is undone by renaming the folder back. Two folders are
 * never merged, and nothing is ever deleted.
 */

export const MOVED_LINE = "Moved your AI Insights data from ~/.hindsight to ~/.ai-insights; the old path still works.";

/** The few filesystem calls the move makes, so tests can fail each one. */
export interface MoveFs {
  /** Null when nothing is there. Never follows a symlink. */
  kind(path: string): "dir" | "link" | "other" | null;
  rename(from: string, to: string): void;
  symlink(target: string, path: string): void;
}

function kind(path: string): "dir" | "link" | "other" | null {
  try {
    const info = lstatSync(path);
    return info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : "other";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    // Unreadable (permissions): treat it as present, so nothing is moved onto or away from it.
    return "other";
  }
}

export const realMoveFs = (platform: NodeJS.Platform = process.platform): MoveFs => ({
  kind,
  rename: renameSync,
  // A junction needs no special rights on Windows, where a directory symlink does.
  symlink: (target, path) => symlinkSync(target, path, platform === "win32" ? "junction" : "dir"),
});

export interface SettledHome {
  home: string;
  /** True only when this call moved the folder and the old path now points at the new one. */
  moved: boolean;
}

/** Where the store is, after moving a legacy-only `~/.hindsight` when that is safe. Never throws. */
export function settleHome(env: NodeJS.ProcessEnv = process.env, user: string = homedir(), fs: MoveFs = realMoveFs()): SettledHome {
  const fallback = (): SettledHome => ({ home: resolveHome(env, user), moved: false });
  if (env.AI_INSIGHTS_HOME?.trim() || env.HINDSIGHT_HOME?.trim()) return fallback();
  const current = join(user, ".ai-insights");
  const legacy = join(user, ".hindsight");
  try {
    if (fs.kind(current) !== null || fs.kind(legacy) !== "dir") return fallback();
    try {
      fs.rename(legacy, current);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      // Cross-device, refused, or another run moved it first: whichever folder now exists is the store.
      return fallback();
    }
    try {
      fs.symlink(current, legacy);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      try {
        fs.rename(current, legacy);
      } catch (undo) {
        if (!(undo instanceof Error)) throw undo;
        // Something took the old name in between: the data stays, complete, in ~/.ai-insights.
        return { home: current, moved: false };
      }
      return { home: legacy, moved: false };
    }
    return { home: current, moved: true };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return fallback();
  }
}
