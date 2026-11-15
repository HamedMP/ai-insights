import { describe, expect, it } from "vitest";
import { PACKMEM_URL } from "../../../src/analysis/links.js";
import { coverage, day, sessionsOverDays } from "../factory.js";
import { findings } from "./helpers.js";

const MB = 1_000_000;

describe("history_disk_usage", () => {
  const sessions = () => [
    ...sessionsOverDays(3),
    ...sessionsOverDays(2, (index) => ({ harness: "codex", startTime: day(10 + index) })),
  ];

  it("suggests compressing history once it takes half a gigabyte, with one line per harness", () => {
    const all = sessions();
    const result = findings("history_disk_usage", all, {
      coverage: [coverage("claude-code", 3, true, 420 * MB), coverage("codex", 2, true, 180 * MB), coverage("cursor", 0, false)],
    });
    expect(result).toHaveLength(1);
    const [finding] = result;
    expect(finding!.severity).toBe("info");
    expect(finding!.metric).toEqual({ value: 600, unit: "MB", label: "agent history on disk" });
    expect(finding!.evidence).toHaveLength(2);
    const newestCodex = all.filter((session) => session.harness === "codex").at(-1)!;
    expect(finding!.evidence.find((item) => item.harness === "codex")?.sessionId).toBe(newestCodex.id);
    expect(finding!.evidence.map((item) => item.note)).toEqual([expect.stringContaining("420 MB"), expect.stringContaining("180 MB")]);
    expect(finding!.suggestion?.type).toBe("plugin");
    expect(finding!.suggestion?.title).toBe("Compress and save disk space");
    expect(finding!.suggestion?.action).toMatch(/compress/i);
    expect(finding!.suggestion?.action).toContain("packmem");
  });

  it("leaves out the link, and does not promise one, while packmem has no URL", () => {
    expect(PACKMEM_URL).toBeNull();
    const [finding] = findings("history_disk_usage", sessions(), { coverage: [coverage("claude-code", 3, true, 900 * MB)] });
    expect(finding!.suggestion).not.toHaveProperty("url");
    expect(finding!.suggestion?.action).not.toMatch(/link|below|install it from/i);
  });

  it("stays quiet under half a gigabyte", () => {
    expect(findings("history_disk_usage", sessions(), { coverage: [coverage("claude-code", 3, true, 300 * MB), coverage("codex", 2, true, 150 * MB)] })).toEqual([]);
  });

  it("stays quiet when the scan did not measure sizes", () => {
    expect(findings("history_disk_usage", sessions())).toEqual([]);
  });
});
