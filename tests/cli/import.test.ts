import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/main.js";
import { conversation, exportJson, makeZip } from "../sources/claude-chat/fixtures.js";

let dir: string;
let out: string;
let err: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-insights-cli-import-"));
  out = "";
  err = "";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const cli = (argv: string[]) =>
  run(argv, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    env: { AI_INSIGHTS_HOME: join(dir, "home") },
    now: () => new Date("2026-11-15T00:00:00Z"),
  });

describe("ai-insights import", () => {
  it("imports a Claude export, lists it and removes it", async () => {
    const zip = join(dir, "export.zip");
    writeFileSync(zip, makeZip([{ name: "conversations.json", data: exportJson([conversation()]) }]));
    expect(await cli(["import", "claude", zip])).toBe(0);
    expect(out).toContain("Imported your Claude chat history");
    expect(out).toContain("1 conversation, 2026-08-03 to 2026-08-03");
    expect(out).toMatch(/unmeasured/);
    out = "";
    expect(await cli(["import", "--list"])).toBe(0);
    expect(out).toContain("Claude chat  1 conversation,");
    out = "";
    expect(await cli(["import", "--remove", "claude"])).toBe(0);
    expect(out).toContain("Removed the Claude chat import");
    out = "";
    expect(await cli(["import", "--list"])).toBe(0);
    expect(out).toContain("Nothing imported yet");
  });

  it("needs an explicit source and path, and explains what went wrong", async () => {
    expect(await cli(["import"])).toBe(2);
    expect(await cli(["import", "chatgpt", "x.zip"])).toBe(2);
    expect(await cli(["import", "claude"])).toBe(2);
    expect(await cli(["import", "claude", "a", "b"])).toBe(2);
    expect(await cli(["import", "--remove"])).toBe(2);
    expect(await cli(["import", "--bogus"])).toBe(2);
    expect(err).toContain("ai-insights import --help");
    err = "";
    expect(await cli(["import", "claude", join(dir, "missing.zip")])).toBe(1);
    expect(err).toContain("nothing at");
    expect(await cli(["import", "--help"])).toBe(0);
    expect(out).toContain("ai-insights import claude <path>");
  });

  it("the main help names the import command", async () => {
    expect(await cli(["--help"])).toBe(0);
    expect(out).toContain("ai-insights import claude <path>");
  });
});
