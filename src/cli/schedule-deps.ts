import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHome } from "../store/home.js";
import type { LightDeps } from "./main.js";
import type { ScheduleDeps } from "./schedule-command.js";

function real(path: string): string | null {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

/**
 * The Node the job should start. process.execPath is often a versioned path (a Homebrew Cellar folder) that an
 * upgrade deletes; a `node` on PATH that resolves to the same binary (/opt/homebrew/bin/node) survives upgrades.
 */
export function stableNode(execPath: string, pathEnv: string | undefined, exe = process.platform === "win32" ? "node.exe" : "node"): string {
  const target = real(execPath);
  for (const dir of (pathEnv ?? "").split(delimiter)) {
    if (!dir || !dir.startsWith("/")) continue;
    const candidate = join(dir, exe);
    if (target && real(candidate) === target) return candidate;
  }
  return execPath;
}

/** The schedule command's dependencies out of the CLI's own. */
export async function scheduleDeps(deps: LightDeps): Promise<ScheduleDeps> {
  const entry = real(fileURLToPath(new URL("./main.js", import.meta.url))) ?? fileURLToPath(new URL("./main.js", import.meta.url));
  const program = deps.program ?? { node: stableNode(process.execPath, deps.env.PATH), entry };
  return {
    stdout: deps.stdout,
    stderr: deps.stderr,
    env: deps.env,
    platform: deps.platform,
    now: deps.now,
    stdoutTTY: deps.terminal?.isTTY === true,
    stdinTTY: deps.terminal?.stdin === true,
    prompt: deps.prompt,
    ...(deps.spawner ? { spawner: deps.spawner } : {}),
    userHome: deps.userHome ?? homedir(),
    home: resolveHome(deps.env, deps.userHome ?? homedir()),
    node: program.node,
    entry: program.entry,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    refresh:
      deps.scheduleRefresh ??
      (async (from) => {
        const { refreshForSchedule } = await import("./commands.js");
        return refreshForSchedule(deps, from);
      }),
  };
}
