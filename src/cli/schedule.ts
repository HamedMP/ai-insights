import { join } from "node:path";

/**
 * `ai-insights schedule`: the pure half. What a scheduled job looks like on each system (a launchd LaunchAgent on
 * macOS, a systemd user timer on Linux, a crontab line where there is no user systemd, a schtasks command on
 * Windows), when it next runs, which program it starts, and the notification it shows. No file or process I/O here,
 * so every definition can be tested exactly; schedule-command.ts does the installing.
 */

export type Cadence = "daily" | "weekly" | "monthly";
export const CADENCES: readonly Cadence[] = ["daily", "weekly", "monthly"];
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ScheduleSpec {
  cadence: Cadence;
  hour: number;
  minute: number;
  /** 0 = Sunday. Only for weekly; daily ignores it, monthly runs on the 1st. */
  weekday: number;
  /** Put the estimated cost in the notification. Off by default: a notification can show on a lock screen. */
  withCost: boolean;
}

export const LABEL = "app.ai-insights.schedule";
export const UNIT = "ai-insights-schedule";
export const WINDOWS_TASK = "AI Insights schedule";

/** "HH:MM", 24-hour. */
export function parseTime(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function parseWeekday(text: string): number | null {
  const index = WEEKDAYS.indexOf(text.trim().toLowerCase().slice(0, 3) as Weekday);
  return index >= 0 && /^[a-z]+$/i.test(text.trim()) ? index : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** In words, for the confirmation and `status`: "every Monday at 09:00". */
export function whenText(spec: ScheduleSpec): string {
  const at = `${pad(spec.hour)}:${pad(spec.minute)}`;
  if (spec.cadence === "daily") return `every day at ${at}`;
  if (spec.cadence === "weekly") return `every ${DAY_NAMES[spec.weekday]} at ${at}`;
  return `on the 1st of every month at ${at}`;
}

/**
 * The next time the job runs after `now`, in this machine's local time (launchd, systemd and cron all use it).
 * A run exactly at `now` counts as the next one only if it is still ahead by a minute or more.
 */
export function nextRun(spec: ScheduleSpec, now: Date): Date {
  const at = (y: number, m: number, d: number) => new Date(y, m, d, spec.hour, spec.minute, 0, 0);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (spec.cadence === "monthly") {
    const thisMonth = at(y, m, 1);
    return thisMonth > now ? thisMonth : at(y, m + 1, 1);
  }
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const candidate = at(y, m, d + ahead);
    if (candidate <= now) continue;
    if (spec.cadence === "daily" || candidate.getDay() === spec.weekday) return candidate;
  }
  return at(y, m, d + 7);
}

export function dateText(date: Date): string {
  return `${DAY_NAMES[date.getDay()]!.slice(0, 3)} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// -- what the job runs -----------------------------------------------------------------

/** The program the job starts: this Node and this install's CLI file, both absolute, plus fixed arguments. */
export interface JobCommand {
  node: string;
  entry: string;
  args: string[];
}

export function jobArgs(spec: ScheduleSpec): string[] {
  return ["schedule", "run", spec.cadence, ...(spec.withCost ? ["--with-cost"] : [])];
}

/** Why this install cannot be scheduled, or null when it can. A job must never start `npx`, which contacts the registry. */
export function refuseEntry(entry: string): string | null {
  const path = entry.replace(/\\/g, "/");
  if (/\/_npx\//.test(path) || /\/dlx[-/]/.test(path) || /\/bunx-/.test(path) || /\/\.yarn\/berry\/cache\//.test(path) || /\/xfs-[0-9a-f]+\//.test(path)) {
    return "This is running from a temporary npx cache, which can be deleted, and starting it again would contact the npm registry. Install AI Insights first: npm i -g ai-insights, then run: ai-insights schedule …";
  }
  if (!/\.(c|m)?js$/.test(path) || /\/src\//.test(path)) return "This is not a built install of AI Insights. Install it with npm i -g ai-insights, then run: ai-insights schedule …";
  return null;
}

/** Arguments as one line of shell, for showing the person and for crontab. */
export function shellLine(words: string[]): string {
  return words.map((word) => (/^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`)).join(" ");
}

// -- macOS: a LaunchAgent ------------------------------------------------------------------

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchAgentPath(userHome: string): string {
  return join(userHome, "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function launchAgentPlist(spec: ScheduleSpec, command: JobCommand, env: Record<string, string>, logPath: string): string {
  const interval = [
    ...(spec.cadence === "weekly" ? [["Weekday", spec.weekday]] : []),
    ...(spec.cadence === "monthly" ? [["Day", 1]] : []),
    ["Hour", spec.hour],
    ["Minute", spec.minute],
  ] as Array<[string, number]>;
  const args = [command.node, command.entry, ...command.args];
  const envKeys = Object.keys(env).sort();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    `  <key>Label</key><string>${LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...args.map((arg) => `    <string>${xml(arg)}</string>`),
    "  </array>",
    "  <key>StartCalendarInterval</key>",
    "  <dict>",
    ...interval.map(([key, value]) => `    <key>${key}</key><integer>${value}</integer>`),
    "  </dict>",
    ...(envKeys.length
      ? ["  <key>EnvironmentVariables</key>", "  <dict>", ...envKeys.map((key) => `    <key>${xml(key)}</key><string>${xml(env[key]!)}</string>`), "  </dict>"]
      : []),
    `  <key>StandardOutPath</key><string>${xml(logPath)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(logPath)}</string>`,
    "  <key>ProcessType</key><string>Background</string>",
    "  <key>LowPriorityIO</key><true/>",
    "  <key>Nice</key><integer>10</integer>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

// -- Linux: a systemd user timer -----------------------------------------------------------

export function systemdDir(userHome: string, env: NodeJS.ProcessEnv): string {
  const config = env.XDG_CONFIG_HOME?.trim();
  return join(config && config.startsWith("/") ? config : join(userHome, ".config"), "systemd", "user");
}

const WEEKDAY_SYSTEMD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function onCalendar(spec: ScheduleSpec): string {
  const time = `${pad(spec.hour)}:${pad(spec.minute)}:00`;
  if (spec.cadence === "daily") return `*-*-* ${time}`;
  if (spec.cadence === "weekly") return `${WEEKDAY_SYSTEMD[spec.weekday]} *-*-* ${time}`;
  return `*-*-01 ${time}`;
}

/** systemd unescapes `%` specifiers and splits on spaces; quote each argument and double every `%`. */
function execLine(words: string[]): string {
  return words.map((word) => `"${word.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")}"`).join(" ");
}

export function systemdService(command: JobCommand, env: Record<string, string>): string {
  return [
    "[Unit]",
    "Description=AI Insights: refresh the report and show a notification (ai-insights schedule)",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${execLine([command.node, command.entry, ...command.args])}`,
    ...Object.keys(env)
      .sort()
      .map((key) => `Environment=${execLine([`${key}=${env[key]}`])}`),
    "Nice=10",
    "IOSchedulingClass=idle",
    "TimeoutStartSec=15min",
    "",
  ].join("\n");
}

export function systemdTimer(spec: ScheduleSpec): string {
  return [
    "[Unit]",
    `Description=AI Insights, ${whenText(spec)} (ai-insights schedule)`,
    "",
    "[Timer]",
    `OnCalendar=${onCalendar(spec)}`,
    // A run missed while the machine was off happens at the next boot.
    "Persistent=true",
    `Unit=${UNIT}.service`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/** The line to add with `crontab -e` where there is no user systemd. AI Insights never edits a crontab itself. */
export function cronLine(spec: ScheduleSpec, command: JobCommand): string {
  const day = spec.cadence === "monthly" ? "1" : "*";
  const weekday = spec.cadence === "weekly" ? String(spec.weekday) : "*";
  return `${spec.minute} ${spec.hour} ${day} * ${weekday} ${shellLine([command.node, command.entry, ...command.args])}`;
}

// -- Windows: printed, not run (untested there) --------------------------------------------

const SCHTASKS_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** The schtasks command for the person to run themselves. */
export function schtasksCommand(spec: ScheduleSpec, command: JobCommand): string {
  const run = [command.node, command.entry, ...command.args].map((word) => `\\"${word}\\"`).join(" ");
  const when = spec.cadence === "daily" ? "/SC DAILY" : spec.cadence === "weekly" ? `/SC WEEKLY /D ${SCHTASKS_DAY[spec.weekday]}` : "/SC MONTHLY /D 1";
  return `schtasks /Create /TN "${WINDOWS_TASK}" /TR "${run}" ${when} /ST ${pad(spec.hour)}:${pad(spec.minute)} /F`;
}

/** Settings the job needs to read the same history and store as the person's shell; only these, only when set. */
export const PASSED_ENV = ["AI_INSIGHTS_HOME", "HINDSIGHT_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "GEMINI_CLI_HOME", "OPENCODE_DB", "PI_CODING_AGENT_DIR", "PI_CODING_AGENT_SESSION_DIR", "XDG_DATA_HOME", "TZ"] as const;

export function jobEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PASSED_ENV) {
    const value = env[key]?.trim();
    // A value with a newline or NUL cannot be written safely into a unit or plist, and no real path has one.
    if (value && !/[\r\n\0]/.test(value)) out[key] = value;
  }
  return out;
}

// -- the notification ----------------------------------------------------------------------

export interface NotificationCounts {
  sessions: number;
  activeMinutes: number;
  /** Null when it was not measured or could not be priced. */
  costUsd: number | null;
}

const PERIOD_WORD: Record<Cadence, string> = { daily: "in the last 24 hours", weekly: "in the last 7 days", monthly: "in the last 30 days" };

/**
 * Counts only: a notification can show on a lock screen. No project names, prompts or paths ever; the cost only
 * with --with-cost.
 */
export function notificationText(cadence: Cadence, counts: NotificationCounts, withCost: boolean): string {
  const head = `Your ${cadence} AI Insights are ready`;
  if (counts.sessions <= 0) return `${head}: no sessions ${PERIOD_WORD[cadence]}.`;
  const sessions = `${counts.sessions.toLocaleString("en-US")} ${counts.sessions === 1 ? "session" : "sessions"}`;
  const hours = `${(Math.round((counts.activeMinutes / 60) * 10) / 10).toLocaleString("en-US")} h`;
  const usd = counts.costUsd;
  const cost = !withCost || typeof usd !== "number" || usd <= 0 ? "" : usd < 1 ? ", under $1" : `, about $${Math.round(usd).toLocaleString("en-US")}`;
  return `${head}: ${sessions}, ${hours}${cost}.`;
}

/** The rolling window each cadence reports on, ending now. */
export const WINDOW_DAYS: Record<Cadence, number> = { daily: 1, weekly: 7, monthly: 30 };

export function windowStart(cadence: Cadence, now: Date): Date {
  return new Date(now.getTime() - WINDOW_DAYS[cadence] * 86_400_000);
}
