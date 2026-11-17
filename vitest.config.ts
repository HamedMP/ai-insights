import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// "@/..." is the site's own import alias (site/tsconfig.json), so site components can be rendered in tests/site.
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./site", import.meta.url)) } }, test: { include: ["tests/**/*.test.ts"], testTimeout: 20_000 } });
