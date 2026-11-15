#!/usr/bin/env node
// Write the synthetic fixture reports to HTML files so a person can open them.
// Usage: node scripts/preview-report.mjs [outDir] [report.json ...]
// Extra report.json paths (for example a real one from ~/.hindsight/reports) render as report-real-<n>.html.
// Needs Node 22.18+ (built-in TypeScript type stripping and module.registerHooks).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (typeof nodeModule.registerHooks !== "function") {
  console.error("preview-report needs Node 22.18 or newer (module.registerHooks). Run the tests instead: pnpm exec vitest run tests/render");
  process.exit(1);
}

// Sources import siblings as `./x.js` (the compiled name); resolve those to the `.ts` file on disk.
nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

const { renderReport } = await import("../src/render/index.ts");
const fixtures = await import("../tests/render/fixtures.ts");

const outDir = process.argv[2] ?? join(tmpdir(), "hindsight-preview");
mkdirSync(outDir, { recursive: true });

const variants = {
  "report-full.html": fixtures.makeReport(),
  "report-first-run.html": fixtures.makeDeterministicReport(),
  "report-empty.html": fixtures.makeEmptyReport(),
  "report-year.html": fixtures.makeYearReport(),
  "report-hostile.html": fixtures.makeHostileReport(),
};

process.argv.slice(3).forEach((path, index) => {
  variants[`report-real-${index + 1}.html`] = JSON.parse(readFileSync(path, "utf8"));
});

for (const [name, report] of Object.entries(variants)) {
  const path = join(outDir, name);
  const html = renderReport(report);
  writeFileSync(path, html);
  console.log(`${(Buffer.byteLength(html) / 1024).toFixed(0).padStart(5)} KB  file://${path}`);
}
