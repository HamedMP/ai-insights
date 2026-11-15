import { describe, expect, it } from "vitest";
import { session, sessionsOverDays } from "../factory.js";
import { findings } from "./helpers.js";

const features = session().features;

describe("context_resets", () => {
  it("flags sessions that keep running out of context", () => {
    const sessions = sessionsOverDays(10, (index) => ({ features: { ...features, compactions: index < 3 ? 2 : 0 } }));
    const result = findings("context_resets", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.metric?.value).toBe(6);
    expect(result[0]!.evidence).toHaveLength(3);
  });

  it("stays quiet on a rare compaction", () => {
    const sessions = sessionsOverDays(10, (index) => ({ features: { ...features, compactions: index === 0 ? 2 : 0 } }));
    expect(findings("context_resets", sessions)).toEqual([]);
  });
});

describe("long_sessions", () => {
  it("flags a habit of very long sessions", () => {
    const sessions = sessionsOverDays(8, (index) => (index < 3 ? { activeMinutes: 200 } : index === 3 ? { userMessageCount: 120 } : {}));
    const result = findings("long_sessions", sessions);
    expect(result).toHaveLength(1);
    expect(result[0]!.metric?.value).toBe(4);
    expect(result[0]!.severity).toBe("medium");
  });

  it("judges length by active time, not by how long a session sat open", () => {
    const sessions = sessionsOverDays(8, (index) => (index < 4 ? { durationMinutes: 5000, activeMinutes: 40 } : {}));
    expect(findings("long_sessions", sessions)).toEqual([]);
  });

  it("stays quiet on one marathon among normal sessions", () => {
    const sessions = sessionsOverDays(8, (index) => (index === 0 ? { activeMinutes: 400 } : {}));
    expect(findings("long_sessions", sessions)).toEqual([]);
  });
});
