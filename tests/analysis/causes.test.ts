import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import type { FrictionCauseKey, Session, SessionFacet } from "../../src/schema/types.js";
import { coverage, day, facet, NOW, prompt, request, sessionsOverDays, tool } from "./factory.js";

function report(sessions: Session[], facets?: SessionFacet[]) {
  return buildReport({ sessions, ...(facets ? { facets } : {}), coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone: "UTC" });
}

function cause(sessions: Session[], key: FrictionCauseKey, facets?: SessionFacet[]) {
  return report(sessions, facets).frictionCauses?.causes.find((entry) => entry.key === key);
}

/** The agent works for `minutesAlone` minutes, then the person cuts in while it is still running. */
function steppedIn(index: number, times: number, minutesAlone = 2): Partial<Session> {
  const prompts = [prompt("start the task", day(index, 0))];
  const toolCalls = [];
  const requests = [];
  let minute = 0;
  for (let i = 0; i < times; i += 1) {
    toolCalls.push(tool("read", { timestamp: day(index, minute + minutesAlone - 0.5) }));
    requests.push(request({ timestamp: day(index, minute + minutesAlone - 0.5) }));
    minute += minutesAlone;
    prompts.push(prompt("no, not like that", day(index, minute), true));
  }
  return { prompts, toolCalls, requests, userMessageCount: prompts.length };
}

describe("friction causes", () => {
  it("shows nothing below ten sessions, so a person never sees percentages of three sessions", () => {
    const sessions = sessionsOverDays(9, (i) => ({ features: { ...sessionsOverDays(1)[0]!.features, compactions: i < 5 ? 2 : 0 } }));
    expect(report(sessions).frictionCauses).toBeUndefined();
    expect(report(sessionsOverDays(10)).frictionCauses).toBeDefined();
  });

  it("counts sessions, not events, and states the share over every session looked at", () => {
    const base = sessionsOverDays(1)[0]!.features;
    const sessions = sessionsOverDays(20, (i) => ({ features: { ...base, compactions: i < 4 ? 1 + i * 3 : 0 } }));
    const ran = cause(sessions, "context_ran_out")!;
    expect(ran).toMatchObject({ sessions: 4, of: 20, share: 0.2, label: "Context ran out" });
    expect(ran.signs).toEqual([{ key: "compacted", label: "Context was compacted", sessions: 4 }]);
  });

  it("works without an agent review: only signals AI Insights can measure, and no cause that needs the review", () => {
    const sessions = sessionsOverDays(12);
    const causes = report(sessions).frictionCauses!;
    expect(causes.usedReview).toBe(false);
    expect(causes.judged).toBe(0);
    expect(causes.causes.find((entry) => entry.key === "unclear_request")).toBeUndefined();
  });

  it("reports no causes for a healthy history rather than inventing one", () => {
    const causes = report(sessionsOverDays(12)).frictionCauses!;
    expect(causes.withAny).toBe(0);
    expect(causes.causes).toEqual([]);
  });

  it("counts a session under every cause it shows but only once in the 'any sign' total", () => {
    const base = sessionsOverDays(1)[0]!.features;
    const sessions = sessionsOverDays(10, (i) =>
      i === 0
        ? { features: { ...base, compactions: 2 }, toolCalls: [1, 2].map((m) => tool("read", { error: "permission_denied", timestamp: day(0, m) })) }
        : {},
    );
    const causes = report(sessions).frictionCauses!;
    expect(causes.causes.map((entry) => entry.key).sort()).toEqual(["context_ran_out", "permissions"]);
    expect(causes.withAny).toBe(1);
  });

  it("files repeated permission walls and refused prompts under permissions, but not a single deliberate no", () => {
    const blocked = (i: number, n: number) => Array.from({ length: n }, (_, k) => tool("shell", { command: "rm -rf build", error: i === 0 ? "user_rejected" : "permission_denied", timestamp: day(i, k + 1) }));
    const sessions = sessionsOverDays(10, (i) => (i < 3 ? { toolCalls: blocked(i, 2) } : i === 3 ? { toolCalls: blocked(i, 1) } : {}));
    expect(cause(sessions, "permissions")).toMatchObject({ sessions: 3, of: 10 });
  });

  it("treats files the agent could not find as missing context, not as a broken tool", () => {
    const sessions = sessionsOverDays(10, (i) =>
      i < 2 ? { toolCalls: [tool("read", { error: "file_not_found", timestamp: day(i, 1) }), tool("read", { error: "file_not_found", timestamp: day(i, 2) })] } : {},
    );
    expect(cause(sessions, "missing_context")).toMatchObject({ sessions: 2 });
    expect(cause(sessions, "tool_environment")).toBeUndefined();
  });

  it("counts an instruction the person keeps retyping as missing context", () => {
    const sessions = sessionsOverDays(12, (i) => (i < 5 ? { prompts: [prompt("always run pnpm check before you commit anything", day(i, 1))] } : {}));
    const missing = cause(sessions, "missing_context")!;
    expect(missing.sessions).toBe(5);
    expect(missing.signs.map((sign) => sign.key)).toEqual(["repeated_rule"]);
    // Evidence never quotes what the person typed.
    for (const item of missing.evidence) expect(item.note).not.toContain("pnpm check");
  });

  it("needs repeated tool failures before calling a session a tool or environment problem", () => {
    const failing = (n: number) => Array.from({ length: n }, (_, k) => tool("edit", { error: "edit_mismatch", timestamp: day(0, k + 1) }));
    const one = sessionsOverDays(10, (i) => (i === 0 ? { toolCalls: failing(2) } : {}));
    expect(cause(one, "tool_environment")).toBeUndefined();
    const three = sessionsOverDays(10, (i) => (i === 0 ? { toolCalls: failing(3) } : {}));
    expect(cause(three, "tool_environment")).toMatchObject({ sessions: 1 });
  });

  it("counts the same command failing three times in a row, but not a check that exits non-zero once", () => {
    const sessions = sessionsOverDays(10, (i) =>
      i === 0
        ? { toolCalls: [1, 2, 3].map((m) => tool("shell", { command: "pnpm build", error: "command_failed", timestamp: day(0, m) })) }
        : i === 1
          ? { toolCalls: [tool("shell", { command: "grep -q foo bar.txt", error: "command_failed", timestamp: day(1, 1) })] }
          : {},
    );
    expect(cause(sessions, "tool_environment")).toMatchObject({ sessions: 1 });
  });

  it("counts stepping in mid-run as off course only when it happened twice, or once after a long solo run", () => {
    const sessions = sessionsOverDays(10, (i) => (i === 0 ? steppedIn(0, 1) : i === 1 ? steppedIn(1, 2) : i === 2 ? steppedIn(2, 1, 12) : {}));
    expect(cause(sessions, "off_course")).toMatchObject({ sessions: 2 });
  });

  it("leaves sessions another agent drove out of the stepping-in sign", () => {
    const sessions = sessionsOverDays(10, (i) => (i < 2 ? { ...steppedIn(i, 3), agentMessageCount: 20 } : {}));
    expect(cause(sessions, "off_course")).toBeUndefined();
  });

  it("adds the agent review's judged friction once ten sessions are judged, with its own denominator for review-only causes", () => {
    const sessions = sessionsOverDays(20);
    const facets = sessions.slice(0, 10).map((s, i) =>
      facet(s.id, { frictions: i < 2 ? { misunderstood_request: 1 } : i < 5 ? { wrong_approach: 2 } : i === 5 ? { context_loss: 1 } : {} }),
    );
    const causes = report(sessions, facets).frictionCauses!;
    expect(causes.usedReview).toBe(true);
    expect(causes.judged).toBe(10);
    expect(causes.causes.find((entry) => entry.key === "unclear_request")).toMatchObject({ sessions: 2, of: 10, share: 0.2 });
    expect(causes.causes.find((entry) => entry.key === "off_course")).toMatchObject({ sessions: 3, of: 20 });
    expect(causes.causes.find((entry) => entry.key === "context_ran_out")!.signs).toEqual([{ key: "judged:context_loss", label: "Your agent judged context was lost", sessions: 1 }]);
  });

  it("ignores the review until ten sessions are judged, and says so", () => {
    const sessions = sessionsOverDays(20);
    const facets = sessions.slice(0, 4).map((s) => facet(s.id, { frictions: { misunderstood_request: 1 } }));
    const causes = report(sessions, facets).frictionCauses!;
    expect(causes.usedReview).toBe(false);
    expect(causes.judged).toBe(4);
    expect(causes.minJudged).toBe(10);
    expect(causes.causes).toEqual([]);
  });

  it("orders causes by share and cites at most two sessions, strongest first", () => {
    const base = sessionsOverDays(1)[0]!.features;
    const sessions = sessionsOverDays(20, (i) => ({
      features: { ...base, compactions: i < 6 ? i + 1 : 0 },
      ...(i >= 6 && i < 8 ? { toolCalls: [1, 2].map((m) => tool("read", { error: "permission_denied", timestamp: day(i, m) })) } : {}),
    }));
    const causes = report(sessions).frictionCauses!;
    expect(causes.causes.map((entry) => entry.key)).toEqual(["context_ran_out", "permissions"]);
    const ran = causes.causes[0]!;
    expect(ran.evidence).toHaveLength(2);
    expect(ran.evidence.map((item) => item.note)).toEqual(["Context was compacted 6 times", "Context was compacted 5 times"]);
  });

  it("points at the finding that fired for the same cause, and falls back to fixed advice", () => {
    const base = sessionsOverDays(1)[0]!.features;
    const heavy = sessionsOverDays(12, (i) => ({ features: { ...base, compactions: i < 4 ? 3 : 0 } }));
    const ran = cause(heavy, "context_ran_out")!;
    expect(ran.findingId).toBe("context_resets");
    expect(ran.suggestion.title).toBe("Hand off instead of compacting");
    const light = sessionsOverDays(12, (i) => ({ features: { ...base, compactions: i === 0 ? 1 : 0 } }));
    const lone = cause(light, "context_ran_out")!;
    expect(lone.findingId).toBeUndefined();
    expect(lone.suggestion.title).toBeTruthy();
  });
});
