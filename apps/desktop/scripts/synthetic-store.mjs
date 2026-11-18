// An end-to-end run against the real CLI without anyone's real history:
//   node scripts/synthetic-store.mjs <empty dir> [path to ai-insights, default: a checkout's dist/cli/main.js]
//   AI_INSIGHTS_CLI=<dir>/ai-insights pnpm dev
// It writes made-up Claude Code transcripts (9 sessions over the last few days) under <dir>/.claude, and a
// launcher <dir>/ai-insights that runs the CLI with HOME and AI_INSIGHTS_HOME inside <dir>, so neither the
// real history nor the real ~/.ai-insights store is read or written.
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
if (!process.argv[2]) {
  console.error("usage: node scripts/synthetic-store.mjs <empty dir> [cli entry]");
  process.exit(64);
}
const home = resolve(process.argv[2]);
if (existsSync(home) && readdirSync(home).length > 0) {
  console.error(`${home} is not empty; pick a new folder`);
  process.exit(1);
}
const cli = resolve(process.argv[3] ?? fileURLToPath(new URL("../../../dist/cli/main.js", import.meta.url)));
if (!existsSync(cli)) {
  console.error(`no CLI at ${cli}; run pnpm build at the repo root first, or pass its path`);
  process.exit(1);
}
const now = Date.now();
let n = 0;
for (let s = 0; s < 9; s++) {
  const session = randomUUID();
  const start = now - (s * 13 + 1) * 3600_000; // spread over the last few days
  const lines = [];
  for (let t = 0; t < 12; t++) {
    const ts = new Date(start + t * 4 * 60_000).toISOString();
    const env = { uuid: `u${++n}`, parentUuid: null, sessionId: session, cwd: `/work/demo-${s % 3}`, gitBranch: "main", isSidechain: false, version: "2.0.0", timestamp: ts };
    lines.push({ ...env, type: "user", message: { role: "user", content: `synthetic prompt ${t}` } });
    const ts2 = new Date(start + t * 4 * 60_000 + 30_000).toISOString();
    lines.push({ ...env, uuid: `u${++n}`, timestamp: ts2, type: "assistant", requestId: `req-${n}`, message: { id: `msg-${n}`, type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 20000, cache_creation_input_tokens: 1500 } } });
  }
  const dir = join(home, ".claude", "projects", `-work-demo-${s % 3}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${session}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

const launcher = join(home, "ai-insights");
writeFileSync(launcher, `#!/bin/sh\nexport HOME='${home}' AI_INSIGHTS_HOME='${home}/.ai-insights'\nexec '${process.execPath}' '${cli}' "$@"\n`);
chmodSync(launcher, 0o755);
console.log(`AI_INSIGHTS_CLI=${launcher} pnpm dev`);
