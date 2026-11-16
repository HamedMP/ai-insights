import { describe, expect, it } from "vitest";
import { CAPS, SessionBuilder } from "../../../src/sources/common/builder.js";

const file = { harness: "pi" as const, path: "/synthetic/pi/session.jsonl", mtimeMs: 1, sizeBytes: 1 };
const T = (minute: number) => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();

describe("common session builder: recap fields", () => {
  it("counts each slash command a newer source sees, so OpenCode, Pi, Cursor and Gemini feed the recap too", () => {
    const builder = new SessionBuilder("pi");
    builder.prompt(T(0), "/model");
    builder.prompt(T(1), "/model fast");
    builder.prompt(T(2), "/compact");
    builder.prompt(T(3), "fix it");
    const session = builder.build(file, "pi-session")!;
    expect(session.features.slashCommandCounts).toEqual({ "/model": 2, "/compact": 1 });
  });

  it("counts tool calls past the cap", () => {
    const builder = new SessionBuilder("pi");
    builder.prompt(T(0), "read it all");
    for (let n = 0; n < CAPS.toolCalls + 2; n += 1) builder.tool({ name: "read", category: "read", timestamp: T(1) });
    const session = builder.build(file, "pi-session")!;
    expect(session.toolCalls).toHaveLength(CAPS.toolCalls);
    expect(session.toolCallsDropped).toBe(2);
  });
});
