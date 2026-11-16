import type { Finding, Session, Suggestion, ToolErrorCategory } from "../../schema/types.js";
import { evidence, harnessesOf, MAX_EVIDENCE, MAX_FINDINGS_PER_KIND, percent, plural, round, type Detector } from "./context.js";

/** Enough failures of one tool that fixing the cause would be noticed. */
const MIN_ERRORS = 8;
/** Enough calls that the rate is not a fluke. */
const MIN_CALLS = 20;
/** One call in five failing is well above what file and search tools normally see. */
const MIN_ERROR_RATE = 0.2;
/** Seen in more than one session, so it is a pattern and not one broken environment. */
const MIN_SESSIONS = 2;
/** Above a third of calls failing, the tool costs more turns than it saves. */
const MEDIUM_ERROR_RATE = 0.35;

/** Permission refusals have their own finding. */
const EXCLUDED = new Set<ToolErrorCategory>(["permission_denied", "user_rejected"]);

const ADVICE: Partial<Record<ToolErrorCategory, Suggestion>> = {
  edit_mismatch: {
    type: "instructions",
    title: "Re-read before editing",
    action: "Edits fail when the agent's copy of a file is stale. Ask it to re-read the exact region before every edit.",
    instructionText: "Before editing a file, re-read the lines you are about to change; do not edit from memory of an earlier read.",
  },
  file_not_found: {
    type: "instructions",
    title: "Describe the project layout",
    action: "The agent keeps guessing paths that do not exist. Add this rule and a short map of where your source, tests and config live to your instructions file.",
    instructionText: "Search for a file before opening it if you are not sure of its path; never guess a path from memory.",
  },
  file_changed: {
    type: "habit",
    title: "Stop files changing under the agent",
    action: "Something else (a formatter on save, a watcher, a second agent in the same checkout) is changing files mid-session. Give parallel agents their own worktree.",
  },
  timeout: {
    type: "instructions",
    title: "Run long commands differently",
    action: "Commands keep hitting the tool timeout. Run slow builds and servers in the background, or scope test runs to the files that changed.",
    instructionText: "Run long-running commands (dev servers, full builds, watch modes) in the background, and run only the relevant tests rather than the full suite.",
  },
  too_large: {
    type: "instructions",
    title: "Read big files in pieces",
    action: "The agent keeps opening files or outputs too large for one call.",
    instructionText: "Read large files in ranges and search inside them instead of opening them whole; pipe long command output through `tail` or `head`.",
  },
  command_failed: {
    type: "habit",
    title: "Look at why this tool fails",
    action: "Check the failing calls in the evidence: the cause is usually a missing setup step you can describe in your instructions file.",
  },
  other: {
    type: "habit",
    title: "Look at why this tool fails",
    action: "Open one of the sessions in the evidence to see the error; a recurring cause is usually worth a line in your instructions file.",
  },
};

export const toolErrorHotspot: Detector = ({ sessions }) => {
  const tools = new Map<string, { calls: number; errors: number; categories: Map<ToolErrorCategory, number>; sessions: Map<Session, { count: number; first: string }> }>();
  for (const session of sessions) {
    for (const call of session.toolCalls) {
      // Shell failures are mostly the program's own exit code, which says nothing about the tool.
      if (call.category === "shell") continue;
      let row = tools.get(call.name);
      if (!row) tools.set(call.name, (row = { calls: 0, errors: 0, categories: new Map(), sessions: new Map() }));
      row.calls += 1;
      if (!call.error || EXCLUDED.has(call.error)) continue;
      row.errors += 1;
      row.categories.set(call.error, (row.categories.get(call.error) ?? 0) + 1);
      const perSession = row.sessions.get(session) ?? { count: 0, first: call.timestamp };
      perSession.count += 1;
      row.sessions.set(session, perSession);
    }
  }

  const findings: Finding[] = [];
  for (const [tool, row] of tools) {
    const rate = row.errors / row.calls;
    if (row.errors < MIN_ERRORS || row.calls < MIN_CALLS || rate < MIN_ERROR_RATE || row.sessions.size < MIN_SESSIONS) continue;
    const [category, categoryCount] = [...row.categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    const items = [...row.sessions]
      .sort((a, b) => b[1].count - a[1].count || a[1].first.localeCompare(b[1].first))
      .slice(0, MAX_EVIDENCE)
      .map(([session, info]) => evidence(session, `${tool} failed ${plural(info.count, "time")}`, info.first));
    findings.push({
      id: `tool_error_hotspot:${tool}`,
      kind: "tool_error_hotspot",
      severity: rate >= MEDIUM_ERROR_RATE ? "medium" : "low",
      title: `${tool} fails ${percent(rate)} of the time`,
      detail: `${tool} failed ${row.errors} of ${row.calls} calls across ${plural(row.sessions.size, "session")}. The most common error was ${category.replace(/_/g, " ")} (${categoryCount}).`,
      harnesses: harnessesOf(row.sessions.keys()),
      metric: { value: round(rate * 100, 1), unit: "%", label: "error rate" },
      evidence: items,
      suggestion: ADVICE[category] ?? ADVICE.other!,
    });
  }
  return findings
    .sort((a, b) => (b.metric?.value ?? 0) - (a.metric?.value ?? 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_FINDINGS_PER_KIND);
};
