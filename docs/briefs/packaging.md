# Brief: skills and multi-harness packaging

**You own:** `skills/**`, `scripts/generate-harness.mjs`, `scripts/install.sh`, `harness/**`, `plugin.json`, `.claude-plugin/**`, `.codex-plugin/**`, `.cursor-plugin/**`, `.mcp.json`, `mcp.json`, `pi/**`, `README.md`, `.github/**`, `tests/packaging/**`.

Goal: one canonical source that installs into Claude Code, Codex, Cursor, Pi and OpenCode. The model to follow is pstack in `~/.claude/plugins/marketplaces/cursor-plugins/` (`pstack/`, `harness/pstack/`, `scripts/generate-pstack-harness-trees.mjs`): canonical skills, generated per-harness trees, and a CI check that fails when the generated trees are stale. A working Claude Code + Codex example is `/home/hamed/projects/matrix-os/plugins/matrix-os/` with marketplaces at `/home/hamed/projects/matrix-os/.claude-plugin/marketplace.json` and `/home/hamed/projects/matrix-os/.agents/plugins/marketplace.json`.

**Skills** (`skills/<name>/SKILL.md`, frontmatter `name` and `description` only, name equals directory):
- `hindsight`: the main flow. Call `hindsight_scan`; show coverage; fetch findings; list sessions missing facets; for each (newest first, a sensible cap per run, say 30), read `hindsight_excerpt` and save a facet using only the fixed taxonomy values; write the narrative from the aggregate; call `hindsight_render`; give the person the report path and the three most useful findings. State plainly that the analysis runs in their own agent and nothing is uploaded. End with one line on Matrix OS for keeping long-term history.
- `hindsight-coach`: take the findings and suggestions and turn them into reviewable changes: propose diffs to the person's CLAUDE.md / AGENTS.md, features to enable, plugins to install. Always show the diff and ask before writing. Never apply automatically.
- `hindsight-setup`: check the MCP server is reachable, run `doctor`, explain what was found.
Write skills as instructions to a capable agent: goal, constraints, what good looks like. Harness-neutral wording in the canonical source (tools are named by their MCP name `hindsight_*`). The fixed taxonomy lives in `src/schema/types.ts`; reference the values exactly, and add a test that fails if a skill names a taxonomy value that is not in the contract.

**MCP launch** is `npx -y @matrix-os/hindsight mcp` everywhere, so no per-harness plugin-root variable is needed.

**Per harness** (details verified by earlier research; re-check against what is installed here):
- Claude Code: `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` (plugin at repo root or a generated tree), `skills/`, `.mcp.json` (`{"mcpServers": {"hindsight": {"command": "npx", "args": ["-y", "@matrix-os/hindsight", "mcp"]}}}`). Install: `/plugin marketplace add hamedmp/hindsight` then `/plugin install hindsight@hindsight`. Validate with `claude plugin validate`.
- Codex: `.codex-plugin/plugin.json` (`skills`, `mcpServers`, `interface` with `shortDescription` at most 30 characters) plus a portable root `plugin.json` (`$schema` https://agent-plugins.org/schemas/1.0.0/plugin.schema.json, OpenAI fields under `extensions["com.openai"]`, no top-level `skills`/`mcpServers` there) and `.agents/plugins/marketplace.json`. Keep both manifests in sync by generating them. `codex` 0.160 is installed here; its bundled references are under `~/.codex/plugins/cache/openai-curated-remote/plugin-creator/`. Install: `codex plugin marketplace add hamedmp/hindsight` then `codex plugin add hindsight@hindsight`.
- Cursor: `.cursor-plugin/plugin.json` (see pstack's) with `skills` and MCP config.
- Pi: a `pi` key in `package.json` pointing at `skills/`, plus a small extension (`pi/extension.ts`) calling `pi.registerMcpServer("hindsight", {command, args})`. Install: `pi install git:github.com/hamedmp/hindsight`. Pi is not installed here: mark this path untested. `package.json` belongs to the orchestrator: put the exact `pi` block you need in your report instead of editing it.
- OpenCode: no plugin. `scripts/install.sh` copies skills into `~/.agents/skills` and runs `opencode mcp add hindsight -- npx -y @matrix-os/hindsight mcp`. Not installed here: mark untested.
- `scripts/install.sh [--harness <name>|--all]` is the universal fallback: detect installed harnesses, copy skills to the right skills directory, register the MCP server with each harness's `mcp add` CLI, print what it did. Idempotent, no `sudo`, no `curl | sh` of anything else, safe to re-run.

**Generator and CI:** `scripts/generate-harness.mjs` produces every manifest and tree from one small canonical config (name, version from `package.json`, description, skills, MCP command). `--check` exits non-zero when the committed output is stale. `.github/workflows/ci.yml` runs typecheck, tests and the `--check`.

**README:** what it is, a screenshot placeholder, install per harness (one short block each, untested paths labelled), what it reads, the privacy promise (local only, analysis in your own agent, redaction), how the two-layer analysis works, and the Matrix OS section. Short and concrete; no hype.

Verify what you can on this machine: `claude plugin validate .`, `claude --plugin-dir .` loads the skills, `codex plugin marketplace add <local path>` accepts it. Report exactly which harness paths were verified and which are untested.
