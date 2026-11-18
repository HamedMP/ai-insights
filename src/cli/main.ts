#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ServerDeps } from "../mcp/server.js";
import { packageVersion } from "../mcp/version.js";
import type { Harness, Source } from "../schema/types.js";
import type { BuildReportFn, RenderReportFn } from "../store/pipeline.js";
import type { RetentionPolicy } from "../store/retention.js";
import type { AgentStatus, DetectContext } from "./agents.js";
import type { RunningServer, ServeOptions } from "./serve.js";
import type { Spawner } from "./spawn.js";
import { HELP, parseArgs, UsageError, type Parsed } from "./args.js";
import { richHeader } from "./header.js";
import { openWithSystem, readAnswer, type Answer } from "./open.js";
import { detectStyle, type TerminalInfo } from "./terminal.js";

// This entry imports only what the header and argument parsing need. The scanner, analysis, renderer, zod and
// the MCP SDK load after the header is on screen (src/cli/commands.ts), so a person sees something at once.

export interface CliDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  sources: Source[];
  buildReport: BuildReportFn;
  renderReport: RenderReportFn;
  now: () => Date;
  timeZone?: string;
  /** Opens a local file in the default app. Never a URL on the network. Rejects when no opener could start. */
  openFile: (path: string) => Promise<void>;
  startMcp: (deps: ServerDeps) => Promise<unknown>;
  /** How long each harness keeps transcripts. Default: read from this machine's settings files. */
  retentionPolicies?: () => Promise<Map<Harness, RetentionPolicy>>;
  /** What stdout (and stdin, stderr) are. Absent means not a terminal: plain text, no escape codes, no questions. */
  terminal?: TerminalInfo;
  platform: NodeJS.Platform;
  /** Milliseconds from any fixed point, for elapsed time and throttling the progress line. */
  clock: () => number;
  /** Asks one yes/no question on the terminal. */
  prompt: (question: string) => Promise<Answer>;
  /** Runs `handler` on Ctrl-C while work is in progress; returns a function that stops listening. */
  onInterrupt: (handler: () => void) => () => void;
  exit: (code: number) => void;
  /** Starts an agent's CLI for install and uninstall. Default: a real child process. */
  spawner?: Spawner;
  /** Finds the agents on this machine. Default: reads their plugin files under the person's home. */
  detectAgents?: (context: DetectContext) => Promise<AgentStatus[]>;
  /** The person's home folder, where agents keep their config. Default: os.homedir(). */
  userHome?: string;
  /** Starts the loopback report server for `serve`. Default: src/cli/serve.ts. */
  serveReport?: (options: ServeOptions) => Promise<RunningServer>;
}

/** The parts that need the heavy modules; filled in by commands.ts when a test has not supplied them. */
export type HeavyDeps = "sources" | "buildReport" | "renderReport" | "startMcp";
export type LightDeps = Omit<CliDeps, HeavyDeps> & Partial<Pick<CliDeps, HeavyDeps>>;

function lightDefaults(): LightDeps {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    now: () => new Date(),
    openFile: (path) => openWithSystem(path),
    terminal: {
      isTTY: process.stdout.isTTY === true,
      ...(process.stdout.columns ? { columns: process.stdout.columns } : {}),
      stderr: process.stderr.isTTY === true,
      stdin: process.stdin.isTTY === true,
    },
    platform: process.platform,
    clock: () => performance.now(),
    prompt: () => readAnswer(process.stdin),
    onInterrupt: (handler) => {
      process.on("SIGINT", handler);
      return () => process.off("SIGINT", handler);
    },
    exit: (code) => process.exit(code),
  };
}

/**
 * Moves a pre-0.2 `~/.hindsight` store to `~/.ai-insights` once (src/store/migrate-home.ts). Only commands a person
 * runs do this: never `nudge` (the session-start hook) or `mcp` (an agent's server, which may share the folder with
 * an older one still running), and never for help or the version.
 */
async function settleStore(deps: LightDeps): Promise<void> {
  const { MOVED_LINE, settleHome } = await import("../store/migrate-home.js");
  if (settleHome(deps.env).moved) deps.stderr(`${MOVED_LINE}\n`);
}

/** The whole CLI as a function, so tests can drive it. Returns the exit code. */
export async function run(argv: string[], overrides: Partial<CliDeps> = {}): Promise<number> {
  const deps: LightDeps = { ...lightDefaults(), ...overrides };
  if (argv[0] === "import" || argv[0] === "install" || argv[0] === "uninstall") await settleStore(deps);
  if (argv[0] === "import") {
    // Its own small parser and module (src/cli/import.ts), loaded only when asked for.
    try {
      const [{ runImport }, { resolveHome }] = await Promise.all([import("./import.js"), import("../store/store.js")]);
      return await runImport(argv.slice(1), { stdout: deps.stdout, stderr: deps.stderr, home: resolveHome(deps.env), now: deps.now });
    } catch (error) {
      deps.stderr(`ai-insights: import failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  if (argv[0] === "install" || argv[0] === "uninstall") {
    try {
      const [{ installDeps, runInstall }, { resolveHome }] = await Promise.all([import("./install-command.js"), import("../store/home.js")]);
      return await runInstall(argv[0], argv.slice(1), installDeps(deps, resolveHome(deps.env)));
    } catch (error) {
      deps.stderr(`ai-insights: ${argv[0]} failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  if (argv[0] === "nudge") {
    const { runNudge } = await import("../nudge/command.js");
    return runNudge(argv.slice(1), { stdout: deps.stdout, stderr: deps.stderr, env: deps.env, now: deps.now });
  }
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv, deps.now());
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr(`ai-insights: ${error.message}\nRun \`ai-insights --help\` for usage.\n`);
      return 2;
    }
    throw error;
  }
  if (parsed.help) {
    deps.stdout(HELP);
    return 0;
  }
  if (parsed.version) {
    deps.stdout(`${packageVersion()}\n`);
    return 0;
  }
  if (parsed.json && parsed.command !== "report") {
    deps.stderr("ai-insights: --json only works with `ai-insights report`\n");
    return 2;
  }
  if (parsed.command !== "mcp") await settleStore(deps);
  const style = detectStyle(deps.env, deps.terminal, deps.platform);
  if (parsed.command === "run" && style.rich) deps.stdout(richHeader(packageVersion(), style));
  const { execute } = await import("./commands.js");
  return execute(parsed, deps, style);
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  if (process.argv[2] === "mcp") {
    // A stray console.log anywhere would corrupt the protocol stream on stdout.
    console.log = console.error;
    console.info = console.error;
    console.debug = console.error;
  }
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`ai-insights: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
