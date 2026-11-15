import { describe, expect, it } from "vitest";
import { coverage, day, prompt, session, sessionsOverDays, shell, tool } from "../factory.js";
import { findings } from "./helpers.js";

const features = session().features;

describe("unused_feature", () => {
  it("suggests subagents when big explorations ran in the main context", () => {
    const sessions = sessionsOverDays(12, (index) =>
      index < 3 ? { toolCalls: Array.from({ length: 35 }, (_, n) => tool(n % 2 ? "read" : "search", { timestamp: day(index, n) })) } : {},
    );
    const result = findings("unused_feature", sessions).filter((finding) => finding.id === "unused_feature:subagents");
    expect(result).toHaveLength(1);
    expect(result[0]!.suggestion?.type).toBe("feature");
    expect(result[0]!.suggestion?.url).toMatch(/^https:\/\//);
    expect(result[0]!.evidence).toHaveLength(3);
  });

  it("suggests MCP when a service CLI is driven through the shell", () => {
    const sessions = sessionsOverDays(12, (index) =>
      index < 2 ? { toolCalls: Array.from({ length: 6 }, (_, n) => shell(`gh issue view ${n}`, undefined, day(index, n))) } : {},
    );
    expect(findings("unused_feature", sessions).map((finding) => finding.id)).toContain("unused_feature:mcp");
  });

  it("suggests skills when long procedural prompts open sessions", () => {
    const long = Array.from({ length: 90 }, (_, n) => `step${n}`).join(" ");
    const sessions = sessionsOverDays(12, (index) => (index < 2 ? { prompts: [prompt(long, day(index))] } : {}));
    expect(findings("unused_feature", sessions).map((finding) => finding.id)).toEqual(["unused_feature:skills"]);
  });

  it("stays quiet about a feature the person already uses", () => {
    const sessions = sessionsOverDays(12, (index) =>
      index < 3
        ? { toolCalls: Array.from({ length: 35 }, (_, n) => tool("read", { timestamp: day(index, n) })), features: { ...features, subagents: index === 0 ? 1 : 0 } }
        : {},
    );
    expect(findings("unused_feature", sessions).map((finding) => finding.id)).not.toContain("unused_feature:subagents");
  });

  it("stays quiet with too little history to judge", () => {
    const sessions = sessionsOverDays(4, (index) => ({ toolCalls: Array.from({ length: 35 }, (_, n) => tool("read", { timestamp: day(index, n) })) }));
    expect(findings("unused_feature", sessions)).toEqual([]);
  });

  it("does not suggest Claude-only features to a Codex user", () => {
    const sessions = sessionsOverDays(12, (index) => ({
      harness: "codex",
      toolCalls: Array.from({ length: 35 }, (_, n) => tool("read", { timestamp: day(index, n) })),
    }));
    expect(findings("unused_feature", sessions, { coverage: [coverage("codex", 12)] })).toEqual([]);
  });
});

describe("single_harness_only", () => {
  it("notes when every session comes from one agent though others were looked for", () => {
    const result = findings("single_harness_only", sessionsOverDays(6));
    expect(result).toHaveLength(1);
    expect(result[0]!.detail).toContain("Codex");
    expect(result[0]!.evidence).toHaveLength(2);
  });

  it("stays quiet when two agents are in use", () => {
    const sessions = sessionsOverDays(6, (index) => ({ harness: index % 2 ? "codex" : "claude-code" }));
    expect(findings("single_harness_only", sessions)).toEqual([]);
  });

  it("stays quiet when the report was limited to one agent", () => {
    expect(findings("single_harness_only", sessionsOverDays(6), { coverage: [coverage("claude-code", 6)] })).toEqual([]);
  });
});

describe("short_history", () => {
  it("points to Matrix OS when history is under a month", () => {
    const result = findings("short_history", sessionsOverDays(3), { now: new Date(day(20)) });
    expect(result).toHaveLength(1);
    expect(result[0]!.metric).toEqual({ value: 20, unit: "days", label: "days of history" });
    expect(result[0]!.suggestion?.type).toBe("matrix");
    expect(result[0]!.suggestion?.url).toBe("https://matrix-os.com");
    expect(result[0]!.suggestion?.action).toContain("about 30 days");
  });

  it("stays quiet with months of history", () => {
    expect(findings("short_history", sessionsOverDays(3), { now: new Date(day(120)) })).toEqual([]);
  });
});
