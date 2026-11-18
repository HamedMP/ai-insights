import { configDefaults, defineConfig } from "vitest/config";

// tests/site-render needs site/'s own dependencies and runs with vitest.site.config.ts (`pnpm test:site`).
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], exclude: [...configDefaults.exclude, "tests/site-render/**"], testTimeout: 20_000, setupFiles: ["tests/setup-home.ts"] } });
