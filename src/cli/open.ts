import { spawn } from "node:child_process";

export const OPEN_QUESTION = "Open the report in your browser? [Y/n]";

export type Answer = "yes" | "no" | "cancel";

/** One key of the answer. Enter or y means yes, n means no, Ctrl-C cancels, Ctrl-D (end of input) means no; anything else is ignored. */
export function answerFor(key: string): Answer | null {
  if (key === "\r" || key === "\n" || key === "y" || key === "Y") return "yes";
  if (key === "n" || key === "N" || key === "\u0004") return "no";
  if (key === "\u0003") return "cancel";
  return null;
}

/** "now" opens without asking, "ask" asks after the screen, "manual" leaves it to the person. */
export type OpenMode = "now" | "ask" | "manual";

export interface OpenContext {
  /** --open or --no-open, when given. */
  flag: "open" | "no-open" | null;
  env: NodeJS.ProcessEnv;
  stdoutTTY: boolean;
  stdinTTY: boolean;
  platform: NodeJS.Platform;
}

function truthy(value: string | undefined): boolean | null {
  if (value === undefined || value.trim() === "") return null;
  const normalised = value.trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(normalised)) return false;
  return true;
}

/**
 * A browser would open on a screen the person is not looking at, or not at all: over SSH, unless a Linux
 * session forwards a display (X11 or Wayland).
 */
export function remoteWithoutDisplay(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const ssh = Boolean(env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY);
  if (!ssh) return false;
  if (platform === "darwin" || platform === "win32") return true;
  return !(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/**
 * --open and --no-open always win. Otherwise only a person at an interactive terminal is asked (stdin and
 * stdout both terminals, not CI, not SSH without a display); AI_INSIGHTS_OPEN=1 or 0 answers for them.
 */
export function openMode(context: OpenContext): OpenMode {
  if (context.flag === "no-open") return "manual";
  if (context.flag === "open") return "now";
  if (!context.stdoutTTY || !context.stdinTTY) return "manual";
  if (truthy(context.env.CI)) return "manual";
  if (remoteWithoutDisplay(context.env, context.platform)) return "manual";
  const preference = truthy(context.env.AI_INSIGHTS_OPEN);
  if (preference === false) return "manual";
  if (preference === true) return "now";
  return "ask";
}

/** Reads one key from a terminal without waiting for Enter, then puts the terminal back as it was. */
export function readAnswer(input: NodeJS.ReadStream = process.stdin): Promise<Answer> {
  return new Promise((resolve) => {
    const canRaw = typeof input.setRawMode === "function";
    const wasRaw = input.isRaw === true;
    // In raw mode Ctrl-C arrives as a key, not a signal, so the answer handles it.
    if (canRaw) input.setRawMode(true);
    input.setEncoding("utf8");
    const finish = (answer: Answer) => {
      input.off("data", onData);
      input.off("end", onEnd);
      if (canRaw) input.setRawMode(wasRaw);
      // A paused stdin no longer keeps the process alive.
      input.pause();
      resolve(answer);
    };
    const onData = (data: string) => {
      for (const key of data) {
        const answer = answerFor(key);
        if (answer) {
          finish(answer);
          return;
        }
      }
    };
    const onEnd = () => finish("no");
    input.on("data", onData);
    input.once("end", onEnd);
    input.resume();
  });
}

/**
 * Hands a local file to the system's opener, detached and with no stdio, so the CLI never waits on the
 * browser. Rejects only when the opener cannot be started (for example no xdg-open).
 */
export function openWithSystem(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const [command, args] = platform === "darwin" ? ["open", [path]] : platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command as string, args as string[], { stdio: "ignore", detached: true });
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
