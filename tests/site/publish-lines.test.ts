import { describe, expect, it } from "vitest";
import { publishedLines, storedNotes } from "../../site/lib/publish-lines.ts";
import { CARD_TITLES, EARNED_TITLES, type SharedStats } from "../../site/lib/share.ts";

// The publish panel's disclosure is a promise: every published field has a line, and every stored-but-hidden fact a note.
// Rendering the panel itself is covered in tests/site-render (it needs site/'s React).
const v3: SharedStats = {
  v: 3, name: "Ada", from: "2026-08-01", to: "2026-08-31", sessions: 321, tokens: 4_500_000, usd: 77, activeDays: 3, streak: 2,
  agents: [{ k: "claude-code", p: 70 }, { k: "codex", p: 30 }], fact: "Synthetic fact line.",
  cards: [{ k: "parallel", b: "5 at once", c: "sessions running side by side" }, { k: "tests", b: "88 runs", c: "" }],
  titles: [{ k: "conductor", v: 2.5 }], ratios: [{ k: "parallelism", v: 2.5, n: 40 }],
  device: { id: "0123456789abcdef0123456789abcdef", name: "Lab box" }, days: { from: "2026-08-01", bits: "Cw" },
};
const choices = { name: "Ada", handle: "ada", showAvatar: false, showDeviceName: false };

describe("publish panel disclosure lines", () => {
  it("has a line for every published field, title and card of a v3 payload", () => {
    const lines = Object.fromEntries(publishedLines(v3, choices));
    expect(Object.keys(lines)).toEqual(["Name", "This computer", "Photo", "Profile", "Period", "Sessions", "Tokens", "Estimated spend", "Active days", "Longest streak", "Agents", "Fun fact", `Title: ${EARNED_TITLES.conductor.title}`, "Ratios", `Card: ${CARD_TITLES.parallel}`, `Card: ${CARD_TITLES.tests}`]);
    expect(lines["Profile"]).toBe("ai-insights.app/u/ada");
    expect(lines["This computer"]).toContain("its name stays private");
    expect(publishedLines(v3, { ...choices, showDeviceName: true, showAvatar: true }).find(([k]) => k === "This computer")?.[1]).toBe("Lab box");
    expect(lines[`Card: ${CARD_TITLES.parallel}`]).toBe("5 at once, sessions running side by side");
    expect(lines["Agents"]).toBe("Claude Code 70%, Codex 30%");
  });

  it("names the device id and active days as stored but never shown, and never calls the numbers verified", () => {
    const notes = storedNotes(v3, false).join(" ");
    expect(notes).toContain("random id");
    expect(notes).toContain("which days this computer was active");
    expect(notes).toContain("not verified");
    expect(storedNotes({ ...v3, days: null }, true).join(" ")).not.toContain("which days");
  });

  it("explains a v1 link: no cards, no device id", () => {
    const v1: SharedStats = { v: 1, name: "", from: "2026-01-01", to: "2026-01-31", sessions: 1, tokens: 0, usd: null, activeDays: 1, streak: 1, agents: [], fact: "" };
    expect(publishedLines(v1, choices).some(([k]) => k.startsWith("Card:") || k === "This computer")).toBe(false);
    const notes = storedNotes(v1, false).join(" ");
    expect(notes).toContain("without recap cards");
    expect(notes).toContain("no device id");
    expect(notes).not.toContain("random id");
  });
});
