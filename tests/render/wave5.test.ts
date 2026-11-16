import { describe, expect, it } from "vitest";
import { settingsSnippet } from "../../src/render/chapters/advice.js";
import { renderReport } from "../../src/render/index.js";
import { buildStory, historyDaysOf, lineText } from "../../src/render/story.js";
import type { Finding } from "../../src/schema/types.js";
import { makeDeterministicReport, makeReport } from "./fixtures.js";

function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
}

describe("days of history", () => {
  it("uses the analysed history days so the page and the short-history finding give the same number", () => {
    const report = makeReport();
    const coverage = report.coverage.map((entry) => (entry.harness === "claude-code" ? { ...entry, historyDays: 26 } : { ...entry, historyDays: 12 }));
    const html = renderReport({ ...report, coverage });
    expect(section(html, "coverage")).toContain("26 days of history, since");
    expect(section(html, "coverage")).toContain("12 days of history, since");
    expect(lineText(buildStory({ ...report, coverage }, "UTC").history!)).toBe("Your local history goes back 26 days.");
  });

  it("falls back to oldest-to-newest days when the report has no history days", () => {
    expect(historyDaysOf({ oldest: "2026-11-01T10:00:00Z", newest: "2026-11-10T09:00:00Z" })).toBe(10);
    expect(historyDaysOf({ historyDays: Number.NaN, oldest: "2026-11-01T10:00:00Z", newest: "2026-11-01T12:00:00Z" })).toBe(1);
    expect(historyDaysOf({ historyDays: 0, oldest: undefined as never, newest: undefined as never })).toBeNull();
  });
});

describe("sessions counted on the day they started", () => {
  it("labels the per-day and per-weekday visuals as sessions started", () => {
    const rhythm = section(renderReport(makeDeterministicReport()), "rhythm");
    expect(rhythm).toContain("Sessions started per day");
    expect(rhythm).toContain("Sessions started, by weekday");
    expect(rhythm).toMatch(/<title>[^<]*session(s)? started<\/title>/);
  });
});

describe("unpriced share", () => {
  it("says which share is unpriced: requests", () => {
    const html = renderReport(makeReport());
    expect(html).toMatch(/\d+% of requests unpriced/);
    expect(html).not.toMatch(/\d+% unpriced/);
  });
});

const PERMISSIONS: Finding = {
  id: "permission_prompt_load:claude-code",
  kind: "permission_prompt_load",
  severity: "high",
  title: "Claude Code keeps asking about the same commands",
  detail: "18 tool calls were denied or rejected across 9 sessions. Blocked repeatedly: `pnpm test` (6 times in 4 sessions), `git push` (4 times in 3 sessions).",
  harnesses: ["claude-code"],
  metric: { value: 0.4, unit: "per 100 calls", label: "blocked tool calls" },
  evidence: [{ sessionId: "c0000000-0001", harness: "claude-code", note: "4 tool calls denied, mostly `pnpm test`" }],
  suggestion: {
    type: "feature",
    title: "Allow the commands you keep approving",
    action:
      'Add `"permissions": {"allow": ["Bash(pnpm test:*)", "Bash(pnpm lint:*)"]}` to `.claude/settings.json`. `git push` is left out on purpose: a rule for it would also allow destructive commands.',
    url: "https://docs.example/settings",
  },
};

describe("permission prompts in What to improve", () => {
  it("turns an inline settings fragment into formatted JSON to copy, named after its file", () => {
    const snippet = settingsSnippet(PERMISSIONS.suggestion!.action)!;
    expect(snippet.file).toBe(".claude/settings.json");
    expect(JSON.parse(snippet.text)).toEqual({ permissions: { allow: ["Bash(pnpm test:*)", "Bash(pnpm lint:*)"] } });
    expect(settingsSnippet("Run `git status` first.")).toBeNull();
    expect(settingsSnippet("Add `{\"broken\": ` somewhere")).toBeNull();
  });

  it("shows the blocked commands, the allow rule to copy and the docs link", () => {
    const report = makeReport();
    const improve = section(renderReport({ ...report, findings: [PERMISSIONS, ...report.findings] }), "improve");
    expect(improve).toContain("Allow the commands you keep approving");
    expect(improve).toContain("Merge into <code>.claude/settings.json</code>");
    expect(improve).toMatch(/<pre id="copy-\d+"[^>]*>\{\n  &quot;permissions&quot;: \{\n    &quot;allow&quot;: \[/);
    expect(improve).toContain('data-copy="copy-');
    expect(improve).toContain("<code>git push</code>");
    expect(improve).toContain('href="https://docs.example/settings"');
  });

  it("prefers the finding's own instruction text when it has one", () => {
    const report = makeReport();
    const finding = { ...PERMISSIONS, suggestion: { ...PERMISSIONS.suggestion!, instructionText: "Run /permissions and allow pnpm test." } };
    const improve = section(renderReport({ ...report, findings: [finding, ...report.findings] }), "improve");
    expect(improve).toContain("Run /permissions and allow pnpm test.");
    expect(improve).not.toContain("Merge into");
  });
});
