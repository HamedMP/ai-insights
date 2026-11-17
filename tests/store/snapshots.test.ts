import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport } from "../../src/analysis/index.js";
import type { RunSnapshot, Session } from "../../src/schema/types.js";
import { recordRun, renderFromScan } from "../../src/store/pipeline.js";
import { scan } from "../../src/store/scan.js";
import { compareRuns, KEEP_ALL_SNAPSHOTS, loadRuns, makeSnapshot, retainedIds, saveSnapshot, snapshotId, snapshotsDir } from "../../src/store/snapshots.js";
import { Store } from "../../src/store/store.js";
import { at, coverage, day, prompt, session, shell } from "../analysis/factory.js";
import { fakeSource, makeSession, tempHome } from "./fixtures.js";

let home: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
});
afterEach(async () => cleanup());

/** A history with a failing command, a repeated instruction and a long session, so several findings fire. */
function history(days: number, extra: Session[] = []): Session[] {
  const sessions = Array.from({ length: days }, (_, index) =>
    session({
      startTime: day(index),
      prompts: [prompt("always use the quintavius staging database for zorblatt", day(index, 1)), prompt("fix it", day(index, 5))],
      toolCalls: [shell("pnpm lint", "command_failed", day(index, 2)), shell("pnpm lint", "command_failed", day(index, 3)), shell("pnpm lint", "command_failed", day(index, 4))],
      features: { ...session().features, compactions: 5 },
    }),
  );
  return [...sessions, ...extra];
}

function reportAt(sessions: Session[], now: Date) {
  return buildReport({ sessions, coverage: [coverage("claude-code", sessions.length)], now, timeZone: "UTC" });
}

describe("run snapshots", () => {
  it("are a few KB of numbers and finding ids, never prompt text", () => {
    const report = reportAt(history(20), new Date(day(21)));
    const snapshot = makeSnapshot(report);
    const json = JSON.stringify(snapshot);
    expect(json.length).toBeLessThan(6_000);
    expect(json).not.toMatch(/quintavius|zorblatt|staging database/);
    expect(snapshot.findings.some((finding) => finding.kind === "repeated_instruction")).toBe(true);
    expect(snapshot.metrics.sessions).toBe(20);
    expect(snapshot.metrics.toolErrors).toBe(60);
    expect(snapshot.daily!.length).toBeLessThanOrEqual(30);
    expect(snapshot.suggestionsShown.length).toBeGreaterThan(0);
    expect(snapshot.id).toBe(snapshotId(report.generatedAt));
  });

  it("keep finding ids stable across runs, so a later report can tell which findings are still open", () => {
    const first = makeSnapshot(reportAt(history(20), new Date(day(21))));
    const later = makeSnapshot(reportAt(history(20, [session({ startTime: day(22) })]), new Date(day(23))));
    const kinds = (snapshot: RunSnapshot) => new Map(snapshot.findings.map((finding) => [finding.kind, finding.id]));
    const before = kinds(first);
    const after = kinds(later);
    expect(before.size).toBeGreaterThan(2);
    for (const [kind, id] of before) if (after.has(kind)) expect(after.get(kind), kind).toBe(id);
    expect(compareRuns(first, later).stillOpen.map((finding) => finding.id).sort()).toEqual(first.findings.filter((finding) => after.get(finding.kind) === finding.id).map((finding) => finding.id).sort());
  });

  it("compare metric by metric and sort findings into resolved, still open and new", () => {
    const base = makeSnapshot(reportAt(history(20), new Date(day(21))));
    const previous: RunSnapshot = { ...base, id: "a", findings: [...base.findings.slice(0, 1), { ...base.findings[0]!, id: "gone:1" }] };
    const current: RunSnapshot = { ...base, id: "b", metrics: { ...base.metrics, sessions: base.metrics.sessions + 5, winRate: null }, findings: [base.findings[0]!, { ...base.findings[0]!, id: "fresh:1" }] };
    const comparison = compareRuns(previous, current);
    expect(comparison.deltas.find((delta) => delta.key === "sessions")).toEqual({ key: "sessions", previous: 20, current: 25, delta: 5 });
    expect(comparison.deltas.find((delta) => delta.key === "winRate")!.delta).toBeNull();
    expect(comparison.resolved.map((finding) => finding.id)).toEqual(["gone:1"]);
    expect(comparison.stillOpen.map((finding) => finding.id)).toEqual([base.findings[0]!.id]);
    expect(comparison.new.map((finding) => finding.id)).toEqual(["fresh:1"]);
  });

  it("replace the previous run when two runs are minutes apart, so re-running adds no noise", async () => {
    const sessions = history(5);
    await saveSnapshot(home, makeSnapshot(reportAt(sessions, new Date("2026-07-01T10:00:00Z"))));
    await saveSnapshot(home, makeSnapshot(reportAt(sessions, new Date("2026-07-01T10:04:00Z"))));
    await saveSnapshot(home, makeSnapshot(reportAt(sessions, new Date("2026-07-01T11:00:00Z"))));
    const runs = await loadRuns(home);
    expect(runs.map((run) => run.generatedAt)).toEqual(["2026-07-01T10:04:00.000Z", "2026-07-01T11:00:00.000Z"]);
  });

  it("skip files that are not valid snapshots instead of failing the report", async () => {
    await saveSnapshot(home, makeSnapshot(reportAt(history(3), new Date("2026-07-01T10:00:00Z"))));
    await writeFile(join(snapshotsDir(home), "2026-07-02T10-00-00-000Z.json"), "{not json");
    await writeFile(join(snapshotsDir(home), "notes.json"), "{}");
    expect((await loadRuns(home)).length).toBe(1);
  });

  it("keep up to 500 runs, then thin those older than 90 days to one per week", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    const runs = Array.from({ length: KEEP_ALL_SNAPSHOTS + 100 }, (_, index) => {
      const generatedAt = new Date(now.getTime() - index * 8 * 3_600_000).toISOString(); // three a day, going back 200 days
      return { id: snapshotId(generatedAt), generatedAt };
    });
    expect(retainedIds(runs.slice(0, KEEP_ALL_SNAPSHOTS), now).size).toBe(KEEP_ALL_SNAPSHOTS);
    const kept = retainedIds(runs, now);
    const recent = runs.filter((run) => Date.parse(run.generatedAt) >= now.getTime() - 90 * 86_400_000);
    for (const run of recent) expect(kept.has(run.id)).toBe(true);
    const old = runs.filter((run) => !recent.includes(run) && kept.has(run.id));
    const weeks = new Set(old.map((run) => { const d = new Date(run.generatedAt); return Math.floor((d.getTime() / 86_400_000 + 3) / 7); }));
    expect(old.length).toBe(weeks.size);
    expect(kept.size).toBeLessThan(runs.length);
  });
});

describe("rendering with run history", () => {
  it("hands the renderer this computer's stable device id, so its share link publishes as the same device every time", async () => {
    const store = new Store(home);
    const ids: Array<string | undefined> = [];
    const deps = { store, buildReport, renderReport: (_r: unknown, extras?: { deviceId?: string }) => { ids.push(extras?.deviceId); return "<html></html>"; }, timeZone: "UTC" };
    const result = await scan({ sources: [fakeSource("claude-code", [makeSession({ id: "s1" })])], store });
    await renderFromScan(deps, result);
    await renderFromScan(deps, result);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(ids[1]).toBe(ids[0]);
  });

  it("saves a snapshot per render and hands the renderer every run, this one last, with a comparison", async () => {
    const store = new Store(home);
    const source = fakeSource("claude-code", [makeSession({ id: "s1" })]);
    const seen: Array<{ runs: number; compared: boolean }> = [];
    const deps = (iso: string) => ({
      store,
      buildReport,
      renderReport: (_report: unknown, extras?: { runs?: RunSnapshot[]; comparison?: unknown }) => {
        seen.push({ runs: extras?.runs?.length ?? 0, compared: !!extras?.comparison });
        return "<html></html>";
      },
      now: () => new Date(iso),
      timeZone: "UTC",
    });
    const result = await scan({ sources: [source], store });
    const first = await renderFromScan(deps("2026-10-02T09:00:00Z"), result);
    const second = await renderFromScan(deps("2026-10-03T09:00:00Z"), result);
    expect(seen).toEqual([
      { runs: 1, compared: false },
      { runs: 2, compared: true },
    ]);
    expect(first.runs.at(-1)!.generatedAt).toBe("2026-10-02T09:00:00.000Z");
    expect(second.runs.map((run) => run.generatedAt)).toEqual(["2026-10-02T09:00:00.000Z", "2026-10-03T09:00:00.000Z"]);
    const files = await readdir(snapshotsDir(home));
    expect(files.sort()).toEqual(["2026-10-02T09-00-00-000Z.json", "2026-10-03T09-00-00-000Z.json"]);
    const saved = await readFile(join(snapshotsDir(home), files[0]!), "utf8");
    expect(saved).not.toContain(await store.deviceId());
    expect(saved).not.toContain("add a settings page");
  });

  it("still renders when the run history cannot be written", async () => {
    // The snapshots folder is a file: saving fails, the report does not.
    await writeFile(join(home, "snapshots"), "in the way");
    const extras = await recordRun(new Store(home), reportAt(history(2), new Date(at(3 * 1440))), new Date(at(3 * 1440)));
    expect(extras.runs).toHaveLength(1);
    expect(extras.comparison).toBeUndefined();
  });
});
