import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the public site", () => {
  const index = read("site/index.html");
  const demo = read("site/demo/report.html");

  it("loads nothing from the network: no scripts, no remote stylesheets, images or fonts", () => {
    expect(index).not.toMatch(/<script/i);
    expect(index).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(index).not.toMatch(/\b(?:src|srcset)="(?:https?:)?\/\//i);
    expect(index).not.toMatch(/url\((?:["']?)(?:https?:)?\/\//i);
    expect(index).toContain("default-src 'none'");
  });

  it("references only files that are published with it, by relative path", () => {
    const local = [...index.matchAll(/\b(?:src|href)="(?!https?:|#|\.\/")([^"]+)"/g)].map((match) => match[1]!);
    expect(local).toContain("demo/report.html");
    expect(local).toContain("assets/report.png");
    for (const path of local) expect(existsSync(join(ROOT, "site", path)), path).toBe(true);
  });

  it("states only the sources Hindsight parses today and the README's install commands", () => {
    expect(index).toContain("/plugin marketplace add hamedmp/hindsight");
    expect(index).toContain("/plugin install hindsight@hindsight");
    expect(read("README.md")).toContain("/plugin install hindsight@hindsight");
    expect(index).not.toMatch(/Cursor|OpenCode|\bPi\b/);
  });

  it("ships a sample report built from invented data, with nothing from the machine that built it", () => {
    expect(demo).toContain("acme-api");
    expect(demo).not.toContain(homedir());
    const name = userInfo().username;
    if (name.length >= 3) expect(demo).not.toMatch(new RegExp(`[/\\\\]${name}[/\\\\]`));
    expect(demo).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  });
});
