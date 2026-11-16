import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_GIT_FILE_BYTES, resolveProjectRoots } from "../../src/store/project-root.js";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "ai-insights-roots-"));
});
afterEach(async () => rm(base, { recursive: true, force: true }));

/** A main checkout with a `.git` directory and one linked worktree registered the way git does it. */
async function repoWithWorktree(options: { commondir?: boolean } = {}) {
  const main = join(base, "repo");
  const worktree = join(base, "wt", "feature");
  const admin = join(main, ".git", "worktrees", "feature");
  await mkdir(join(main, "packages", "web"), { recursive: true });
  await mkdir(admin, { recursive: true });
  await mkdir(join(worktree, "src"), { recursive: true });
  await writeFile(join(worktree, ".git"), `gitdir: ${admin}\n`);
  await writeFile(join(admin, "gitdir"), `${join(worktree, ".git")}\n`);
  if (options.commondir !== false) await writeFile(join(admin, "commondir"), "../..\n");
  return { main, worktree, admin };
}

describe("resolveProjectRoots", () => {
  it("uses the folder holding a .git directory as the root, for the folder and anything inside it", async () => {
    const { main } = await repoWithWorktree();
    const roots = await resolveProjectRoots([main, join(main, "packages", "web")]);
    expect(roots.get(main)).toBe(main);
    expect(roots.get(join(main, "packages", "web"))).toBe(main);
  });

  it("folds a linked worktree into its main checkout through the .git file and commondir", async () => {
    const { main, worktree } = await repoWithWorktree();
    const roots = await resolveProjectRoots([worktree, join(worktree, "src")]);
    expect(roots.get(worktree)).toBe(main);
    expect(roots.get(join(worktree, "src"))).toBe(main);
  });

  it("still finds the main checkout from the worktrees/<name> path when commondir is missing", async () => {
    const { main, worktree } = await repoWithWorktree({ commondir: false });
    const roots = await resolveProjectRoots([worktree]);
    expect(roots.get(worktree)).toBe(main);
  });

  it("treats a .git file that is not a worktree link (a submodule) as its own root", async () => {
    const sub = join(base, "super", "vendor", "lib");
    await mkdir(join(base, "super", ".git", "modules", "lib"), { recursive: true });
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, ".git"), "gitdir: ../../.git/modules/lib\n");
    const roots = await resolveProjectRoots([sub]);
    expect(roots.get(sub)).toBe(sub);
  });

  it("leaves the root absent for a folder that no longer exists and is not a known worktree", async () => {
    const roots = await resolveProjectRoots([join(base, "gone")]);
    expect(roots.has(join(base, "gone"))).toBe(true);
    expect(roots.get(join(base, "gone"))).toBeUndefined();
  });

  it("leaves the root absent for a folder outside any repository", async () => {
    const plain = join(base, "plain");
    await mkdir(plain);
    const roots = await resolveProjectRoots([plain]);
    expect(roots.get(plain)).toBeUndefined();
  });

  it("maps a deleted worktree to its main checkout when another session resolved that root and git still lists it", async () => {
    const { main, worktree } = await repoWithWorktree();
    await rm(worktree, { recursive: true, force: true });
    const roots = await resolveProjectRoots([main, worktree, join(worktree, "src")]);
    expect(roots.get(worktree)).toBe(main);
    expect(roots.get(join(worktree, "src"))).toBe(main);
  });

  it("does not guess a root for a deleted worktree when no scanned session reached its main checkout", async () => {
    const { worktree } = await repoWithWorktree();
    await rm(worktree, { recursive: true, force: true });
    const roots = await resolveProjectRoots([worktree]);
    expect(roots.get(worktree)).toBeUndefined();
  });

  it("also trusts roots it already knew from the cache when placing a deleted worktree", async () => {
    const { main, worktree } = await repoWithWorktree();
    await rm(worktree, { recursive: true, force: true });
    const roots = await resolveProjectRoots([worktree], { knownRoots: [main] });
    expect(roots.get(worktree)).toBe(main);
  });

  it("refuses an oversized .git file without reading it and does not throw", async () => {
    const hostile = join(base, "hostile");
    await mkdir(hostile);
    await writeFile(join(hostile, ".git"), `gitdir: ${"x".repeat(MAX_GIT_FILE_BYTES * 4)}\n`);
    const roots = await resolveProjectRoots([hostile]);
    expect(roots.get(hostile)).toBeUndefined();
  });

  it("ignores a .git file with no gitdir line or a gitdir that leads nowhere", async () => {
    const junk = join(base, "junk");
    const dangling = join(base, "dangling");
    await mkdir(junk);
    await mkdir(dangling);
    await writeFile(join(junk, ".git"), "\u0000\u0001 not a git file");
    await writeFile(join(dangling, ".git"), `gitdir: ${join(base, "nowhere", ".git", "worktrees", "x")}\n`);
    const roots = await resolveProjectRoots([junk, dangling]);
    expect(roots.get(junk)).toBeUndefined();
    expect(roots.get(dangling)).toBeUndefined();
  });

  it("ignores relative and empty paths instead of resolving them against the current directory", async () => {
    const roots = await resolveProjectRoots(["relative/path", ""]);
    expect(roots.get("relative/path")).toBeUndefined();
    expect(roots.get("")).toBeUndefined();
  });
});
