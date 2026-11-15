import type { Finding, Harness, Session } from "../../schema/types.js";
import { evidence, HARNESS_LABELS, MAX_EVIDENCE, plural, type Detector } from "./context.js";

/** Blocked or rejected calls needed before permissions are a real drag rather than the odd "no". */
const MIN_BLOCKED = 10;
/** Spread over sessions, so it reflects the setup, not one risky task. */
const MIN_SESSIONS = 3;
/** Per hundred tool calls; above this the person is interrupted constantly. */
const MEDIUM_PER_HUNDRED = 5;
const HIGH_PER_HUNDRED = 15;

const BLOCKED = new Set(["permission_denied", "user_rejected"]);

const ADVICE: Partial<Record<Harness, { action: string; url: string }>> = {
  "claude-code": {
    action:
      "Add allow rules for the commands and tools you always approve (`/permissions`, or `permissions.allow` in `.claude/settings.json`), and deny rules for the ones you always refuse, so the agent stops asking.",
    url: "https://code.claude.com/docs/en/settings",
  },
  codex: {
    action:
      "Choose an approval policy and sandbox mode that match how you work (`/approvals` in Codex, or `approval_policy` and `sandbox_mode` in `~/.codex/config.toml`).",
    url: "https://developers.openai.com/codex",
  },
};

export const permissionPromptLoad: Detector = ({ sessions }) => {
  const byHarness = new Map<Harness, { blocked: number; calls: number; tools: Map<string, number>; sessions: Map<Session, { count: number; first: string }> }>();
  for (const session of sessions) {
    let row = byHarness.get(session.harness);
    if (!row) byHarness.set(session.harness, (row = { blocked: 0, calls: 0, tools: new Map(), sessions: new Map() }));
    row.calls += session.toolCalls.length;
    for (const call of session.toolCalls) {
      if (!call.error || !BLOCKED.has(call.error)) continue;
      row.blocked += 1;
      row.tools.set(call.name, (row.tools.get(call.name) ?? 0) + 1);
      const perSession = row.sessions.get(session) ?? { count: 0, first: call.timestamp };
      perSession.count += 1;
      row.sessions.set(session, perSession);
    }
  }

  const findings: Finding[] = [];
  for (const [harness, row] of [...byHarness].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (row.blocked < MIN_BLOCKED || row.sessions.size < MIN_SESSIONS) continue;
    const perHundred = (row.blocked / Math.max(1, row.calls)) * 100;
    const topTools = [...row.tools].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
    const items = [...row.sessions]
      .sort((a, b) => b[1].count - a[1].count || a[1].first.localeCompare(b[1].first))
      .slice(0, MAX_EVIDENCE)
      .map(([session, info]) => evidence(session, `${plural(info.count, "tool call")} denied or rejected`, info.first));
    const label = HARNESS_LABELS[harness];
    const advice = ADVICE[harness];
    findings.push({
      id: `permission_prompt_load:${harness}`,
      kind: "permission_prompt_load",
      severity: perHundred >= HIGH_PER_HUNDRED ? "high" : perHundred >= MEDIUM_PER_HUNDRED ? "medium" : "low",
      title: `${label} keeps hitting permission walls`,
      detail: `${plural(row.blocked, "tool call")} in ${label} were denied by permission settings or rejected by you, across ${plural(row.sessions.size, "session")}. Most were ${topTools.map(([name, count]) => `${name} (${count})`).join(", ")}. Each one stops the agent and waits for you.`,
      harnesses: [harness],
      metric: { value: Math.round(perHundred * 10) / 10, unit: "per 100 calls", label: "blocked tool calls" },
      evidence: items,
      suggestion: {
        type: "feature",
        title: "Tune permissions once",
        action: advice?.action ?? "Allow the tools you always approve and deny the ones you always refuse in the agent's settings.",
        ...(advice ? { url: advice.url } : {}),
      },
    });
  }
  return findings;
};
