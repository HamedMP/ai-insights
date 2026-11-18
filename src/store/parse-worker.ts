import { parentPort } from "node:worker_threads";
import { readClaudeUsage } from "../sources/claude/usage.js";
import { buildRollout } from "../sources/codex/parse.js";
import { parseFile } from "./parse-file.js";
import type { WorkerTask } from "./parse-pool.js";

// The worker side of ParsePool: one task per message, answered with the finished value (structured-cloned).

async function perform(task: WorkerTask): Promise<unknown> {
  if (task.kind === "rollout") return buildRollout(task.path, task.mtimeMs);
  if (task.kind === "usage") return readClaudeUsage(task.file);
  return parseFile(task.file, task.options);
}

parentPort?.on("message", (message: { id: number; task: WorkerTask }) => {
  perform(message.task).then(
    (value) => parentPort?.postMessage({ id: message.id, value }),
    () => parentPort?.postMessage({ id: message.id, failed: true }),
  );
});
