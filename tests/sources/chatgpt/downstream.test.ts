import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReport } from "../../../src/analysis/index.js";
import { renderReport } from "../../../src/render/index.js";
import { recapView } from "../../../src/render/view.js";
import { decodeStats, tokensMeasured } from "../../../site/lib/share.ts";
import type { Report, Session } from "../../../src/schema/types.js";
import { importDir } from "../../../src/sources/claude-chat/importer.js";
import { conversationToSession } from "../../../src/sources/chatgpt/conversation.js";
import { chatgptSource } from "../../../src/sources/chatgpt/index.js";
import { CHATGPT_HARNESS, importChatgptExport } from "../../../src/sources/chatgpt/importer.js";
import { describeHeadline } from "../../../src/store/pipeline.js";
import { scan } from "../../../src/store/scan.js";
import { Store } from "../../../src/store/store.js";
import { request, session as codingSession, shell, tool } from "../../analysis/factory.js";
import { BASE, classicConversation, currentConversation, exportJson, MARKERS, PRIVATE_FILE_PROMPT, PRIVATE_FILES, privateFileBody } from "./fixtures.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-insights-chatgpt-downstream-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date("2026-08-25T12:00:00Z");

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
  expect(text, `a file beside the conversations reached ${where}`).not.toContain(PRIVATE_FILE_PROMPT);
}

/** Ten conversations over ten days, both shapes, each with the planted markers. */
function conversations() {
  return Array.from({ length: 10 }, (_, index) =>
    (index % 2 ? currentConversation : classicConversation)(`6f1c0a2e-0000-4000-8000-${String(index).padStart(12, "0")}`, BASE + index * 86_400),
  );
}

async function importedSessions(): Promise<{ home: string; sessions: Session[]; report: Report }> {
  const home = join(dir, "home");
  const folder = join(dir, "openai-export");
  mkdirSync(folder);
  const all = conversations();
  writeFileSync(join(folder, "conversations-000.json"), exportJson(all.slice(0, 5)));
  writeFileSync(join(folder, "conversations-001.json"), exportJson(all.slice(5)));
  for (const name of PRIVATE_FILES) writeFileSync(join(folder, name), privateFileBody());
  expect((await importChatgptExport(folder, home)).ok).toBe(true);
  const roots = [importDir(home, CHATGPT_HARNESS)];
  const result = await scan({ sources: [{ ...chatgptSource, defaultRoots: () => roots, discover: (options) => chatgptSource.discover({ ...options, roots }) }], store: new Store(home), retentionPolicies: false });
  const report = buildReport({ sessions: result.sessions, coverage: result.coverage, timeZone: "UTC", now: NOW });
  return { home, sessions: result.sessions, report };
}

describe("imported ChatGPT history downstream", () => {
  it("no answer, reasoning, tool output, memory, instruction, attachment or title text reaches the cache, report, page, excerpt or share link", async () => {
    const { home, sessions, report } = await importedSessions();
    expect(sessions).toHaveLength(10);
    expectNoMarkers(readFileSync(join(home, "sessions", "chatgpt", `${sessions[0]!.id}.json`), "utf8"), "the session cache");
    expectNoMarkers(JSON.stringify(report), "the report data");
    expectNoMarkers(renderReport(report), "the rendered page");
    for (const file of await chatgptSource.discover({ roots: [importDir(home, CHATGPT_HARNESS)] })) expectNoMarkers(JSON.stringify(await chatgptSource.excerpt(file, { maxTurns: 500 })), "an excerpt");
    const SL = shareLink();
    const payload = SL.payload(JSON.parse(JSON.stringify(recapView(report))), "", [], { id: "0123456789abcdef0123456789abcdef", name: "" })!;
    expectNoMarkers(JSON.stringify(payload), "the share payload");
    expectNoMarkers(SL.describe(payload).join("\n"), "the share description");
  });

  it("a history of only ChatGPT measures no tokens or cost, keeps the model out of usage, and no coding finding fires", async () => {
    const { report } = await importedSessions();
    expect(report.usage.tokens).toBe(0);
    expect(report.usage.estimatedUsd).toBeNull();
    expect(report.usage.models).toEqual([]);
    expect(report.findings.filter((finding) => !finding.kind.startsWith("history"))).toEqual([]);
    expect(report.ratios).toBeUndefined();
    expect(report.frictionCauses).toBeUndefined();
    expect(report.activity.chat).toMatchObject({ sessions: 10, userMessages: 25, branches: 10 });
    expect(report.activity.parallelSessions.maxConcurrent).toBe(0);
    expect(report.recap?.persona?.role).toBe("Conversationalist");
    expect(describeHeadline(report).cost).toBe("cost not measured");
    const SL = shareLink();
    const payload = SL.payload(JSON.parse(JSON.stringify(recapView(report))), "", [], { id: "0123456789abcdef0123456789abcdef", name: "" })!;
    expect(payload.agents).toEqual([]);
    expect(payload.tokens).toBe(0);
    expect(SL.describe(payload).join("\n")).toContain("tokens not measured (chat export only)");
    const stats = decodeStats(SL.url(payload, "https://ai-insights.app/").split("#")[1]!)!;
    expect(tokensMeasured(stats)).toBe(false);
  });

  it("ChatGPT added to coding history changes none of the coding numbers and stays out of the per-agent split", () => {
    const coding = Array.from({ length: 12 }, (_, index) => {
      const day = `2026-08-${String(index + 3).padStart(2, "0")}`;
      return codingSession({
        id: `code-${index}`,
        startTime: `${day}T10:00:00.000Z`,
        endTime: `${day}T11:00:00.000Z`,
        requests: [request({ timestamp: `${day}T10:05:00.000Z` })],
        toolCalls: [shell("pnpm test", index % 3 === 0 ? "command_failed" : undefined, `${day}T10:06:00.000Z`), tool("edit")],
      });
    });
    const FILE = { harness: CHATGPT_HARNESS, path: "x", mtimeMs: 0, sizeBytes: 0 };
    const chats = conversations().map((raw) => conversationToSession(raw, FILE)!);
    const alone = buildReport({ sessions: coding, coverage: [], timeZone: "UTC", now: NOW });
    const mixed = buildReport({ sessions: [...coding, ...chats], coverage: [], timeZone: "UTC", now: NOW });
    expect(mixed.usage).toEqual(alone.usage);
    expect(mixed.ratios).toEqual(alone.ratios);
    expect(mixed.findings).toEqual(alone.findings);
    expect(mixed.frictionCauses).toEqual(alone.frictionCauses);
    expect(mixed.activity.parallelSessions).toEqual(alone.activity.parallelSessions);
    expect(mixed.recap!.failures).toEqual(alone.recap!.failures);
    expect(mixed.activity.byHarness.map((row) => row.harness).sort()).toEqual(["chatgpt", "claude-code"]);
    const payload = shareLink().payload(JSON.parse(JSON.stringify(recapView(mixed))), "", [], null)!;
    expect(payload.agents).toEqual([{ k: "claude-code", p: 100 }]);
  });
});
