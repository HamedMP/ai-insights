import type { Finding, Session } from "../../schema/types.js";
import { normalizeCommand } from "./commands.js";
import { evidence, harnessesOf, label, MAX_EVIDENCE, MAX_FINDINGS_PER_KIND, plural, type Detector } from "./context.js";

/** Three identical failures in a row means the agent is retrying instead of diagnosing. */
const MIN_STREAK = 3;
/** One streak in a single session can be bad luck; a streak this long cannot. */
const LONE_STREAK = 5;
/** Failing in this many sessions means the command itself is wrong for the environment, not a one-off. */
const MIN_SESSIONS = 3;
/** Across sessions, only flag commands that fail most of the time; a test suite that sometimes fails is normal. */
const MIN_FAILURE_RATE = 0.5;
const HIGH_STREAK = 8;
const MEDIUM_STREAK = 5;

const FAILURES = new Set(["command_failed", "timeout"]);

interface CommandStats {
  display: string;
  runs: number;
  failures: number;
  bestStreak: number;
  bestStreakSession: Session | null;
  bestStreakAt: string | undefined;
  sessions: Map<Session, { failures: number; firstAt: string }>;
}

export const repeatedFailedCommand: Detector = ({ sessions }) => {
  const stats = new Map<string, CommandStats>();
  for (const session of sessions) {
    const streaks = new Map<string, number>();
    for (const call of session.toolCalls) {
      if (call.category !== "shell" || !call.command) continue;
      const key = normalizeCommand(call.command);
      if (!key) continue;
      let row = stats.get(key);
      if (!row) {
        row = { display: key, runs: 0, failures: 0, bestStreak: 0, bestStreakSession: null, bestStreakAt: undefined, sessions: new Map() };
        stats.set(key, row);
      }
      row.runs += 1;
      if (!call.error || !FAILURES.has(call.error)) {
        streaks.set(key, 0);
        continue;
      }
      row.failures += 1;
      const perSession = row.sessions.get(session) ?? { failures: 0, firstAt: call.timestamp };
      perSession.failures += 1;
      row.sessions.set(session, perSession);
      const streak = (streaks.get(key) ?? 0) + 1;
      streaks.set(key, streak);
      if (streak > row.bestStreak) {
        row.bestStreak = streak;
        row.bestStreakSession = session;
        row.bestStreakAt = call.timestamp;
      }
    }
  }

  const findings: Finding[] = [];
  for (const row of stats.values()) {
    const inARow = row.bestStreak >= MIN_STREAK && (row.sessions.size >= 2 || row.bestStreak >= LONE_STREAK);
    const acrossSessions = row.sessions.size >= MIN_SESSIONS && row.failures / row.runs >= MIN_FAILURE_RATE;
    if (!inARow && !acrossSessions) continue;
    const command = label(row.display);
    const ranked = [...row.sessions].sort((a, b) => b[1].failures - a[1].failures || a[1].firstAt.localeCompare(b[1].firstAt));
    const items = ranked.slice(0, MAX_EVIDENCE).map(([session, info]) =>
      session === row.bestStreakSession && row.bestStreak >= MIN_STREAK
        ? evidence(session, `\`${command}\` failed ${row.bestStreak} times in a row`, row.bestStreakAt)
        : evidence(session, `\`${command}\` failed ${plural(info.failures, "time")} in this session`, info.firstAt),
    );
    const severity =
      row.bestStreak >= HIGH_STREAK ? "high" : row.bestStreak >= MEDIUM_STREAK || row.sessions.size >= 2 * MIN_SESSIONS ? "medium" : "low";
    const parts = [`\`${command}\` failed ${plural(row.failures, "time")} out of ${plural(row.runs, "run")} across ${plural(row.sessions.size, "session")}.`];
    if (inARow) parts.push(`At worst it failed ${row.bestStreak} times in a row, which usually means the agent retried without changing anything.`);
    if (acrossSessions) parts.push("It fails in session after session, so the agent is probably missing a setup step or using the wrong command for this project.");
    findings.push({
      id: `repeated_failed_command:${command}`,
      kind: "repeated_failed_command",
      severity,
      title: `\`${command}\` keeps failing`,
      detail: parts.join(" "),
      harnesses: harnessesOf(row.sessions.keys()),
      metric: { value: row.failures, unit: "failures", label: "failed runs" },
      evidence: items,
      suggestion: {
        type: "instructions",
        title: "Tell the agent how this command should be run",
        action:
          "Find out why it fails (missing setup, wrong directory, wrong script name) and write the correct invocation into your instructions file so the agent stops guessing.",
        instructionText: `\`${command}\` has failed repeatedly in past sessions. Before running it, check the prerequisites it needs; if it fails, read the error and fix the cause instead of re-running it unchanged. If it fails twice, stop and tell me what the error says.`,
      },
    });
  }
  return findings
    .sort((a, b) => (b.metric?.value ?? 0) - (a.metric?.value ?? 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_FINDINGS_PER_KIND);
};
