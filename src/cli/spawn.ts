import { spawn } from "node:child_process";

// Runs another program (an agent's own CLI) and reports how it went. Never throws and never hangs: every run
// has a timeout, and stdout and stderr are kept only up to a cap.

export interface SpawnResult {
  ok: boolean;
  /** Exit code; null when the program could not start, was killed, or timed out. */
  code: number | null;
  timedOut: boolean;
  /** Why it could not start, e.g. ENOENT. */
  error?: string;
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}

export type Spawner = (command: string, args: string[], options: SpawnOptions) => Promise<SpawnResult>;

const MAX_OUTPUT = 64 * 1024;

export const spawnCommand: Spawner = (command, args, options) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: Omit<SpawnResult, "stdout" | "stderr" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, timedOut, stdout, stderr });
    };
    let child: ReturnType<typeof spawn>;
    try {
      // Windows installs agent CLIs as .cmd shims, which only start through a shell; the arguments here are fixed strings.
      child = spawn(command, args, { env: options.env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
    } catch (error) {
      resolve({ ok: false, code: null, timedOut: false, error: error instanceof Error ? error.message : String(error), stdout: "", stderr: "" });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
      finish({ ok: false, code: null });
    }, options.timeoutMs);
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.slice(0, MAX_OUTPUT - stdout.length);
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.slice(0, MAX_OUTPUT - stderr.length);
    });
    child.once("error", (error) => finish({ ok: false, code: null, error: error.message }));
    child.once("close", (code) => finish({ ok: code === 0, code }));
  });
