import type { Session } from "../../schema/types.js";
import { isCheckCommand, isTestOrTypecheck, normalizeCommand } from "./commands.js";
import { evidence, harnessesOf, MAX_EVIDENCE, percent, plural, type Detector } from "./context.js";

/** Enough change that an untested commit could plausibly break something. */
const MIN_CHANGED_LINES = 50;
const MIN_EDIT_CALLS = 3;
/** A few unverified commits is a habit; one is a quick fix. */
const MIN_SESSIONS = 3;
/** Only a habit when it is a meaningful share of the sessions that ship code. */
const MIN_SHARE = 0.25;
/** Medium once it happens often and in most sessions that ship code. */
const MEDIUM_SESSIONS = 5;
const MEDIUM_SHARE = 0.5;

/** Files where a test run would not tell you anything. */
const NON_CODE = /\.(?:md|mdx|txt|rst|json|jsonc|ya?ml|toml|lock|csv|svg|png|jpe?g|gif|ini|env|example)$/i;

function changesCode(session: Session): boolean {
  if (session.filesModified.length === 0) return true;
  return session.filesModified.some((file) => !NON_CODE.test(file));
}

function editCalls(session: Session): number {
  return session.toolCalls.filter((call) => call.category === "edit").length;
}

function ranChecks(session: Session): boolean {
  return session.toolCalls.some((call) => call.category === "shell" && call.command && isCheckCommand(call.command));
}

/** The check command this person already uses in a project, so the instruction names a real command. */
function knownCheck(sessions: Session[], projectPath: string | null): string | null {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (projectPath && session.projectPath !== projectPath) continue;
    for (const call of session.toolCalls) {
      if (call.category !== "shell" || !call.command || call.error) continue;
      const command = normalizeCommand(call.command);
      if (command.length <= 60 && isTestOrTypecheck(command)) counts.set(command, (counts.get(command) ?? 0) + 1);
    }
  }
  const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : null;
}

export const noTestsBeforeDone: Detector = ({ sessions }) => {
  const shipping = sessions.filter(
    (session) =>
      session.gitCommits > 0 &&
      session.linesAdded + session.linesRemoved >= MIN_CHANGED_LINES &&
      editCalls(session) >= MIN_EDIT_CALLS &&
      changesCode(session),
  );
  const unchecked = shipping.filter((session) => !ranChecks(session));
  if (unchecked.length < MIN_SESSIONS) return [];
  const share = unchecked.length / shipping.length;
  if (share < MIN_SHARE) return [];
  const projects = new Map<string | null, number>();
  for (const session of unchecked) projects.set(session.projectPath, (projects.get(session.projectPath) ?? 0) + 1);
  const topProject = [...projects].sort((a, b) => b[1] - a[1])[0]![0];
  const check = knownCheck(sessions, topProject) ?? knownCheck(sessions, null);
  const items = [...unchecked]
    .sort((a, b) => b.linesAdded + b.linesRemoved - (a.linesAdded + a.linesRemoved) || a.startTime.localeCompare(b.startTime))
    .slice(0, MAX_EVIDENCE)
    .map((session) =>
      evidence(session, `${plural(session.gitCommits, "commit")} after +${session.linesAdded}/-${session.linesRemoved} lines with no test, typecheck or build run`),
    );
  const checkText = check ? `\`${check}\`` : "the project's tests and type checker";
  return [
    {
      id: "no_tests_before_done",
      kind: "no_tests_before_done",
      severity: unchecked.length >= MEDIUM_SESSIONS && share >= MEDIUM_SHARE ? "medium" : "low",
      title: "Code gets committed without a test run",
      detail: `In ${plural(unchecked.length, "session")} (${percent(share)} of sessions that committed real code changes) the agent committed without running any test, typecheck, lint or build command first.`,
      harnesses: harnessesOf(unchecked),
      metric: { value: unchecked.length, unit: "sessions", label: "commits without a check" },
      evidence: items,
      suggestion: {
        type: "instructions",
        title: "Make checks part of done",
        action: "Add a rule that work is not finished until the checks pass; a pre-commit or stop hook can enforce it.",
        instructionText: `Before you commit or say a task is done, run ${checkText} and fix anything that fails. Do not commit with failing checks.`,
      },
    },
  ];
};
