/** Shell command helpers shared by the detectors that reason about what the agent ran. */

const CD_PREFIX = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/;
const ENV_PREFIX = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/;
const OUTPUT_TAIL = /\s*(?:2>&1|\|\s*(?:tail|head|grep|less|cat|tee)\b.*)$/;
const TIMEOUT_PREFIX = /^(?:timeout\s+\S+|time|npx\s+--yes|env)\s+/;

/**
 * The same intent written slightly differently should count as one command: the
 * agent often prefixes `cd repo &&`, sets env vars, or pipes output through `tail`.
 */
export function normalizeCommand(command: string): string {
  let text = command.replace(/\s+/g, " ").trim();
  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    text = text.replace(CD_PREFIX, "").replace(ENV_PREFIX, "").replace(TIMEOUT_PREFIX, "");
    text = text.replace(OUTPUT_TAIL, "").trim();
    if (text === before) break;
  }
  return text.slice(0, 160);
}

/** Commands that check work: tests, type checks, linters and builds. Broad on purpose, so a check is rarely missed. */
const CHECK_COMMAND =
  /\b(?:test|tests|vitest|jest|mocha|ava|pytest|tox|nox|rspec|phpunit|ctest|unittest|typecheck|type-check|tsc|mypy|pyright|check|clippy|lint|eslint|biome|ruff|flake8|vet|build|make|gradle|mvn|bazel|xcodebuild)\b/i;

export function isCheckCommand(command: string): boolean {
  return CHECK_COMMAND.test(command);
}

/** A check command worth quoting back to the person, e.g. `pnpm test`, rather than a bare `make`. */
export function isTestOrTypecheck(command: string): boolean {
  return /\b(?:test|tests|vitest|jest|pytest|typecheck|type-check|tsc|mypy|pyright|cargo check)\b/i.test(command);
}
