import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `src` transpiled to JavaScript in a temporary folder inside the repo (so `zod` still resolves), for tests that
 * need real worker threads: a worker runs plain Node, which cannot load the TypeScript sources Vitest serves.
 */
export function compileSources(): { dir: string; url: (path: string) => URL; cleanup: () => void } {
  const cache = join(ROOT, "node_modules", ".cache");
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(join(cache, "ai-insights-worker-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const src = join(ROOT, "src");
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        const output = ts.transpileModule(readFileSync(path, "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: false },
        }).outputText;
        const target = join(dir, relative(src, path)).replace(/\.ts$/, ".js");
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, output);
      }
    }
  };
  walk(src);
  return { dir, url: (path) => pathToFileURL(join(dir, path)), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
