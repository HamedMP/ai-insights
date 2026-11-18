import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Session, SessionFile } from "../../src/schema/types.js";
import { claudeSource } from "../../src/sources/claude/index.js";
import { codexSource } from "../../src/sources/codex/index.js";
import { assistant, prompt, toolResult, toolUse, transcript, writeLines } from "../sources/claude/helpers.js";
import { canZstd, item, meta, rec, resetClock, rolloutName, shell, turnContext, Tree, userMessage, uuid } from "../sources/codex/fixtures.js";
import { compileSources } from "./compiled.js";

// The CLI parses on worker threads and resumes appended transcripts. Whatever path a transcript takes (worker,
// fallback to this thread, checkpoint), the Session must be the one `source.parse` gives on this thread.

type Compiled = ReturnType<typeof compileSources>;
let compiled: Compiled;
let mod: {
  ParsePool: typeof import("../../src/store/parse-pool.js").ParsePool;
  fileParser: typeof import("../../src/store/parse-file.js").fileParser;
  sources: typeof import("../../src/sources/index.js").sources;
};

beforeAll(async () => {
  compiled = compileSources();
  const [pool, file, sources] = await Promise.all([
    import(compiled.url("store/parse-pool.js").href),
    import(compiled.url("store/parse-file.js").href),
    import(compiled.url("sources/index.js").href),
  ]);
  mod = { ParsePool: pool.ParsePool, fileParser: file.fileParser, sources: sources.sources };
}, 60_000);
afterAll(() => compiled?.cleanup());

const homes: string[] = [];
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-insights-pool-home-"));
  homes.push(dir);
  return dir;
}

const compiledSource = (harness: string) => mod.sources.find((source) => source.harness === harness)!;

function claudeFile(): SessionFile {
  const file = transcript([
    prompt("2026-03-01T10:00:00.000Z", "read the README and fix the typo"),
    assistant("2026-03-01T10:00:03.000Z", "m1", [toolUse("t1", "Task", { name: "reader", prompt: "read it" })], { usage: { input: 50, output: 9 } }),
    toolResult("2026-03-01T10:00:30.000Z", "t1", "done"),
    assistant("2026-03-01T10:00:33.000Z", "m2", [toolUse("t2", "Edit", { file_path: "/work/demo/README.md", old_string: "teh", new_string: "the" })], { usage: { input: 80, output: 12 } }),
  ]);
  writeLines(join(file.path.slice(0, -".jsonl".length), "subagents", "agent-r1.jsonl"), [
    assistant("2026-03-01T10:00:05.000Z", "s1", [toolUse("st", "Read", { file_path: "/work/demo/README.md" })], { usage: { input: 30, output: 4 }, extra: { isSidechain: true } }),
  ]);
  return file;
}

function codexFamily(tree: Tree, zst: boolean): void {
  resetClock();
  const parentId = uuid(1);
  tree.write(rolloutName(1), [meta(parentId, { thread_source: "user" }), turnContext("main-model"), ...userMessage("build it"), rec("token_usage_record", { response_id: "p1", thread_id: parentId, usage: { input_tokens: 100, output_tokens: 10 } }), ...shell("c1", "pnpm test", 1, "1 failing")], { zst });
  tree.write(rolloutName(2), [
    meta(uuid(2), { thread_source: "guardian_review", source: { subagent: { other: "guardian" } }, parent_thread_id: parentId }),
    turnContext("review-model"),
    item({ type: "message", role: "user", content: [{ type: "input_text", text: ">>> APPROVAL REQUEST START\n{}" }] }, { metadata: { user_input_order: 1 } }),
    rec("token_usage_record", { response_id: "g1", thread_id: uuid(2), usage: { input_tokens: 50, output_tokens: 5 } }),
  ], { zst });
  tree.write(rolloutName(3), [
    meta(uuid(3), { thread_source: "subagent", source: { subagent: { thread_spawn: { parent_thread_id: parentId } } }, parent_thread_id: parentId }),
    turnContext("sub-model"),
    rec("token_usage_record", { response_id: "s1", thread_id: uuid(3), usage: { input_tokens: 70, output_tokens: 7 } }),
    ...shell("sc", "git commit -m sub", 0),
  ], { base: "archived_sessions", zst });
}

async function both(file: SessionFile, reference: () => Promise<Session | null>, options: { workers?: number } = {}) {
  const pool = mod.ParsePool.create({ size: options.workers ?? 2, workerUrl: compiled.url("store/parse-worker.js") })!;
  expect(pool).not.toBeNull();
  try {
    const parse = mod.fileParser({ pool, home: home(), tailMinBytes: 0 });
    return { pooled: await parse(compiledSource(file.harness), file), reference: await reference() };
  } finally {
    await pool.close();
  }
}

describe("parsing on worker threads", () => {
  it("gives a Claude Code session, subagents folded in, exactly as on this thread", async () => {
    const file = claudeFile();
    const { pooled, reference } = await both(file, () => claudeSource.parse(file));
    expect(pooled).not.toBeNull();
    expect(pooled).toEqual(reference);
  });

  for (const zst of canZstd ? [false, true] : [false]) {
    it(`gives a Codex session with its guardian and subagent rollouts folded in${zst ? " (zstd rollouts)" : ""}`, async () => {
      const tree = new Tree();
      try {
        codexFamily(tree, zst);
        const [file] = await codexSource.discover({ roots: [tree.sessions] });
        const compiledFiles = await compiledSource("codex").discover({ roots: [tree.sessions] });
        expect(compiledFiles).toEqual([file]);
        const { pooled, reference } = await both(file!, () => codexSource.parse(file!), { workers: 3 });
        expect(pooled?.requests.map((request) => request.id).sort()).toEqual(["codex-response:g1", "codex-response:p1", "codex-response:s1"]);
        expect(pooled).toEqual(reference);
      } finally {
        tree.cleanup();
      }
    });
  }

  it("resumes a growing transcript inside the worker and still matches a full read", async () => {
    const file = claudeFile();
    const pool = mod.ParsePool.create({ size: 1, workerUrl: compiled.url("store/parse-worker.js") })!;
    try {
      const parse = mod.fileParser({ pool, home: home(), tailMinBytes: 0 });
      expect(await parse(compiledSource("claude-code"), file)).toEqual(await claudeSource.parse(file));
      appendFileSync(file.path, `${JSON.stringify(prompt("2026-03-01T10:02:00.000Z", "and run the tests"))}\n`);
      appendFileSync(file.path, `${JSON.stringify(assistant("2026-03-01T10:02:04.000Z", "m3", [], { usage: { input: 90, output: 3 } }))}\n`);
      expect(await parse(compiledSource("claude-code"), file)).toEqual(await claudeSource.parse(file));
    } finally {
      await pool.close();
    }
  });

  it("falls back to this thread when the worker dies, with the same result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai-insights-bad-worker-"));
    homes.push(dir);
    const crashing = join(dir, "worker.mjs");
    writeFileSync(crashing, "process.exit(3);\n");
    const pool = mod.ParsePool.create({ size: 2, workerUrl: new URL(`file://${crashing}`) })!;
    try {
      const file = claudeFile();
      const parse = mod.fileParser({ pool, home: home(), tailMinBytes: 0 });
      expect(await parse(compiledSource("claude-code"), file)).toEqual(await claudeSource.parse(file));
    } finally {
      await pool.close();
    }
  });

  it("is not used when there is no compiled worker entry (running from source)", () => {
    expect(mod.ParsePool.create({ workerUrl: new URL("file:///no/such/parse-worker.js") })).toBeNull();
  });
});
