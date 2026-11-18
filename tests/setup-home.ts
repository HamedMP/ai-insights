import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every test runs with a throwaway home folder, so nothing (the store move in src/store/migrate-home.ts above all)
// can ever touch the real ~/.hindsight or ~/.ai-insights of the machine running the tests.
const home = mkdtempSync(join(tmpdir(), "ai-insights-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
