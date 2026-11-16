import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqliteSupport } from "../../../src/sources/common/sqlite.js";
import { opencodeSource } from "../../../src/sources/opencode/index.js";

type Rec = Record<string, unknown>;

// node:sqlite ships with Node 22.5 and later. On older Node the database tests cannot build their fixture, so they
// are skipped there; the legacy-storage and "says why" tests below still run on every Node.
const sqlite = (() => {
  try {
    return createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  } catch {
    return null;
  }
})();

const T0 = Date.parse("2026-05-01T10:00:00.000Z");
const at = (seconds: number) => T0 + seconds * 1000;

let dir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hindsight-opencode-"));
  savedEnv = { XDG_DATA_HOME: process.env.XDG_DATA_HOME, OPENCODE_DB: process.env.OPENCODE_DB };
  process.env.XDG_DATA_HOME = dir;
  delete process.env.OPENCODE_DB;
  sqliteSupport.disabled = false;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  sqliteSupport.disabled = false;
});

const dataDir = () => join(dir, "opencode");

/** The history tables of a real opencode.db, plus the credential table that must never be read. */
function createDb(path = join(dataDir(), "opencode.db")): DatabaseSync {
  mkdirSync(dataDir(), { recursive: true });
  const db = new sqlite!.DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL, directory text NOT NULL,
      title text NOT NULL, version text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL);
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL, seq integer NOT NULL);
    CREATE TABLE credential (id text PRIMARY KEY, value text NOT NULL);
    INSERT INTO credential VALUES ('c1', 'sk-should-never-be-read-000000000000');
  `);
  return db;
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${String((seq += 1)).padStart(6, "0")}`;

function addSession(db: DatabaseSync, id: string, options: { parent?: string; directory?: string; start?: number } = {}) {
  db.prepare("INSERT INTO session VALUES (?, 'p1', ?, 'slug', ?, 'title', '1.17.9', ?, ?)").run(
    id,
    options.parent ?? null,
    options.directory ?? "/work/app",
    at(options.start ?? 0),
    at(options.start ?? 0),
  );
}

function message(db: DatabaseSync, sessionId: string, data: Rec, parts: Rec[] = [], raw?: string): string {
  const id = nextId("msg");
  const created = Number((data.time as Rec | undefined)?.created ?? T0);
  db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(id, sessionId, created, created, raw ?? JSON.stringify({ id, sessionID: sessionId, ...data }));
  for (const part of parts) {
    const partId = nextId("prt");
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(partId, id, sessionId, created, created, JSON.stringify({ id: partId, messageID: id, sessionID: sessionId, ...part }));
  }
  return id;
}

const user = (seconds: number, text: string, extra: Rec[] = []): [Rec, Rec[]] => [
  { role: "user", time: { created: at(seconds) }, agent: "build", model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" } },
  [{ type: "text", text }, ...extra],
];

const tokens = (input: number, output: number, read = 0, write = 0, reasoning = 0) => ({ input, output, reasoning, cache: { read, write } });

const assistant = (seconds: number, finish: string, parts: Rec[], extra: Rec = {}): [Rec, Rec[]] => [
  {
    role: "assistant",
    time: { created: at(seconds), completed: at(seconds + 5) },
    providerID: "anthropic",
    modelID: "claude-sonnet-4-6",
    mode: "build",
    agent: "build",
    finish,
    cost: 0.01,
    tokens: tokens(100, 20, 1000),
    path: { cwd: "/work/app", root: "/work/app" },
    ...extra,
  },
  parts,
];

const stepFinish = (cost: number, t: ReturnType<typeof tokens>): Rec => ({ type: "step-finish", reason: "stop", cost, tokens: t });

const toolPart = (tool: string, seconds: number, input: Rec, state: Rec = {}): Rec => ({
  type: "tool",
  tool,
  callID: nextId("call"),
  state: { status: "completed", input, output: "OUTPUT BODY THAT IS NEVER STORED", metadata: {}, time: { start: at(seconds), end: at(seconds + 1) }, ...state },
});

async function only() {
  const files = await opencodeSource.discover();
  expect(files).toHaveLength(1);
  const session = await opencodeSource.parse(files[0]!);
  expect(session).not.toBeNull();
  return { file: files[0]!, session: session! };
}

describe.skipIf(!sqlite)("opencode database history", () => {
  it("reads prompts, tools, tokens and the recorded cost of every provider from opencode.db", async () => {
    const db = createDb();
    addSession(db, "ses_main");
    message(db, "ses_main", ...user(0, "add a login page token=abc123secret"));
    message(db, "ses_main", ...assistant(10, "tool-calls", [
      toolPart("bash", 11, { command: "pnpm test", description: "run tests" }, { metadata: { exit: 1, output: "1 failed" } }),
      toolPart("edit", 12, { filePath: "/work/app/src/login.ts", oldString: "a", newString: "b\nc" }, { metadata: { filediff: { file: "/work/app/src/login.ts", additions: 2, deletions: 1 } } }),
      toolPart("github_create_issue", 13, { title: "x" }),
      stepFinish(0.02, tokens(100, 20, 1000, 50, 7)),
    ]));
    message(db, "ses_main", ...assistant(30, "stop", [{ type: "text", text: "Done." }, stepFinish(0, tokens(10, 5))], { providerID: "openrouter", modelID: "z-ai/glm-5" }));
    message(db, "ses_main", ...user(100, "thanks"));
    db.close();

    const { session } = await only();
    expect(session.harness).toBe("opencode");
    expect(session.id).toBe("ses_main");
    expect(session.projectPath).toBe("/work/app");
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["add a login page token=[redacted]", "thanks"]);
    // From the end of the final answer (t+35s) to the next prompt (t+100s).
    expect(session.userResponseTimesSec).toEqual([65]);
    expect(session.requests).toHaveLength(2);
    expect(session.requests[0]).toMatchObject({ model: "anthropic/claude-sonnet-4-6", usage: { input: 100, cachedInput: 1000, cacheWrite: 50, output: 27 }, costUsd: 0.02 });
    expect(session.requests[1]).toMatchObject({ model: "openrouter/z-ai/glm-5", costUsd: 0 });
    expect(session.models).toEqual(expect.arrayContaining(["anthropic/claude-sonnet-4-6", "openrouter/z-ai/glm-5"]));
    const [bash, edit, mcp] = session.toolCalls;
    expect(bash).toMatchObject({ name: "bash", category: "shell", command: "pnpm test", error: "command_failed" });
    expect(edit).toMatchObject({ category: "edit", filePath: "/work/app/src/login.ts" });
    expect(mcp).toMatchObject({ category: "mcp", mcpServer: "github" });
    expect(session.features.mcpServers).toEqual(["github"]);
    expect(session.linesAdded).toBe(2);
    expect(session.linesRemoved).toBe(1);
    expect(session.filesModified).toEqual(["/work/app/src/login.ts"]);
    expect(session.languages).toEqual({ TypeScript: 1 });
    expect(JSON.stringify(session)).not.toContain("OUTPUT BODY");
    expect(JSON.stringify(session)).not.toContain("should-never-be-read");
  });

  it("does not count text OpenCode added itself (file contents, editor context) as the person's prompt", async () => {
    const db = createDb();
    addSession(db, "ses_a");
    message(db, "ses_a", ...user(0, "fix the bug", [{ type: "text", text: "<file>00001| secret file body</file>", synthetic: true }]));
    message(db, "ses_a", ...assistant(5, "stop", [stepFinish(0.001, tokens(1, 1))]));
    db.close();
    const { session } = await only();
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["fix the bug"]);
  });

  it("folds subagent sessions into the session that spawned them: their spend counts, their briefing is not the person", async () => {
    const db = createDb();
    addSession(db, "ses_parent");
    addSession(db, "ses_child", { parent: "ses_parent", start: 20 });
    message(db, "ses_parent", ...user(0, "explore the repo"));
    message(db, "ses_parent", ...assistant(5, "tool-calls", [toolPart("task", 6, { description: "explore", prompt: "look around", subagent_type: "explore" }), stepFinish(0.01, tokens(10, 10))]));
    message(db, "ses_child", ...user(20, "look around"));
    message(db, "ses_child", ...assistant(25, "stop", [toolPart("read", 26, { filePath: "/work/app/README.md" }), stepFinish(0.05, tokens(500, 50))]));
    message(db, "ses_parent", ...assistant(40, "stop", [stepFinish(0.01, tokens(10, 10))]));
    db.close();
    const { session } = await only();
    expect(session.id).toBe("ses_parent");
    expect(session.prompts).toHaveLength(1);
    expect(session.requests).toHaveLength(3);
    expect(session.toolCalls.map((call) => call.name)).toEqual(["task", "read"]);
    expect(session.features.subagents).toBe(1);
  });

  it("uses message totals when an older version recorded no step parts, and skips rows it cannot parse", async () => {
    const db = createDb();
    addSession(db, "ses_old");
    message(db, "ses_old", ...user(0, "hello"));
    message(db, "ses_old", ...assistant(5, "stop", []));
    message(db, "ses_old", { role: "assistant" }, [], "{not json");
    db.close();
    const { session } = await only();
    expect(session.requests).toHaveLength(1);
    expect(session.requests[0]).toMatchObject({ usage: { input: 100, cachedInput: 1000, output: 20 }, costUsd: 0.01 });
    expect(session.issues).toBe(1);
  });

  it("reads usage from the newer session_message table without double counting messages the old tables still hold", async () => {
    const db = createDb();
    addSession(db, "ses_v2");
    const legacy = message(db, "ses_v2", ...assistant(5, "stop", [stepFinish(0.01, tokens(10, 10))]));
    const insert = db.prepare("INSERT INTO session_message VALUES (?, 'ses_v2', ?, ?, ?, ?, ?)");
    const v2 = (id: string, type: string, seconds: number, cost: number) =>
      insert.run(id, type, at(seconds), at(seconds), JSON.stringify({ time: { created: at(seconds) }, cost, model: { id: "glm-5", providerID: "zai" }, tokens: tokens(300, 30) }), seq++);
    v2(legacy, "assistant", 5, 0.01);
    v2("smg_new", "assistant", 50, 0.03);
    v2("smg_compact", "compaction", 60, 0.005);
    db.close();
    const { session } = await only();
    expect(session.requests.map((request) => request.costUsd)).toEqual([0.01, 0.03, 0.005]);
    expect(session.requests[1]!.model).toBe("zai/glm-5");
    expect(session.features.compactions).toBe(1);
  });

  it("gives an excerpt with the person's prompts, tool lines and the final answer", async () => {
    const db = createDb();
    addSession(db, "ses_x");
    message(db, "ses_x", ...user(0, "deploy it"));
    message(db, "ses_x", ...assistant(5, "tool-calls", [toolPart("bash", 6, { command: "./deploy.sh" }, { status: "error", error: "Command timed out after 120s" })]));
    message(db, "ses_x", ...assistant(10, "stop", [{ type: "text", text: "Deploy failed, the script timed out." }]));
    db.close();
    const files = await opencodeSource.discover();
    const turns = await opencodeSource.excerpt(files[0]!);
    expect(turns.map((turn) => turn.role)).toEqual(["user", "tool", "assistant"]);
    expect(turns[1]).toMatchObject({ toolName: "bash", isError: true });
    expect(turns[1]!.text).toContain("$ ./deploy.sh");
  });

  it("honours OPENCODE_DB and lists sessions newest first", async () => {
    const custom = join(dir, "elsewhere.db");
    const db = createDb(custom);
    addSession(db, "ses_1");
    message(db, "ses_1", ...user(0, "one"));
    addSession(db, "ses_2", { start: 500 });
    message(db, "ses_2", ...user(500, "two"));
    db.close();
    process.env.OPENCODE_DB = custom;
    const files = await opencodeSource.discover();
    expect(files.map((file) => file.path)).toEqual([`${custom}#ses_2`, `${custom}#ses_1`]);
    expect(files.every((file) => file.sizeBytes > 0)).toBe(true);
  });
});

describe("opencode legacy storage and old Node versions", () => {
  function legacy() {
    const storage = join(dataDir(), "storage");
    const write = (path: string, value: Rec) => {
      mkdirSync(join(storage, path, ".."), { recursive: true });
      writeFileSync(join(storage, path), JSON.stringify(value));
    };
    write("session/proj1/ses_file.json", { id: "ses_file", projectID: "proj1", directory: "/work/old", title: "t", version: "0.9", time: { created: at(0), updated: at(60) } });
    write("message/ses_file/msg_a.json", { id: "msg_a", sessionID: "ses_file", role: "user", time: { created: at(0) } });
    write("part/msg_a/prt_a.json", { id: "prt_a", type: "text", text: "from the file era" });
    write("message/ses_file/msg_b.json", {
      id: "msg_b", sessionID: "ses_file", role: "assistant", time: { created: at(5), completed: at(9) }, providerID: "openai", modelID: "gpt-5.2", cost: 0.2, tokens: tokens(40, 4),
    });
    write("part/msg_b/prt_b.json", { id: "prt_b", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/work/old/a.py" }, time: { start: at(6) } } });
  }

  it("reads sessions OpenCode stored as JSON files before it had a database", async () => {
    legacy();
    const { session } = await only();
    expect(session.id).toBe("ses_file");
    expect(session.projectPath).toBe("/work/old");
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["from the file era"]);
    expect(session.requests[0]).toMatchObject({ model: "openai/gpt-5.2", costUsd: 0.2, usage: { input: 40, output: 4 } });
    expect(session.toolCalls[0]).toMatchObject({ name: "read", category: "read", filePath: "/work/old/a.py" });
  });

  it.skipIf(!sqlite)("does not list a session twice once OpenCode has migrated its files into the database", async () => {
    legacy();
    const db = createDb();
    addSession(db, "ses_file");
    message(db, "ses_file", ...user(0, "from the file era"));
    db.close();
    const files = await opencodeSource.discover();
    expect(files.map((file) => file.path)).toEqual([`${join(dataDir(), "opencode.db")}#ses_file`]);
  });

  it("says why the database cannot be read on a Node without node:sqlite instead of failing", async () => {
    // Any file at the database path will do: the source must explain itself before it ever opens it.
    if (sqlite) createDb().close();
    else {
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(join(dataDir(), "opencode.db"), "");
    }
    sqliteSupport.disabled = true;
    expect(await opencodeSource.discover()).toEqual([]);
    expect(await opencodeSource.diagnose!()).toMatch(/Node 22\.5 or later/);
  });

  it("reports nothing wrong when there is no OpenCode history at all", async () => {
    expect(await opencodeSource.diagnose!()).toBeNull();
    expect(await opencodeSource.discover()).toEqual([]);
  });
});
