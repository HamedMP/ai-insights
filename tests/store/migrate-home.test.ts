import { lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { runNudge } from "../../src/nudge/command.js";
import { resolveHome } from "../../src/store/home.js";
import { MOVED_LINE, realMoveFs, settleHome, type MoveFs } from "../../src/store/migrate-home.js";
import { tempHome } from "./fixtures.js";

// Every test here works in a temporary folder standing in for the person's home. None touches the real one.
let user: string;
let cleanup: () => Promise<void>;
let current: string;
let legacy: string;

beforeEach(async () => {
  ({ home: user, cleanup } = await tempHome());
  current = join(user, ".ai-insights");
  legacy = join(user, ".hindsight");
});
afterEach(async () => cleanup());

/** A pre-0.2 store with a cached session and a report in it. */
function oldStore() {
  mkdirSync(join(legacy, "sessions", "claude-code"), { recursive: true });
  mkdirSync(join(legacy, "reports"), { recursive: true });
  writeFileSync(join(legacy, "sessions", "claude-code", "s1.json"), '{"id":"s1"}');
  writeFileSync(join(legacy, "reports", "report.html"), "<!doctype html>");
}
const read = (dir: string) => ({ session: readFileSync(join(dir, "sessions", "claude-code", "s1.json"), "utf8"), report: readFileSync(join(dir, "reports", "report.html"), "utf8") });
const exists = (path: string) => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};
/** The real filesystem, with chosen calls failing. */
function failing(fail: { rename?: NodeJS.ErrnoException["code"][]; symlink?: string }): MoveFs {
  const real = realMoveFs();
  const renames = [...(fail.rename ?? [])];
  return {
    kind: real.kind,
    rename: (from, to) => {
      const code = renames.shift();
      if (code) throw Object.assign(new Error(code), { code });
      real.rename(from, to);
    },
    symlink: (target, path) => {
      if (fail.symlink) throw Object.assign(new Error(fail.symlink), { code: fail.symlink });
      real.symlink(target, path);
    },
  };
}

describe("moving a pre-0.2 ~/.hindsight to ~/.ai-insights", () => {
  it("moves it once, keeps every file, and leaves ~/.hindsight pointing at the new folder", () => {
    oldStore();
    expect(settleHome({}, user)).toEqual({ home: current, moved: true });
    expect(read(current)).toEqual({ session: '{"id":"s1"}', report: "<!doctype html>" });
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(readlinkSync(legacy)).toBe(current);
    // The old path still works, for an older plugin's MCP server or a script.
    expect(read(legacy)).toEqual(read(current));
    expect(resolveHome({}, user)).toBe(current);
    // Once is enough: the next run finds ~/.ai-insights and does nothing.
    expect(settleHome({}, user)).toEqual({ home: current, moved: false });
  });

  it("does nothing on a new install with neither folder", () => {
    expect(settleHome({}, user)).toEqual({ home: current, moved: false });
    expect(exists(current) || exists(legacy)).toBe(false);
  });

  it("never merges: with both folders it uses ~/.ai-insights and leaves ~/.hindsight alone", () => {
    oldStore();
    mkdirSync(current);
    writeFileSync(join(current, "device.json"), "{}");
    expect(settleHome({}, user)).toEqual({ home: current, moved: false });
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(read(legacy).session).toBe('{"id":"s1"}');
    expect(exists(join(current, "sessions"))).toBe(false);
  });

  it("never moves when AI_INSIGHTS_HOME or HINDSIGHT_HOME decides the folder", () => {
    oldStore();
    expect(settleHome({ AI_INSIGHTS_HOME: join(user, "elsewhere") }, user)).toEqual({ home: join(user, "elsewhere"), moved: false });
    expect(settleHome({ HINDSIGHT_HOME: legacy }, user)).toEqual({ home: legacy, moved: false });
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(exists(current)).toBe(false);
  });

  it("leaves a ~/.hindsight that is a symlink or a file where it is", () => {
    mkdirSync(join(user, "real-store"));
    realMoveFs().symlink(join(user, "real-store"), legacy);
    expect(settleHome({}, user)).toEqual({ home: legacy, moved: false });
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(exists(current)).toBe(false);
  });

  it("keeps using ~/.hindsight, untouched, when the rename fails (another disk, no permission)", () => {
    for (const code of ["EXDEV", "EACCES", "EPERM", "EBUSY"] as const) {
      oldStore();
      expect(settleHome({}, user, failing({ rename: [code] })), code).toEqual({ home: legacy, moved: false });
      expect(lstatSync(legacy).isDirectory()).toBe(true);
      expect(read(legacy).session).toBe('{"id":"s1"}');
      expect(exists(current)).toBe(false);
    }
  });

  it("puts the folder back and keeps using ~/.hindsight when the symlink cannot be made (Windows without the right)", () => {
    oldStore();
    expect(settleHome({}, user, failing({ symlink: "EPERM" }))).toEqual({ home: legacy, moved: false });
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(read(legacy).session).toBe('{"id":"s1"}');
    expect(exists(current)).toBe(false);
  });

  it("keeps the data, complete, in ~/.ai-insights when neither the symlink nor the move back works, and says nothing", () => {
    oldStore();
    expect(settleHome({}, user, failing({ rename: [undefined as never, "EACCES"], symlink: "EPERM" }))).toEqual({ home: current, moved: false });
    expect(read(current).session).toBe('{"id":"s1"}');
    expect(exists(legacy)).toBe(false);
  });

  it("two first runs at once: one moves, the other finds the moved folder; nothing is lost or doubled", () => {
    oldStore();
    const real = realMoveFs();
    let other: ReturnType<typeof settleHome> | null = null;
    // The second run looks at both folders, then the first run moves everything before the second can rename.
    const late: MoveFs = {
      kind: real.kind,
      rename: (from, to) => {
        if (!other) other = settleHome({}, user);
        real.rename(from, to);
      },
      symlink: real.symlink,
    };
    const second = settleHome({}, user, late);
    expect(other).toEqual({ home: current, moved: true });
    expect(second).toEqual({ home: current, moved: false });
    expect(read(current)).toEqual({ session: '{"id":"s1"}', report: "<!doctype html>" });
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(realpathSync(legacy)).toBe(realpathSync(current));
  });

  it("two first runs at once, the other caught between the move and the symlink: it uses the moved folder", () => {
    oldStore();
    const real = realMoveFs();
    let other: ReturnType<typeof settleHome> | null = null;
    const slow: MoveFs = {
      kind: real.kind,
      rename: real.rename,
      symlink: (target, path) => {
        other = settleHome({}, user);
        real.symlink(target, path);
      },
    };
    expect(settleHome({}, user, slow)).toEqual({ home: current, moved: true });
    expect(other).toEqual({ home: current, moved: false });
    expect(read(legacy)).toEqual(read(current));
  });
});

describe("where the move happens", () => {
  let out: string;
  let err: string;
  const savedHome = process.env.HOME;
  beforeEach(() => {
    out = "";
    err = "";
    process.env.HOME = user;
  });
  afterEach(() => {
    process.env.HOME = savedHome;
  });
  const deps = () => ({ stdout: (t: string) => void (out += t), stderr: (t: string) => void (err += t), env: {} as NodeJS.ProcessEnv, sources: [], now: () => new Date("2026-11-15T00:00:00Z"), retentionPolicies: async () => new Map() });

  it("a CLI command moves it and says so in one line", async () => {
    oldStore();
    expect(await run(["doctor"], deps())).toBe(0);
    expect(err).toBe(`${MOVED_LINE}\n`);
    expect(out).toContain(`Store: ${current}`);
    expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
    err = "";
    expect(await run(["doctor"], deps())).toBe(0);
    expect(err).toBe("");
  });

  it("the session-start reminder never moves it", async () => {
    oldStore();
    await runNudge(["--format", "hook"], deps());
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(exists(current)).toBe(false);
  });

  it("the MCP server and help never move it", async () => {
    oldStore();
    expect(await run(["--help"], deps())).toBe(0);
    expect(await run(["mcp"], { ...deps(), startMcp: async () => {} })).toBe(0);
    expect(lstatSync(legacy).isDirectory()).toBe(true);
    expect(exists(current)).toBe(false);
    expect(err).toBe("");
  });
});
