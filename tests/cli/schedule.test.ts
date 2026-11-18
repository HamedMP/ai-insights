import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import type { Answer } from "../../src/cli/open.js";
import {
  cronLine,
  jobEnv,
  launchAgentPlist,
  nextRun,
  notificationText,
  onCalendar,
  parseTime,
  parseWeekday,
  refuseEntry,
  schtasksCommand,
  systemdService,
  systemdTimer,
  whenText,
  windowStart,
  type ScheduleSpec,
} from "../../src/cli/schedule.js";
import { notifyCommand, runSchedule, SCHEDULE_QUESTION, type ScheduleDeps } from "../../src/cli/schedule-command.js";
import { stableNode } from "../../src/cli/schedule-deps.js";
import type { SpawnResult, Spawner } from "../../src/cli/spawn.js";
import { readDigest } from "../../src/store/digest.js";
import { tempHome } from "../store/fixtures.js";

const NODE = "/usr/local/bin/node";
const ENTRY = "/usr/local/lib/node_modules/ai-insights/dist/cli/main.js";
const weekly: ScheduleSpec = { cadence: "weekly", hour: 9, minute: 0, weekday: 1, withCost: false };
const command = { node: NODE, entry: ENTRY, args: ["schedule", "run", "weekly"] };

describe("what the job is, on each system", () => {
  it("macOS: a LaunchAgent that starts this install's CLI at the chosen weekday and time, at low priority", () => {
    const plist = launchAgentPlist(weekly, command, { AI_INSIGHTS_HOME: "/Users/a/AI & me" }, "/Users/a/.ai-insights/schedule.log");
    expect(plist).toContain("<key>Label</key><string>app.ai-insights.schedule</string>");
    expect(plist).toContain(["  <array>", `    <string>${NODE}</string>`, `    <string>${ENTRY}</string>`, "    <string>schedule</string>", "    <string>run</string>", "    <string>weekly</string>", "  </array>"].join("\n"));
    expect(plist).toContain(["  <dict>", "    <key>Weekday</key><integer>1</integer>", "    <key>Hour</key><integer>9</integer>", "    <key>Minute</key><integer>0</integer>", "  </dict>"].join("\n"));
    // Values are escaped, so a folder name cannot break the XML.
    expect(plist).toContain("<key>AI_INSIGHTS_HOME</key><string>/Users/a/AI &amp; me</string>");
    expect(plist).toContain("<key>ProcessType</key><string>Background</string>");
    expect(plist).not.toMatch(/RunAtLoad|KeepAlive|npx/);
    expect(launchAgentPlist({ ...weekly, cadence: "monthly" }, command, {}, "/l")).toContain("<key>Day</key><integer>1</integer>");
    expect(launchAgentPlist({ ...weekly, cadence: "daily" }, command, {}, "/l")).not.toMatch(/Weekday|<key>Day</);
  });

  it("Linux: a oneshot user service and a persistent timer, with every argument quoted", () => {
    const service = systemdService({ ...command, entry: "/home/a/my apps/main.js" }, { AI_INSIGHTS_HOME: "/home/a/100% data" });
    expect(service).toContain('ExecStart="/usr/local/bin/node" "/home/a/my apps/main.js" "schedule" "run" "weekly"');
    expect(service).toContain('Environment="AI_INSIGHTS_HOME=/home/a/100%% data"');
    expect(service).toContain("Type=oneshot");
    const timer = systemdTimer(weekly);
    expect(timer).toContain("OnCalendar=Mon *-*-* 09:00:00");
    expect(timer).toContain("Persistent=true");
    expect(timer).toContain("Unit=ai-insights-schedule.service");
    expect(timer).toContain("WantedBy=timers.target");
  });

  it("names the calendar the same way for each cadence", () => {
    expect(onCalendar({ ...weekly, cadence: "daily", hour: 18, minute: 30 })).toBe("*-*-* 18:30:00");
    expect(onCalendar({ ...weekly, weekday: 0 })).toBe("Sun *-*-* 09:00:00");
    expect(onCalendar({ ...weekly, cadence: "monthly", hour: 7, minute: 5 })).toBe("*-*-01 07:05:00");
  });

  it("without user systemd: a crontab line for the person to add", () => {
    expect(cronLine(weekly, command)).toBe(`0 9 * * 1 ${NODE} ${ENTRY} schedule run weekly`);
    expect(cronLine({ ...weekly, cadence: "monthly", minute: 15 }, { ...command, entry: "/x y/main.js" })).toBe(`15 9 1 * * ${NODE} '/x y/main.js' schedule run weekly`);
  });

  it("Windows: a schtasks command to run by hand", () => {
    expect(schtasksCommand(weekly, { node: "C:\\node\\node.exe", entry: "C:\\npm\\ai-insights\\dist\\cli\\main.js", args: ["schedule", "run", "weekly"] })).toBe(
      'schtasks /Create /TN "AI Insights schedule" /TR "\\"C:\\node\\node.exe\\" \\"C:\\npm\\ai-insights\\dist\\cli\\main.js\\" \\"schedule\\" \\"run\\" \\"weekly\\"" /SC WEEKLY /D MON /ST 09:00 /F',
    );
  });

  it("passes on only the settings that decide which history and store the job reads", () => {
    expect(jobEnv({ AI_INSIGHTS_HOME: "/s", CLAUDE_CONFIG_DIR: "/c", PATH: "/bin", ANTHROPIC_API_KEY: "sk-secret", CODEX_HOME: "bad\nline" })).toEqual({ AI_INSIGHTS_HOME: "/s", CLAUDE_CONFIG_DIR: "/c" });
  });
});

describe("when it runs", () => {
  // Local-time dates, so the tests hold in any time zone.
  const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

  it("weekly: the next chosen weekday at the chosen time, today if it is still ahead", () => {
    expect(nextRun(weekly, at(2026, 11, 18, 12))).toEqual(at(2026, 11, 23, 9)); // Wed -> Mon
    expect(nextRun(weekly, at(2026, 11, 23, 8, 59))).toEqual(at(2026, 11, 23, 9));
    expect(nextRun(weekly, at(2026, 11, 23, 9, 0))).toEqual(at(2026, 11, 30, 9));
    expect(nextRun({ ...weekly, weekday: 0 }, at(2026, 12, 31, 23))).toEqual(at(2027, 1, 3, 9));
  });

  it("daily: later today, else tomorrow, across the month end", () => {
    const daily = { ...weekly, cadence: "daily" as const, hour: 18, minute: 30 };
    expect(nextRun(daily, at(2026, 11, 18, 18, 29))).toEqual(at(2026, 11, 18, 18, 30));
    expect(nextRun(daily, at(2026, 11, 30, 19))).toEqual(at(2026, 12, 1, 18, 30));
  });

  it("monthly: the 1st, rolling into the next year", () => {
    const monthly = { ...weekly, cadence: "monthly" as const };
    expect(nextRun(monthly, at(2026, 1, 31, 10))).toEqual(at(2026, 2, 1, 9));
    expect(nextRun(monthly, at(2026, 12, 1, 8))).toEqual(at(2026, 12, 1, 9));
    expect(nextRun(monthly, at(2026, 12, 15))).toEqual(at(2027, 1, 1, 9));
  });

  it("reads --at and --day strictly", () => {
    expect(parseTime("9:05")).toEqual({ hour: 9, minute: 5 });
    for (const bad of ["24:00", "9", "09:60", "9am", "-1:00"]) expect(parseTime(bad), bad).toBeNull();
    expect(parseWeekday("Friday")).toBe(5);
    expect(parseWeekday("sun")).toBe(0);
    expect(parseWeekday("x")).toBeNull();
    expect(whenText({ ...weekly, weekday: 5, hour: 17, minute: 45 })).toBe("every Friday at 17:45");
  });

  it("counts a rolling window ending now", () => {
    const now = new Date("2026-11-18T09:00:00Z");
    expect(windowStart("weekly", now).toISOString()).toBe("2026-11-11T09:00:00.000Z");
    expect(windowStart("daily", now).toISOString()).toBe("2026-11-17T09:00:00.000Z");
  });
});

describe("the notification", () => {
  it("holds counts only, and the cost only when asked", () => {
    expect(notificationText("weekly", { sessions: 41, activeMinutes: 366, costUsd: 123.4 }, false)).toBe("Your weekly AI Insights are ready: 41 sessions, 6.1 h.");
    expect(notificationText("weekly", { sessions: 41, activeMinutes: 366, costUsd: 123.4 }, true)).toBe("Your weekly AI Insights are ready: 41 sessions, 6.1 h, about $123.");
    expect(notificationText("daily", { sessions: 1, activeMinutes: 20, costUsd: null }, true)).toBe("Your daily AI Insights are ready: 1 session, 0.3 h.");
    expect(notificationText("daily", { sessions: 1, activeMinutes: 50, costUsd: 0.01 }, true)).toBe("Your daily AI Insights are ready: 1 session, 0.8 h, under $1.");
    expect(notificationText("monthly", { sessions: 0, activeMinutes: 0, costUsd: 0 }, false)).toBe("Your monthly AI Insights are ready: no sessions in the last 30 days.");
  });

  it("hands the text to the notifier as an argument, never inside a script", () => {
    const text = 'a" & do shell script "rm -rf ~';
    const mac = notifyCommand("darwin", text)!;
    expect(mac.command).toBe("osascript");
    expect(mac.args.at(-1)).toBe(text);
    expect(mac.args.slice(0, -1).join(" ")).not.toContain(text);
    expect(notifyCommand("linux", text)).toEqual({ command: "notify-send", args: ["--app-name=AI Insights", "AI Insights", text] });
    expect(notifyCommand("win32", text)).toBeNull();
  });
});

describe("which install it schedules", () => {
  it("refuses an npx, pnpm dlx or bunx cache, and source files, and points to a global install", () => {
    for (const path of [
      "/home/a/.npm/_npx/1a2b3c/node_modules/ai-insights/dist/cli/main.js",
      "C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\9f\\node_modules\\ai-insights\\dist\\cli\\main.js",
      "/home/a/.cache/pnpm/dlx/abc/node_modules/ai-insights/dist/cli/main.js",
      "/tmp/bunx-1000-ai-insights@latest/node_modules/ai-insights/dist/cli/main.js",
    ]) expect(refuseEntry(path), path).toContain("npm i -g ai-insights");
    expect(refuseEntry("/repo/src/cli/main.ts")).toContain("not a built install");
    expect(refuseEntry(ENTRY)).toBeNull();
    expect(refuseEntry("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\ai-insights\\dist\\cli\\main.js")).toBeNull();
  });

  it("prefers a node on PATH that is the same binary, so an upgrade that moves the real file does not break the job", async () => {
    const { home, cleanup } = await tempHome();
    try {
      await mkdir(join(home, "cellar", "24.1", "bin"), { recursive: true });
      await mkdir(join(home, "bin"));
      const real = join(home, "cellar", "24.1", "bin", "node");
      await writeFile(real, "");
      await symlink(real, join(home, "bin", "node"));
      expect(stableNode(real, `/nowhere:${join(home, "bin")}`, "node")).toBe(join(home, "bin", "node"));
      expect(stableNode(real, "/nowhere", "node")).toBe(real);
    } finally {
      await cleanup();
    }
  });
});

// -- installing, with a recording spawner and temporary folders --------------------------------------------------

let user: string;
let cleanup: () => Promise<void>;
let out: string;
let err: string;
let calls: string[];
let answers: Answer[];

const ok = (overrides: Partial<SpawnResult> = {}): SpawnResult => ({ ok: true, code: 0, timedOut: false, stdout: "", stderr: "", ...overrides });
function spawner(fail: Record<string, Partial<SpawnResult>> = {}): Spawner {
  return async (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    const key = Object.keys(fail).find((k) => line.startsWith(k));
    return key ? ok({ ok: false, code: 1, ...fail[key] }) : ok();
  };
}

function deps(overrides: Partial<ScheduleDeps> = {}): ScheduleDeps {
  return {
    stdout: (t) => void (out += t),
    stderr: (t) => void (err += t),
    env: {},
    platform: "linux",
    now: () => new Date(2026, 10, 18, 12, 0),
    stdoutTTY: true,
    stdinTTY: true,
    prompt: async () => answers.shift() ?? "no",
    spawner: spawner(),
    userHome: user,
    home: join(user, ".ai-insights"),
    node: NODE,
    entry: ENTRY,
    uid: 501,
    refresh: async () => ({ sessions: 41, activeMinutes: 366, costUsd: 12, prompts: 90, tipId: null, htmlPath: join(user, ".ai-insights", "reports", "report.html") }),
    ...overrides,
  };
}
const unitDir = () => join(user, ".config", "systemd", "user");
const present = async (path: string) => stat(path).then(() => true, () => false);

beforeEach(async () => {
  ({ home: user, cleanup } = await tempHome());
  out = "";
  err = "";
  calls = [];
  answers = [];
});
afterEach(async () => cleanup());

describe("ai-insights schedule weekly (Linux, systemd user session)", () => {
  it("says exactly what it adds, when it runs and what the notification says, then asks", async () => {
    answers = ["no"];
    expect(await runSchedule(["weekly"], deps())).toBe(0);
    expect(out).toBe(
      [
        "This adds a scheduled job to this computer that keeps running after a restart:",
        "  when   every Monday at 09:00 (next: Mon 23 Nov 2026, 09:00)",
        `  runs   ${NODE} ${ENTRY} schedule run weekly`,
        "  adds   ~/.config/systemd/user/ai-insights-schedule.service",
        "         ~/.config/systemd/user/ai-insights-schedule.timer",
        "  then   systemctl --user daemon-reload",
        "         systemctl --user enable --now ai-insights-schedule.timer",
        "Each time it reads your agent history on this computer, rewrites the report and shows a",
        'notification with counts only, like "Your weekly AI Insights are ready: 41 sessions, 6.1 h."',
        "It sends nothing anywhere.",
        "Remove it any time with: ai-insights schedule off (ai-insights uninstall removes it too)",
        `${SCHEDULE_QUESTION} no`,
        "Nothing was added.",
        "",
      ].join("\n"),
    );
  });

  it("on no: writes nothing and starts nothing", async () => {
    answers = ["no"];
    await runSchedule(["weekly"], deps());
    expect(await present(unitDir())).toBe(false);
    expect(calls).toEqual(["systemctl --user show-environment"]);
  });

  it("on Ctrl-C: writes nothing and exits 130", async () => {
    answers = ["cancel"];
    expect(await runSchedule(["daily"], deps())).toBe(130);
    expect(await present(unitDir())).toBe(false);
  });

  it("on yes: writes the two units, enables the timer, and status lists them", async () => {
    answers = ["yes"];
    expect(await runSchedule(["weekly", "--at", "18:30", "--day", "fri"], deps())).toBe(0);
    expect(await readFile(join(unitDir(), "ai-insights-schedule.timer"), "utf8")).toContain("OnCalendar=Fri *-*-* 18:30:00");
    expect(await readFile(join(unitDir(), "ai-insights-schedule.service"), "utf8")).toContain(`ExecStart="${NODE}" "${ENTRY}" "schedule" "run" "weekly"`);
    expect(calls).toEqual(["systemctl --user show-environment", "systemctl --user daemon-reload", "systemctl --user enable --now ai-insights-schedule.timer"]);
    expect(out).toContain("Added. Next run: Fri 20 Nov 2026, 18:30.");
    out = "";
    expect(await runSchedule(["status"], deps())).toBe(0);
    expect(out).toContain("when      every Friday at 18:30");
    expect(out).toContain("next      Fri 20 Nov 2026, 18:30");
    expect(out).toContain("~/.config/systemd/user/ai-insights-schedule.service");
    expect(out).toContain("last run  not yet");
  });

  it("--yes skips the question but never the terminal: piped, nothing is added even with --yes", async () => {
    expect(await runSchedule(["weekly", "--yes"], deps())).toBe(0);
    expect(await present(join(unitDir(), "ai-insights-schedule.timer"))).toBe(true);
    await runSchedule(["off"], deps());
    out = "";
    expect(await runSchedule(["weekly", "--yes"], deps({ stdoutTTY: false }))).toBe(1);
    expect(out).toContain("Nothing was added: a schedule is added only at a terminal");
    expect(await present(join(unitDir(), "ai-insights-schedule.timer"))).toBe(false);
  });

  it("never in CI", async () => {
    expect(await runSchedule(["weekly", "--yes"], deps({ env: { CI: "true" } }))).toBe(1);
    expect(err).toContain("not in CI");
    expect(calls).toEqual([]);
  });

  it("refuses an npx run with the global install hint", async () => {
    expect(await runSchedule(["weekly"], deps({ entry: "/home/a/.npm/_npx/1a/node_modules/ai-insights/dist/cli/main.js" }))).toBe(1);
    expect(err).toContain("npm i -g ai-insights");
    expect(calls).toEqual([]);
  });

  it("--dry-run shows the same and changes nothing", async () => {
    expect(await runSchedule(["daily", "--dry-run"], deps())).toBe(0);
    expect(out).toContain("Dry run: nothing was changed.");
    expect(await present(unitDir())).toBe(false);
  });

  it("when enabling fails, removes what it wrote and says why", async () => {
    answers = ["yes"];
    expect(await runSchedule(["weekly"], deps({ spawner: spawner({ "systemctl --user enable": { stderr: "Failed to connect to bus" } }) }))).toBe(1);
    expect(err).toContain("systemctl --user enable --now ai-insights-schedule.timer exited with 1: Failed to connect to bus. Nothing was added.");
    expect(await present(join(unitDir(), "ai-insights-schedule.timer"))).toBe(false);
    expect(await present(join(unitDir(), "ai-insights-schedule.service"))).toBe(false);
  });

  it("schedule off removes everything it added and stops the timer", async () => {
    answers = ["yes"];
    await runSchedule(["weekly"], deps());
    calls = [];
    out = "";
    expect(await runSchedule(["off"], deps())).toBe(0);
    expect(calls).toEqual(["systemctl --user disable --now ai-insights-schedule.timer", "systemctl --user daemon-reload"]);
    expect(await present(join(unitDir(), "ai-insights-schedule.timer"))).toBe(false);
    expect(await present(join(unitDir(), "ai-insights-schedule.service"))).toBe(false);
    expect(await present(join(user, ".ai-insights", "schedule.json"))).toBe(false);
    expect(out).toContain("The schedule is off.");
    out = "";
    expect(await runSchedule(["off"], deps())).toBe(0);
    expect(out).toBe("No schedule is installed.\n");
  });

  it("asking again replaces the schedule and says what it replaces", async () => {
    answers = ["yes", "yes"];
    await runSchedule(["weekly"], deps());
    out = "";
    await runSchedule(["daily", "--at", "07:00"], deps());
    expect(out).toContain("It replaces the current schedule (every Monday at 09:00).");
    expect(await readFile(join(unitDir(), "ai-insights-schedule.timer"), "utf8")).toContain("OnCalendar=*-*-* 07:00:00");
  });

  it("puts units under XDG_CONFIG_HOME when it is set", async () => {
    const config = join(user, "cfg");
    expect(await runSchedule(["monthly", "--yes"], deps({ env: { XDG_CONFIG_HOME: config } }))).toBe(0);
    expect(await present(join(config, "systemd", "user", "ai-insights-schedule.timer"))).toBe(true);
  });
});

describe("other systems", () => {
  it("macOS: writes the LaunchAgent and loads it into the person's own GUI session", async () => {
    answers = ["yes"];
    expect(await runSchedule(["weekly"], deps({ platform: "darwin" }))).toBe(0);
    const plist = join(user, "Library", "LaunchAgents", "app.ai-insights.schedule.plist");
    expect(await readFile(plist, "utf8")).toContain("<string>schedule</string>");
    expect(calls).toEqual(["launchctl bootout gui/501/app.ai-insights.schedule", `launchctl bootstrap gui/501 ${plist}`]);
    calls = [];
    expect(await runSchedule(["off"], deps({ platform: "darwin" }))).toBe(0);
    expect(calls).toEqual(["launchctl bootout gui/501/app.ai-insights.schedule"]);
    expect(await present(plist)).toBe(false);
  });

  it("Linux without a systemd user session: prints a crontab line and adds nothing", async () => {
    expect(await runSchedule(["weekly"], deps({ spawner: spawner({ "systemctl --user show-environment": {} }) }))).toBe(0);
    expect(out).toContain(`0 9 * * 1 ${NODE} ${ENTRY} schedule run weekly`);
    expect(out).toContain("crontab -e");
    expect(await present(unitDir())).toBe(false);
  });

  it("Windows: prints the schtasks command, says it is untested, and runs nothing", async () => {
    expect(await runSchedule(["weekly"], deps({ platform: "win32" }))).toBe(0);
    expect(out).toContain("untested");
    expect(out).toContain('schtasks /Create /TN "AI Insights schedule"');
    expect(calls).toEqual([]);
  });

  it("rejects options that make no sense", async () => {
    for (const argv of [["daily", "--day", "mon"], ["weekly", "--at", "25:00"], ["hourly"], ["weekly", "--day"]]) {
      err = "";
      expect(await runSchedule(argv, deps()), argv.join(" ")).toBe(2);
      expect(err).toContain("ai-insights schedule:");
    }
  });
});

describe("the job (schedule run)", () => {
  it("refreshes the report, shows the counts-only notification and remembers the run", async () => {
    expect(await runSchedule(["run", "weekly"], deps())).toBe(0);
    expect(calls).toEqual(["notify-send --app-name=AI Insights AI Insights Your weekly AI Insights are ready: 41 sessions, 6.1 h."]);
    const state = JSON.parse(await readFile(join(user, ".ai-insights", "schedule.json"), "utf8"));
    expect(state.lastRun.ok).toBe(true);
    // The same counts, for the session-start reminder: counts and a tip id, nothing else.
    expect(await readDigest(join(user, ".ai-insights"))).toEqual({ v: 1, generatedAt: new Date(2026, 10, 18, 12).toISOString(), days: 7, sessions: 41, activeMinutes: 366, prompts: 90, costUsd: 12, tipId: null });
  });

  it("reads back only a well-formed digest", async () => {
    const home = join(user, "store");
    await mkdir(home);
    expect(await readDigest(home)).toBeNull();
    await writeFile(join(home, "digest.json"), JSON.stringify({ v: 1, generatedAt: "2026-11-18T10:00:00Z", days: 7, sessions: 3, activeMinutes: 10, prompts: 4, costUsd: null, tipId: "rm -rf /", project: "secret-app" }));
    expect(await readDigest(home)).toEqual({ v: 1, generatedAt: "2026-11-18T10:00:00.000Z", days: 7, sessions: 3, activeMinutes: 10, prompts: 4, costUsd: null, tipId: null });
    await writeFile(join(home, "digest.json"), "{not json");
    expect(await readDigest(home)).toBeNull();
  });

  it("adds the cost only with --with-cost", async () => {
    await runSchedule(["run", "weekly", "--with-cost"], deps());
    expect(calls.at(-1)).toContain("41 sessions, 6.1 h, about $12.");
  });

  it("without a notifier still refreshes the report and succeeds", async () => {
    expect(await runSchedule(["run", "daily"], deps({ spawner: spawner({ "notify-send": { error: "spawn notify-send ENOENT", code: null } }) }))).toBe(0);
    expect(out).toContain("notification not shown");
  });

  it("reports a failed refresh and exits 1, never throwing", async () => {
    expect(await runSchedule(["run", "weekly"], deps({ refresh: async () => { throw new Error("disk full"); } }))).toBe(1);
    expect(err).toContain("disk full");
    expect(calls).toEqual([]);
    expect(JSON.parse(await readFile(join(user, ".ai-insights", "schedule.json"), "utf8")).lastRun.ok).toBe(false);
  });
});

describe("through the CLI", () => {
  it("ai-insights uninstall also removes the schedule", async () => {
    const base = { stdout: (t: string) => void (out += t), stderr: (t: string) => void (err += t), env: { AI_INSIGHTS_HOME: join(user, ".ai-insights") }, platform: "linux" as const, userHome: user, terminal: { isTTY: true, stdin: true }, prompt: async () => "yes" as const, spawner: spawner(), program: { node: NODE, entry: ENTRY }, now: () => new Date(2026, 10, 18, 12), detectAgents: async () => [] };
    expect(await run(["schedule", "weekly"], base)).toBe(0);
    expect(await present(join(unitDir(), "ai-insights-schedule.timer"))).toBe(true);
    out = "";
    expect(await run(["uninstall"], base)).toBe(0);
    expect(out).toContain("remove ~/.config/systemd/user/ai-insights-schedule.timer");
    expect(await present(join(unitDir(), "ai-insights-schedule.timer"))).toBe(false);
    expect(await present(join(unitDir(), "ai-insights-schedule.service"))).toBe(false);
  });
});
