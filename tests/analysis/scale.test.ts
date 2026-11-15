import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import { coverage, day, prompt, request, session, shell, task, tool } from "./factory.js";

describe("scale", () => {
  it("builds a report for a heavy year of history quickly and keeps it small", () => {
    const sessions = Array.from({ length: 2000 }, (_, index) =>
      session({
        startTime: day(index % 365, (index * 37) % 600),
        prompts: Array.from({ length: 40 }, (_, n) => prompt(`${task()} ${n % 3 ? "and keep the tests green" : ""}`, day(index % 365, n))),
        requests: Array.from({ length: 50 }, (_, n) => request({ timestamp: day(index % 365, n) })),
        toolCalls: Array.from({ length: 60 }, (_, n) => (n % 4 ? tool("read", { timestamp: day(index % 365, n) }) : shell(`pnpm test --filter ${n}`, n % 8 ? undefined : "command_failed", day(index % 365, n)))),
      }),
    );
    const started = Date.now();
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 2000)], now: new Date(day(366)), timeZone: "UTC" });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(report.activity.daily.length).toBeLessThanOrEqual(366);
    expect(JSON.stringify(report).length).toBeLessThan(500_000);
  });
});
