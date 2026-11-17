import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Site component tests: they render site/ React components, so they need site/'s own dependencies
// (`pnpm --dir site install`). The root suite (vitest.config.ts) stays free of them; CI runs this in the `site` job.
// "@/..." is the site's import alias (site/tsconfig.json).
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./site", import.meta.url)) } }, test: { include: ["tests/site-render/**/*.test.ts"], testTimeout: 20_000 } });
