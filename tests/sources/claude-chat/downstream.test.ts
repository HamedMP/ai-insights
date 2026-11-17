import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport } from "../../../src/analysis/index.js";
import { renderReport } from "../../../src/render/index.js";
import { buildView, recapView } from "../../../src/render/view.js";
import { formatMetric, metricValue } from "../../../site/lib/arena-format.ts";
import { pageSql } from "../../../site/lib/board-sql.ts";
import { competitionRanks, scoreIn, scoresFor } from "../../../site/lib/leaderboard.ts";
import { decodeStats, tokensMeasured, tokensText } from "../../../site/lib/share.ts";
import type { Report, Session } from "../../../src/schema/types.js";
import { claudeChatSource } from "../../../src/sources/claude-chat/index.js";
import { conversationToSession } from "../../../src/sources/claude-chat/conversation.js";
import { importClaudeExport, importDir } from "../../../src/sources/claude-chat/importer.js";
import { describeHeadline, headline, tokensPhrase } from "../../../src/store/pipeline.js";
import { scan } from "../../../src/store/scan.js";
import { Store } from "../../../src/store/store.js";
import { request, session as codingSession, shell, tool } from "../../analysis/factory.js";
import { conversation, exportJson, makeZip, MARKERS } from "./fixtures.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-insights-chat-downstream-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date("2026-08-20T12:00:00Z");

interface ShareLinkApi {
  url(p: unknown, base: string): string;
  payload(rc: unknown, name?: string, ratios?: unknown, device?: { id: string; name: string; days?: boolean } | null): Record<string, unknown> | null;
  describe(p: unknown): string[];
}

function shareLink(): ShareLinkApi {
  const context = createContext({ TextEncoder, btoa, atob, Date, Uint8Array, Math, Number, String, Array, JSON, Object, Set, console });
  new Script(readFileSync(new URL("../../../src/render/client/sharelink.js", import.meta.url), "utf8")).runInContext(context);
  return new Script("ShareLink").runInContext(context) as ShareLinkApi;
}

function expectNoMarkers(text: string, where: string): void {
  for (const [field, marker] of Object.entries(MARKERS)) expect(text, `${field} reached ${where}`).not.toContain(marker);
}

/** Ten conversations over ten days, each with the planted markers. */
function conversations() {
  return Array.from({ length: 10 }, (_, index) => conversation(`0b9a2c1e-0000-4000-8000-${String(index).padStart(12, "0")}`, `2026-08-${String(index + 3).padStart(2, "0")}T${String(9 + index).padStart(2, "0")}:15:00.000Z`));
}

async function importedSessions(): Promise<{ home: string; sessions: Session[]; report: Report; store: Store }> {
  const home = join(dir, "home");
  const zip = join(dir, "export.zip");
  writeFileSync(zip, makeZip([{ name: "conversations.json", data: exportJson(conversations()) }]));
  expect((await importClaudeExport(zip, home)).ok).toBe(true);
  const store = new Store(home);
  const result = await scan({ sources: [{ ...claudeChatSource, defaultRoots: () => [importDir(home)], discover: (options) => claudeChatSource.discover({ ...options, roots: [importDir(home)] }) }], store, retentionPolicies: false });
  const report = buildReport({ sessions: result.sessions, coverage: result.coverage, timeZone: "UTC", now: NOW });
  return { home, sessions: result.sessions, report, store };
}

describe("imported chats downstream", () => {
  it("no assistant, thinking, tool output, attachment or title text reaches the cache, report, page, excerpt or share link", async () => {
    const { home, sessions, report } = await importedSessions();
    expect(sessions).toHaveLength(10);
    // The store's own cache of the scanned sessions.
    const cached = readFileSync(join(home, "sessions", "claude-chat", `${sessions[0]!.id}.json`), "utf8");
    expectNoMarkers(cached, "the session cache");
    expectNoMarkers(JSON.stringify(report), "the report data");
    expectNoMarkers(renderReport(report), "the rendered page");
    const files = await claudeChatSource.discover({ roots: [importDir(home)] });
    for (const file of files) expectNoMarkers(JSON.stringify(await claudeChatSource.excerpt(file, { maxTurns: 500 })), "an excerpt");
    const SL = shareLink();
    const view = JSON.parse(JSON.stringify(recapView(report)));
    const payload = SL.payload(view, "", [], { id: "0123456789abcdef0123456789abcdef", name: "" })!;
    expectNoMarkers(JSON.stringify(payload), "the share payload");
    expectNoMarkers(SL.describe(payload).join("\n"), "the share description");
  });

  it("a history of only chats measures no tokens or cost and says so, and no coding finding fires", async () => {
    const { report, sessions } = await importedSessions();
    expect(report.usage.tokens).toBe(0);
    expect(report.usage.estimatedUsd).toBeNull();
    expect(report.findings.filter((finding) => !finding.kind.startsWith("history"))).toEqual([]);
    expect(report.ratios).toBeUndefined();
    expect(report.frictionCauses).toBeUndefined();
    expect(report.activity.chat).toMatchObject({ sessions: 10, userMessages: 30, toolCalls: 60, attachments: 20, files: 10, voiceNotes: 30, branches: 10 });
    expect(report.activity.parallelSessions.maxConcurrent).toBe(0);
    expect(report.activity.sessionSpans).toEqual([]);
    expect(report.recap?.persona?.role).toBe("Conversationalist");
    expect(report.recap?.thinking?.blocks).toBe(30);
    expect(report.recap?.totals.toolCalls).toBe(0);
    expect(report.recap?.voice.polite.please).toBeGreaterThan(0);
    const numbers = describeHeadline(report);
    expect(numbers.cost).toBe("cost not measured");
    expect(tokensPhrase(0, numbers.unmeasuredSessions, report.activity.sessions, String)).toBe("tokens not measured (chat exports record none)");
    expect(headline(sessions).unmeasuredSessions).toBe(10);
    // The share link carries no per-agent split for chats (the site estimates agent tokens from it) and says why tokens are 0.
    const SL = shareLink();
    const payload = SL.payload(JSON.parse(JSON.stringify(recapView(report))), "", [], null)!;
    expect(payload.agents).toEqual([]);
    expect(payload.tokens).toBe(0);
    expect(SL.describe(payload).join("\n")).toContain("tokens not measured (chat export only)");
  });

  it("a chat-only link opens on the site as not measured and ranks in no token, spend or agent arena", async () => {
    const { report } = await importedSessions();
    const SL = shareLink();
    const payload = SL.payload(JSON.parse(JSON.stringify(recapView(report))), "", [], { id: "0123456789abcdef0123456789abcdef", name: "" })!;
    const stats = decodeStats(SL.url(payload, "https://ai-insights.app/").split("#")[1]!)!;
    expect(stats).not.toBeNull();
    expect(stats.sessions).toBe(10);
    expect(tokensMeasured(stats)).toBe(false);
    expect(tokensText(stats)).toBe("not measured");
    expect(stats.usd).toBeNull();
    const scores = scoresFor(stats);
    for (const arena of ["tokens", "spend", "claude-code", "codex"] as const) expect(scoreIn(arena, scores), arena).toBeNull();
    expect(scoreIn("streak", scores)).toBeGreaterThan(0);
    // The leaderboard table: no "0" in the token column, no rank, listed after everyone who has one.
    const source = { tokens: stats.tokens, usd: stats.usd, claudeTokens: scores.claudeTokens, codexTokens: scores.codexTokens, streak: stats.streak, activeDays: stats.activeDays, sessions: stats.sessions, deviceCount: 1 };
    expect(metricValue("tokens", source)).toBeNull();
    expect(formatMetric("tokens", metricValue("tokens", source))).toBe(formatMetric("spend", null));
    expect(competitionRanks([5_000, 0])).toEqual([1, null]);
    expect(pageSql("tokens")).toMatch(/CASE WHEN tokens > 0 THEN rank\(\)/);
    // Coding history keeps its numbers.
    expect(tokensText({ sessions: 3, tokens: 1_200_000 })).toBe("1.2M");
    expect(tokensText({ sessions: 0, tokens: 0 })).toBe("0");
  });

  it("the report's share box says a chat-only entry is not measured and will not rank", async () => {
    const { report } = await importedSessions();
    expect(buildView(report, "UTC").activity.chat?.only).toBe(true);
    const page = readFileSync(new URL("../../../src/render/client/page.js", import.meta.url), "utf8");
    expect(page).toContain("chatOnly: !!(ACT.chat && ACT.chat.only)");
    const box = readFileSync(new URL("../../../src/render/client/sharebox.js", import.meta.url), "utf8");
    expect(box).toMatch(/env\.chatOnly \? h\("p", \{ class: "small slink-chat" \}, "Your history is a chat export only\. Chat exports record no tokens or spend, so the site shows both as not measured[^"]*will not rank in the token, spend or agent arenas\."\)/);
  });

  it("no site page renders a token count without the not-measured check", () => {
    const files = ["site/components/site/share-card.tsx", "site/components/site/profile.tsx", "site/components/site/owner-devices.tsx", "site/app/u/[handle]/opengraph-image.tsx", "site/components/site/publish-panel.tsx", "site/components/site/publish-form.tsx", "site/components/site/publish-preview.tsx", "site/lib/publish-lines.ts"];
    for (const file of files) {
      const text = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
      expect(text, file).not.toMatch(/(?<!tokensMeasured\((?:d\.)?(?:stats|s)\) \? (?:\["tokens", )?)format(?:Compact|Int)\((?:d\.)?(?:stats|s)\.tokens\)/);
    }
  });

  it("chats added to coding history change none of the coding numbers, and stay apart in the per-agent split", () => {
    const coding = Array.from({ length: 12 }, (_, index) =>
      codingSession({
        id: `code-${index}`,
        startTime: `2026-08-${String(index + 3).padStart(2, "0")}T10:00:00.000Z`,
        endTime: `2026-08-${String(index + 3).padStart(2, "0")}T11:00:00.000Z`,
        requests: [request({ timestamp: `2026-08-${String(index + 3).padStart(2, "0")}T10:05:00.000Z` })],
        toolCalls: [shell("pnpm test", index % 3 === 0 ? "command_failed" : undefined, `2026-08-${String(index + 3).padStart(2, "0")}T10:06:00.000Z`), tool("edit")],
      }),
    );
    const FILE = { harness: "claude-chat" as const, path: "x", mtimeMs: 0, sizeBytes: 0 };
    const chats = conversations().map((raw) => conversationToSession(raw, FILE)!);
    const alone = buildReport({ sessions: coding, coverage: [], timeZone: "UTC", now: NOW });
    const mixed = buildReport({ sessions: [...coding, ...chats], coverage: [], timeZone: "UTC", now: NOW });
    expect(mixed.usage).toEqual(alone.usage);
    expect(mixed.ratios).toEqual(alone.ratios);
    expect(mixed.findings).toEqual(alone.findings);
    expect(mixed.frictionCauses).toEqual(alone.frictionCauses);
    expect(mixed.activity.parallelSessions).toEqual(alone.activity.parallelSessions);
    expect(mixed.recap!.totals.toolsPerPrompt).toBe(alone.recap!.totals.toolsPerPrompt);
    expect(mixed.recap!.totals.commitShare).toBe(alone.recap!.totals.commitShare);
    expect(mixed.recap!.failures).toEqual(alone.recap!.failures);
    expect(mixed.recap!.persona!.role).toBe(alone.recap!.persona!.role);
    expect(mixed.activity.byHarness.map((row) => row.harness).sort()).toEqual(["claude-chat", "claude-code"]);
    expect(mixed.recap!.totals.sessions).toBe(22);
    const payload = shareLink().payload(JSON.parse(JSON.stringify(recapView(mixed))), "", [], null)!;
    expect(payload.agents).toEqual([{ k: "claude-code", p: 100 }]);
    expect(tokensPhrase(mixed.usage.tokens, 10, 22, String)).toMatch(/tokens \(coding agents; chat not measured\)$/);
  });
});
