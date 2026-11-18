import { mkdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Answer } from "./open.js";
import {
  CADENCES,
  cronLine,
  dateText,
  jobArgs,
  jobEnv,
  LABEL,
  launchAgentPath,
  launchAgentPlist,
  nextRun,
  notificationText,
  parseTime,
  parseWeekday,
  refuseEntry,
  schtasksCommand,
  shellLine,
  systemdDir,
  systemdService,
  systemdTimer,
  UNIT,
  whenText,
  WINDOW_DAYS,
  windowStart,
  type Cadence,
  type JobCommand,
  type NotificationCounts,
  type ScheduleSpec,
} from "./schedule.js";
import { writeDigest } from "../store/digest.js";
import { spawnCommand, type Spawner } from "./spawn.js";

// `ai-insights schedule daily|weekly|monthly | off | status`, and `schedule run`, which is what the installed job
// starts. Installing is treated like `ai-insights install`: it says exactly what it adds, waits for a yes, never
// happens in CI or away from a terminal, and every child process has a timeout. Failures are reported, never thrown.

export const SCHEDULE_HELP = `ai-insights schedule: refresh the report on a schedule and show a notification.

Usage
  ai-insights schedule daily|weekly|monthly [--at HH:MM] [--day mon..sun] [--with-cost] [--yes] [--dry-run]
  ai-insights schedule off      remove the scheduled job
  ai-insights schedule status   show what is installed and when it runs next

Adds one job to this computer's own scheduler (a launchd agent on macOS, a systemd user timer on
Linux) that keeps running after a restart. At the chosen time it reads your agent history here,
rewrites the report and shows a notification with counts only. It sends nothing anywhere.
Where there is no user systemd it prints a crontab line instead; on Windows it prints a schtasks
command (untested there). It needs a global install (npm i -g ai-insights), never npx.

Options
  --at HH:MM     time of day, 24-hour (default 09:00)
  --day <day>    weekly only: mon, tue, wed, thu, fri, sat or sun (default mon)
  --with-cost    also show the estimated cost in the notification
  -y, --yes      add it without asking (still only at a terminal)
  --dry-run      show what it would add, change nothing
  -h, --help     show this help
`;

const STEP_TIMEOUT_MS = 15_000;
const NOTIFY_TIMEOUT_MS = 10_000;
const STATE_FILE = "schedule.json";
const LOG_FILE = "schedule.log";
const MAX_LOG_BYTES = 256 * 1024;

export interface ScheduleDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  now: () => Date;
  stdoutTTY: boolean;
  stdinTTY: boolean;
  prompt: (question: string) => Promise<Answer>;
  spawner?: Spawner;
  /** The person's home folder: where LaunchAgents and systemd user units live. */
  userHome: string;
  /** The store folder (~/.ai-insights): the job's state and log. */
  home: string;
  /** This Node and this install's CLI file, as the job will start them. */
  node: string;
  entry: string;
  uid: number | null;
  /** The job's work: writes the report and counts the window. Throws on failure; the caller reports it. */
  refresh?: (windowFrom: Date) => Promise<NotificationCounts & { htmlPath: string; prompts: number; tipId: string | null }>;
}

/** What removing a schedule needs: no prompt, no program path. `ai-insights uninstall` passes this. */
export type RemoveDeps = Pick<ScheduleDeps, "userHome" | "env" | "home" | "platform" | "spawner" | "uid">;

type System = "launchd" | "systemd" | "cron" | "windows" | "none";

interface Installed {
  system: "launchd" | "systemd";
  files: string[];
  spec: ScheduleSpec | null;
  lastRun: { at: string; ok: boolean } | null;
}

class ScheduleUsageError extends Error {}

interface ScheduleArgs {
  verb: Cadence | "off" | "status" | "run" | null;
  runCadence: Cadence | null;
  hour: number;
  minute: number;
  weekday: number;
  daySet: boolean;
  withCost: boolean;
  yes: boolean;
  dryRun: boolean;
  help: boolean;
}

function parseScheduleArgs(argv: string[]): ScheduleArgs {
  const args: ScheduleArgs = { verb: null, runCadence: null, hour: 9, minute: 0, weekday: 1, daySet: false, withCost: false, yes: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    const [flag, inline] = raw.startsWith("--") && raw.includes("=") ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)] : [raw, undefined];
    const value = () => {
      const next = inline ?? argv[++index];
      if (next === undefined || next.startsWith("--")) throw new ScheduleUsageError(`${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case "--at": {
        const time = parseTime(value());
        if (!time) throw new ScheduleUsageError("--at must be a time like 09:00 or 18:30");
        args.hour = time.hour;
        args.minute = time.minute;
        break;
      }
      case "--day": {
        const day = parseWeekday(value());
        if (day === null) throw new ScheduleUsageError("--day must be one of mon, tue, wed, thu, fri, sat, sun");
        args.weekday = day;
        args.daySet = true;
        break;
      }
      case "--with-cost":
        args.withCost = true;
        break;
      case "-y":
      case "--yes":
        args.yes = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        // `schedule run <cadence>` is the job's own command line.
        if (args.verb === "run" && args.runCadence === null && (CADENCES as readonly string[]).includes(raw)) {
          args.runCadence = raw as Cadence;
          break;
        }
        if (raw.startsWith("-") || args.verb !== null) throw new ScheduleUsageError(`unknown ${raw.startsWith("-") ? "option" : "argument"} "${raw}"`);
        if (!([...CADENCES, "off", "status", "run"] as string[]).includes(raw)) throw new ScheduleUsageError(`unknown schedule "${raw}": use daily, weekly, monthly, off or status`);
        args.verb = raw as ScheduleArgs["verb"];
    }
  }
  if (args.daySet && args.verb !== "weekly") throw new ScheduleUsageError("--day only works with weekly");
  return args;
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== "" && !["0", "false", "no"].includes(value.trim().toLowerCase());
}

const tilde = (path: string, user: string) => (path === user || path.startsWith(`${user}/`) ? `~${path.slice(user.length)}` : path);

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readState(home: string): Promise<{ spec?: ScheduleSpec; lastRun?: { at: string; ok: boolean } } | null> {
  try {
    const text = await readFile(join(home, STATE_FILE), "utf8");
    const parsed = JSON.parse(text.slice(0, 16_384)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as { spec?: ScheduleSpec; lastRun?: { at: string; ok: boolean } }) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeState(home: string, state: object): Promise<void> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(join(home, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function validSpec(value: unknown): ScheduleSpec | null {
  const spec = value as ScheduleSpec | undefined;
  if (!spec || !CADENCES.includes(spec.cadence)) return null;
  const ok = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
  return ok(spec.hour, 23) && ok(spec.minute, 59) && ok(spec.weekday, 6) ? { ...spec, withCost: spec.withCost === true } : null;
}

// -- which scheduler ---------------------------------------------------------------------------

async function userSystemd(deps: ScheduleDeps): Promise<boolean> {
  const result = await (deps.spawner ?? spawnCommand)("systemctl", ["--user", "show-environment"], { timeoutMs: 5_000, env: deps.env });
  return result.ok;
}

async function systemFor(deps: ScheduleDeps): Promise<System> {
  if (deps.platform === "darwin") return "launchd";
  if (deps.platform === "win32") return "windows";
  if (deps.platform === "linux") return (await userSystemd(deps)) ? "systemd" : "cron";
  return "none";
}

function unitPaths(deps: Pick<ScheduleDeps, "userHome" | "env">): { service: string; timer: string } {
  const dir = systemdDir(deps.userHome, deps.env);
  return { service: join(dir, `${UNIT}.service`), timer: join(dir, `${UNIT}.timer`) };
}

/** What is installed now, found by the fixed paths this command writes, whatever the state file says. */
export async function findInstalled(deps: Pick<RemoveDeps, "userHome" | "env" | "home" | "platform">): Promise<Installed | null> {
  const state = await readState(deps.home);
  const spec = validSpec(state?.spec);
  const lastRun = state?.lastRun && typeof state.lastRun.at === "string" ? { at: state.lastRun.at, ok: state.lastRun.ok === true } : null;
  const plist = launchAgentPath(deps.userHome);
  if (deps.platform === "darwin" && (await exists(plist))) return { system: "launchd", files: [plist], spec, lastRun };
  const units = unitPaths(deps);
  const present = [];
  for (const file of [units.service, units.timer]) if (await exists(file)) present.push(file);
  if (present.length) return { system: "systemd", files: present, spec, lastRun };
  return null;
}

// -- steps -------------------------------------------------------------------------------------

interface Step {
  command: string;
  args: string[];
  /** A failure here is expected (e.g. "not loaded") and not reported. */
  mayFail?: boolean;
}

async function runSteps(steps: Step[], deps: Pick<ScheduleDeps, "spawner" | "env">): Promise<{ ok: boolean; failed?: string }> {
  for (const step of steps) {
    const result = await (deps.spawner ?? spawnCommand)(step.command, step.args, { timeoutMs: STEP_TIMEOUT_MS, env: deps.env });
    if (result.ok || step.mayFail) continue;
    const why = result.timedOut ? "timed out" : result.error ? result.error : `exited with ${result.code}`;
    const detail = result.stderr.trim().split("\n").slice(-1)[0]?.slice(0, 200);
    return { ok: false, failed: `${shellLine([step.command, ...step.args])} ${why}${detail ? `: ${detail}` : ""}` };
  }
  return { ok: true };
}

function launchdTarget(deps: Pick<ScheduleDeps, "uid">): string {
  return `gui/${deps.uid ?? 0}`;
}

function removalSteps(installed: Installed, deps: RemoveDeps): Step[] {
  if (installed.system === "launchd") return [{ command: "launchctl", args: ["bootout", `${launchdTarget(deps)}/${LABEL}`], mayFail: true }];
  return [{ command: "systemctl", args: ["--user", "disable", "--now", `${UNIT}.timer`], mayFail: true }];
}

/** Removes everything a schedule added: stops it, deletes its files, forgets it. Returns the lines to print. */
export async function removeSchedule(deps: RemoveDeps): Promise<{ ok: boolean; lines: string[] }> {
  const installed = await findInstalled(deps);
  if (!installed) return { ok: true, lines: [] };
  await runSteps(removalSteps(installed, deps), deps);
  const lines: string[] = [];
  let ok = true;
  for (const file of installed.files) {
    try {
      await rm(file, { force: true });
      lines.push(`Removed ${tilde(file, deps.userHome)}`);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      ok = false;
      lines.push(`Could not remove ${tilde(file, deps.userHome)}: delete it yourself.`);
    }
  }
  if (installed.system === "systemd") await runSteps([{ command: "systemctl", args: ["--user", "daemon-reload"], mayFail: true }], deps);
  await rm(join(deps.home, STATE_FILE), { force: true }).catch(() => undefined);
  return { ok, lines };
}

// -- install -------------------------------------------------------------------------------------

interface Plan {
  system: "launchd" | "systemd";
  files: Array<{ path: string; content: string }>;
  steps: Step[];
}

function planFor(system: "launchd" | "systemd", spec: ScheduleSpec, command: JobCommand, deps: ScheduleDeps): Plan {
  const env = jobEnv(deps.env);
  if (system === "launchd") {
    const path = launchAgentPath(deps.userHome);
    return {
      system,
      files: [{ path, content: launchAgentPlist(spec, command, env, join(deps.home, LOG_FILE)) }],
      steps: [
        // A schedule added before is replaced: unload it first (fails harmlessly when nothing is loaded).
        { command: "launchctl", args: ["bootout", `${launchdTarget(deps)}/${LABEL}`], mayFail: true },
        { command: "launchctl", args: ["bootstrap", launchdTarget(deps), path] },
      ],
    };
  }
  const units = unitPaths(deps);
  return {
    system,
    files: [
      { path: units.service, content: systemdService(command, env) },
      { path: units.timer, content: systemdTimer(spec) },
    ],
    steps: [
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", `${UNIT}.timer`] },
    ],
  };
}

/** The confirmation, in full: when, what it runs, every file it adds and every command it runs. */
export function describeSchedule(plan: Plan, spec: ScheduleSpec, command: JobCommand, deps: Pick<ScheduleDeps, "userHome" | "now">): string[] {
  const example = notificationText(spec.cadence, { sessions: 41, activeMinutes: 366, costUsd: 23 }, spec.withCost);
  return [
    "This adds a scheduled job to this computer that keeps running after a restart:",
    `  when   ${whenText(spec)} (next: ${dateText(nextRun(spec, deps.now()))})`,
    `  runs   ${shellLine([command.node, command.entry, ...command.args])}`,
    ...plan.files.map((file, index) => `  ${index === 0 ? "adds" : "    "}   ${tilde(file.path, deps.userHome)}`),
    ...plan.steps.filter((step) => !step.mayFail).map((step, index) => `  ${index === 0 ? "then" : "    "}   ${shellLine([step.command, ...step.args])}`),
    "Each time it reads your agent history on this computer, rewrites the report and shows a",
    `notification with counts only, like "${example}"`,
    `${spec.withCost ? "The estimated cost is included because of --with-cost. " : ""}It sends nothing anywhere.`,
    "Remove it any time with: ai-insights schedule off (ai-insights uninstall removes it too)",
  ];
}

export const SCHEDULE_QUESTION = "Add this schedule? [Y/n]";

async function commandAdd(cadence: Cadence, args: ScheduleArgs, deps: ScheduleDeps): Promise<number> {
  if (truthy(deps.env.CI)) {
    deps.stderr("ai-insights schedule: not in CI. A schedule is for your own computer; run it at your terminal there.\n");
    return 1;
  }
  const refusal = refuseEntry(deps.entry);
  if (refusal) {
    deps.stderr(`ai-insights schedule: ${refusal}\n`);
    return 1;
  }
  const spec: ScheduleSpec = { cadence, hour: args.hour, minute: args.minute, weekday: cadence === "weekly" ? args.weekday : 0, withCost: args.withCost };
  const command: JobCommand = { node: deps.node, entry: deps.entry, args: jobArgs(spec) };
  const system = await systemFor(deps);
  if (system === "cron" || system === "none") {
    deps.stdout(
      [
        "No systemd user session here, so AI Insights adds nothing. To run it on a schedule yourself,",
        `add this line with crontab -e (${whenText(spec)}; notifications need a desktop session):`,
        "",
        cronLine(spec, command),
        "",
      ].join("\n"),
    );
    return 0;
  }
  if (system === "windows") {
    deps.stdout(
      [
        "Scheduling on Windows is untested, so AI Insights adds nothing itself. To run it on a schedule",
        `(${whenText(spec)}; it refreshes the report, with no notification on Windows), run this in a terminal:`,
        "",
        schtasksCommand(spec, command),
        "",
        `Remove it with: schtasks /Delete /TN "AI Insights schedule" /F`,
        "",
      ].join("\n"),
    );
    return 0;
  }
  const plan = planFor(system, spec, command, deps);
  const before = await findInstalled(deps);
  const lines = describeSchedule(plan, spec, command, deps);
  if (before?.spec) lines.splice(1, 0, `  It replaces the current schedule (${whenText(before.spec)}).`);
  deps.stdout(`${lines.join("\n")}\n`);
  if (args.dryRun) {
    deps.stdout("Dry run: nothing was changed.\n");
    return 0;
  }
  if (!deps.stdoutTTY || !deps.stdinTTY) {
    deps.stdout("Nothing was added: a schedule is added only at a terminal, after you say yes.\n");
    return 1;
  }
  if (!args.yes) {
    deps.stdout(`${SCHEDULE_QUESTION} `);
    const answer = await deps.prompt(SCHEDULE_QUESTION);
    deps.stdout(answer === "yes" ? "yes\n" : "no\n");
    if (answer === "cancel") return 130;
    if (answer === "no") {
      deps.stdout("Nothing was added.\n");
      return 0;
    }
  }
  if (before) await removeSchedule(deps);
  const written: string[] = [];
  try {
    await mkdir(deps.home, { recursive: true, mode: 0o700 });
    for (const file of plan.files) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.content, { mode: 0o644 });
      written.push(file.path);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    for (const path of written) await rm(path, { force: true }).catch(() => undefined);
    deps.stderr(`ai-insights schedule: could not write ${tilde(plan.files[written.length]?.path ?? "", deps.userHome)}; nothing was added.\n`);
    return 1;
  }
  const outcome = await runSteps(plan.steps, deps);
  if (!outcome.ok) {
    for (const path of written) await rm(path, { force: true }).catch(() => undefined);
    if (plan.system === "systemd") await runSteps([{ command: "systemctl", args: ["--user", "daemon-reload"], mayFail: true }], deps);
    deps.stderr(`ai-insights schedule: ${outcome.failed}. Nothing was added.\n`);
    return 1;
  }
  try {
    await writeState(deps.home, { v: 1, spec, system: plan.system, files: written, installedAt: deps.now().toISOString() });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    // The job runs without it; status then shows the files but not the cadence.
  }
  deps.stdout(`Added. Next run: ${dateText(nextRun(spec, deps.now()))}. See it with: ai-insights schedule status\n`);
  return 0;
}

async function commandOff(deps: ScheduleDeps): Promise<number> {
  const { ok, lines } = await removeSchedule(deps);
  deps.stdout(lines.length ? `${lines.join("\n")}\nThe schedule is off. Your report and cache were left as they are.\n` : "No schedule is installed.\n");
  return ok ? 0 : 1;
}

async function commandStatus(deps: ScheduleDeps): Promise<number> {
  const installed = await findInstalled(deps);
  if (!installed) {
    deps.stdout("No schedule is installed. Add one with: ai-insights schedule weekly\n");
    return 0;
  }
  const lines = [`Scheduled with ${installed.system === "launchd" ? "launchd (a LaunchAgent)" : "a systemd user timer"}:`];
  if (installed.spec) {
    lines.push(`  when      ${whenText(installed.spec)}${installed.spec.withCost ? ", with the cost in the notification" : ""}`);
    lines.push(`  next      ${dateText(nextRun(installed.spec, deps.now()))}`);
  }
  for (const [index, file] of installed.files.entries()) lines.push(`  ${index === 0 ? "files" : "     "}     ${tilde(file, deps.userHome)}`);
  lines.push(`  last run  ${installed.lastRun ? `${installed.lastRun.at.slice(0, 16).replace("T", " ")} UTC, ${installed.lastRun.ok ? "ok" : "failed"}` : "not yet"}`);
  lines.push("Remove it with: ai-insights schedule off");
  deps.stdout(`${lines.join("\n")}\n`);
  return 0;
}

// -- the job ---------------------------------------------------------------------------------------

/** The notification command for this system, or null where there is none to use. The text is passed as an argument, never into a script. */
export function notifyCommand(platform: NodeJS.Platform, text: string): { command: string; args: string[] } | null {
  if (platform === "darwin") return { command: "osascript", args: ["-e", "on run argv", "-e", 'display notification (item 1 of argv) with title "AI Insights"', "-e", "end run", text] };
  if (platform === "linux") return { command: "notify-send", args: ["--app-name=AI Insights", "AI Insights", text] };
  return null;
}

async function trimLog(home: string): Promise<void> {
  const path = join(home, LOG_FILE);
  try {
    if ((await stat(path)).size > MAX_LOG_BYTES) await truncate(path, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function commandRun(cadence: Cadence, args: ScheduleArgs, deps: ScheduleDeps): Promise<number> {
  const now = deps.now();
  await trimLog(deps.home).catch(() => undefined);
  let ok = true;
  try {
    if (!deps.refresh) throw new Error("no report pipeline");
    const counts = await deps.refresh(windowStart(cadence, now));
    try {
      await writeDigest(deps.home, { v: 1, generatedAt: now.toISOString(), days: WINDOW_DAYS[cadence], sessions: counts.sessions, activeMinutes: counts.activeMinutes, prompts: counts.prompts, costUsd: counts.costUsd, tipId: counts.tipId });
    } catch (error) {
      // Without it the reminder only lacks this run's counts; the notification still shows them.
      if (!(error instanceof Error)) throw error;
    }
    const text = notificationText(cadence, counts, args.withCost);
    const notify = notifyCommand(deps.platform, text);
    if (notify) {
      const shown = await (deps.spawner ?? spawnCommand)(notify.command, notify.args, { timeoutMs: NOTIFY_TIMEOUT_MS, env: deps.env });
      // No notifier (notify-send missing, no desktop session) still leaves a fresh report.
      if (!shown.ok) deps.stdout(`${now.toISOString()} notification not shown (${shown.error ?? `exit ${shown.code}`})\n`);
    }
    deps.stdout(`${now.toISOString()} ${text} Report: ${counts.htmlPath}\n`);
  } catch (error) {
    ok = false;
    deps.stderr(`${now.toISOString()} ai-insights schedule run: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  try {
    const state = (await readState(deps.home)) ?? {};
    await writeState(deps.home, { ...state, lastRun: { at: now.toISOString(), ok } });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
  }
  return ok ? 0 : 1;
}

// -- entry -----------------------------------------------------------------------------------------

export async function runSchedule(argv: string[], deps: ScheduleDeps): Promise<number> {
  let args: ScheduleArgs;
  try {
    args = parseScheduleArgs(argv);
  } catch (error) {
    if (!(error instanceof ScheduleUsageError)) throw error;
    deps.stderr(`ai-insights schedule: ${error.message}\nRun \`ai-insights schedule --help\` for usage.\n`);
    return 2;
  }
  if (args.help || args.verb === null) {
    deps.stdout(SCHEDULE_HELP);
    return args.help ? 0 : 2;
  }
  try {
    if (args.verb === "off") return await commandOff(deps);
    if (args.verb === "status") return await commandStatus(deps);
    if (args.verb === "run") {
      if (!args.runCadence) {
        deps.stderr("ai-insights schedule run: needs daily, weekly or monthly (this is the scheduled job's own command)\n");
        return 2;
      }
      return await commandRun(args.runCadence, args, deps);
    }
    return await commandAdd(args.verb, args, deps);
  } catch (error) {
    deps.stderr(`ai-insights schedule: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
