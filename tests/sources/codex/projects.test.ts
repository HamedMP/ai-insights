import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { codexSource } from "../../../src/sources/codex/index.js";
import { event, meta, resetClock, rolloutName, shell, Tree, turnContext, userMessage, uuid, type Rec } from "./fixtures.js";

let tree: Tree;
let work: string;
beforeEach(() => {
  tree = new Tree();
  resetClock();
  work = join(tree.root, "work");
  for (const repo of ["app", "lib"]) mkdirSync(join(work, repo, ".git"), { recursive: true });
  mkdirSync(join(work, "app", "src"), { recursive: true });
});
afterEach(() => tree.cleanup());

async function parseOne(records: Rec[]) {
  tree.write(rolloutName(1), records);
  const [file] = await codexSource.discover({ roots: [tree.sessions] });
  return (await codexSource.parse(file!))!;
}

const done = (payload: Rec): Rec => event({ type: "item_completed", thread_id: uuid(1), turn_id: "t1", item: payload });
const edit = (path: string): Rec =>
  done({ type: "FileChange", id: path, status: "completed", changes: { [path]: { type: "update", unified_diff: "@@ -1 +1 @@\n-a\n+b\n", move_path: null } } });
const command = (cwd: string, script: string): Rec =>
  done({ type: "CommandExecution", id: script, command: ["/bin/bash", "-lc", script], cwd, parsed_cmd: [{ type: "unknown", cmd: script }], status: "completed", exit_code: 0 });

describe("codex project attribution", () => {
  it("groups a session under the repository the work happened in when the cwd is only a parent folder", async () => {
    const session = await parseOne([
      meta(uuid(1), { cwd: work }),
      turnContext("gpt-test", { cwd: work }),
      ...userMessage("fix the app"),
      // Codex Desktop writes command directories as file:// URLs.
      command(pathToFileURL(join(work, "app")).href, "pnpm test"),
      ...shell("g1", `git -C ${join(work, "app")} status`, 0),
      edit(join(work, "app", "src", "main.ts")),
      edit(join(work, "app", "README.md")),
    ]);
    expect(session.projectPath).toBe(join(work, "app"));
  });

  it("keeps the cwd when work is spread across several repositories", async () => {
    const session = await parseOne([
      meta(uuid(1), { cwd: work }),
      ...userMessage("sync both"),
      edit(join(work, "app", "a.ts")),
      edit(join(work, "app", "b.ts")),
      edit(join(work, "lib", "a.ts")),
      edit(join(work, "lib", "b.ts")),
    ]);
    expect(session.projectPath).toBe(work);
  });

  it("keeps the cwd when it is itself a repository", async () => {
    const session = await parseOne([meta(uuid(1), { cwd: join(work, "app") }), ...userMessage("look around"), command(join(work, "lib"), "ls"), edit(join(work, "lib", "x.ts"))]);
    expect(session.projectPath).toBe(join(work, "app"));
  });

  it("files work in a git worktree under that checkout, as Claude Code does for a session started there", async () => {
    const worktree = join(work, "app-feature");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".git"), `gitdir: ${join(work, "app", ".git", "worktrees", "app-feature")}\n`);
    const session = await parseOne([meta(uuid(1), { cwd: work }), ...userMessage("feature"), edit(join(worktree, "a.ts")), command(worktree, "pnpm build")]);
    expect(session.projectPath).toBe(worktree);
  });

  it("groups work in a plain folder below a parent cwd under that folder", async () => {
    mkdirSync(join(work, "notes"), { recursive: true });
    const session = await parseOne([meta(uuid(1), { cwd: work }), ...userMessage("write it up"), edit(join(work, "notes", "draft.md")), edit(join(work, "notes", "outline.md"))]);
    expect(session.projectPath).toBe(join(work, "notes"));
  });

  it("does not treat a loose file in the cwd as a project", async () => {
    const session = await parseOne([meta(uuid(1), { cwd: work }), ...userMessage("jot"), edit(join(work, "todo.md")), edit(join(work, "todo.md"))]);
    expect(session.projectPath).toBe(work);
  });

  it("keeps the cwd when there is no evidence of where the work happened", async () => {
    const session = await parseOne([meta(uuid(1), { cwd: work }), ...userMessage("what is a monad?")]);
    expect(session.projectPath).toBe(work);
  });
});

describe("codex home directories", () => {
  it("shortens the home directory in free text but keeps structural paths absolute", async () => {
    const home = homedir();
    const todo = join(home, "notes", "todo.md");
    const session = await parseOne([
      meta(uuid(1), { cwd: join(home, "hindsight-fixture-missing") }),
      ...userMessage(`look at ${todo} please`),
      event({
        type: "item_completed",
        thread_id: uuid(1),
        turn_id: "t1",
        item: { type: "CommandExecution", id: "c", command: ["/bin/bash", "-lc", `cat ${todo}`], parsed_cmd: [{ type: "read", cmd: `cat ${todo}`, name: "todo.md", path: todo }], status: "completed", exit_code: 0 },
      }),
      event({ type: "item_completed", thread_id: uuid(1), turn_id: "t1", item: { type: "FileChange", id: "f", status: "completed", changes: { [todo]: { type: "add", content: "x\n" } } } }),
    ]);
    // The store, the coach and cross-harness grouping need real paths; the renderer shortens them for display.
    expect(session.projectPath).toBe(join(home, "hindsight-fixture-missing"));
    expect(session.filesModified).toEqual([todo]);
    expect(session.toolCalls.map((call) => call.filePath)).toEqual([todo, todo]);
    expect(session.sourcePath.startsWith("/")).toBe(true);
    // What a person or an agent reads is free text, and never carries the username.
    expect(session.prompts[0]!.text).toBe("look at ~/notes/todo.md please");
    expect(session.toolCalls[0]!.command).toBe("cat ~/notes/todo.md");

    const [file] = await codexSource.discover({ roots: [tree.sessions] });
    const turns = await codexSource.excerpt(file!);
    expect(JSON.stringify(turns)).not.toContain(home + "/");
  });
});
