import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Node built-ins only, so light commands (install, and anything run from an agent hook) can find the store without loading zod.

/**
 * Where AI Insights keeps its cache: `AI_INSIGHTS_HOME`, else `HINDSIGHT_HOME`, else `~/.ai-insights`.
 * Before 0.2 the product was called Hindsight and kept its store in `~/.hindsight`. While only that folder exists
 * it is used where it is; the CLI moves it to `~/.ai-insights` once, leaving a symlink behind
 * (src/store/migrate-home.ts). This function only reads, so the session-start hook can use it and never moves anything.
 */
export function resolveHome(env: NodeJS.ProcessEnv = process.env, user: string = homedir(), exists: (path: string) => boolean = existsSync): string {
  const override = env.AI_INSIGHTS_HOME?.trim() || env.HINDSIGHT_HOME?.trim();
  if (override) return resolve(override);
  const current = join(user, ".ai-insights");
  const legacy = join(user, ".hindsight");
  return !exists(current) && exists(legacy) ? legacy : current;
}
