import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".tsx") ? [relative(ROOT, join(ROOT, path))] : [];
  });
}

/** Solid dark or deep-coloured fills that carry light text. Translucent variants (`bg-[#141210]/70`) are decoration. */
const DARK_FILL = /(?:^|\s)(?:bg-\[#(?:0e0d0c|141210|17140f|3d1bb3)\]|bg-foreground)(?=\s|$)/;

describe("selected text on the site", () => {
  it("paints an opaque highlight with its own ink, so selected text never turns dark on a dark block", () => {
    const css = read("site/app/globals.css");
    const rule = css.match(/::selection\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("background: var(--selection)");
    expect(rule).toContain("color: var(--selection-foreground)");
    for (const scope of [":root", ".dark", ".on-dark"]) {
      const block = css.match(new RegExp(`(?:^|\\n)${scope.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
      expect(block, scope).toMatch(/--selection: #[0-9a-f]{6};/);
      expect(block, scope).toMatch(/--selection-foreground: #[0-9a-f]{6};/);
    }
  });

  it("marks every dark block with on-dark so its highlight is the light-on-orange one", () => {
    const missing: string[] = [];
    for (const path of [...sources("site/app"), ...sources("site/components")]) {
      for (const match of read(path).matchAll(/className=\{?(?:cn\()?["`]([^"`]*)["`]/g)) {
        const classes = match[1] ?? "";
        if (DARK_FILL.test(classes) && /text-(?:white|background|\[#f)/.test(classes) && !/(?:^|\s)on-dark(?=\s|$)/.test(classes)) missing.push(`${path}: ${classes.slice(0, 80)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
