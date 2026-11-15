#!/usr/bin/env node
// Generates every harness manifest and the installable plugin tree from one config, package.json and skills/.
// `--check` writes nothing and exits 1 when the committed output differs from what would be generated.

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMMAND = "node scripts/generate-harness.mjs";
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const CONFIG = {
  name: "hindsight",
  displayName: "Hindsight",
  version: pkg.version,
  description: pkg.description,
  author: { name: "Matrix OS", url: "https://matrix-os.com" },
  homepage: "https://github.com/hamedmp/hindsight",
  repository: "https://github.com/hamedmp/hindsight",
  license: pkg.license,
  keywords: ["insights", "history", "usage", "cost", "claude-code", "codex", "mcp", "agent-skills"],
  // Codex shows this as the listing subtitle and truncates past 30 characters.
  shortDescription: "Learn from your agent history",
  longDescription:
    "Reads your local Claude Code and Codex history, finds what slows you down and what it costs, and writes a private HTML report with tips. The analysis runs in your own agent; nothing is uploaded.",
  defaultPrompts: [
    "Run hindsight on my agent history.",
    "What slows me down when I work with agents?",
    "Turn my hindsight findings into CLAUDE.md edits.",
  ],
  // `npx` resolves the published package in every harness, so no manifest needs a plugin-root variable.
  mcp: { name: "hindsight", command: "npx", args: ["-y", pkg.name, "mcp"] },
};

// Claude Code and Codex install this directory. It holds only what a plugin needs, so an install does not copy src/ or node_modules.
const TREE = "harness/hindsight";
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === ".DS_Store") return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const posix = (path) => path.split(sep).join("/");
const asJson = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const file = (path) => ({ bytes: readFileSync(path), executable: (statSync(path).mode & 0o111) !== 0 });

function checkSkills() {
  const problems = [];
  const skills = readdirSync(join(ROOT, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  for (const skill of skills) {
    const path = join(ROOT, "skills", skill, "SKILL.md");
    if (!existsSync(path)) {
      problems.push(`skills/${skill} has no SKILL.md`);
      continue;
    }
    const block = readFileSync(path, "utf8").match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    if (!block) {
      problems.push(`skills/${skill}/SKILL.md has no frontmatter`);
      continue;
    }
    const keys = [...block.matchAll(/^([A-Za-z_-]+):/gm)].map((match) => match[1]).sort();
    const name = block.match(/^name:(.*)$/m)?.[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    // Harnesses list a skill by its frontmatter name but some invoke it by folder, so the two must agree.
    if (name !== skill) problems.push(`skills/${skill}/SKILL.md has name ${JSON.stringify(name ?? "")}, not its folder name`);
    if (keys.join(",") !== "description,name") problems.push(`skills/${skill}/SKILL.md frontmatter must hold only name and description, has ${keys.join(", ")}`);
    if (!SKILL_NAME.test(skill) || skill.length > 64) problems.push(`skills/${skill} is not lowercase words joined by hyphens, at most 64 characters`);
  }
  if (CONFIG.shortDescription.length > 30) problems.push(`shortDescription is ${CONFIG.shortDescription.length} characters; Codex allows 30`);
  if (CONFIG.defaultPrompts.length > 3) problems.push("Codex shows at most three default prompts");
  return problems;
}

function render() {
  const { name, displayName, version, description, author, homepage, repository, license, keywords } = CONFIG;
  const identity = { name, version, description, author, homepage, repository, license, keywords };
  const server = { command: CONFIG.mcp.command, args: CONFIG.mcp.args };
  const codexInterface = {
    displayName,
    shortDescription: CONFIG.shortDescription,
    longDescription: CONFIG.longDescription,
    developerName: author.name,
    category: "Developer Tools",
    capabilities: ["Interactive", "Read", "Write"],
    websiteURL: homepage,
    defaultPrompt: CONFIG.defaultPrompts,
  };

  const files = new Map();
  const put = (path, bytes, executable = false) => files.set(path, { bytes, executable });

  put(`${TREE}/.claude-plugin/plugin.json`, asJson({ ...identity, skills: "./skills/", mcpServers: "./.mcp.json" }));
  put(`${TREE}/.codex-plugin/plugin.json`, asJson({ ...identity, skills: "./skills/", mcpServers: "./.mcp.json", interface: codexInterface }));
  put(
    `${TREE}/plugin.json`,
    asJson({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      ...identity,
      extensions: { "com.openai": { interface: codexInterface } },
    }),
  );
  put(`${TREE}/.mcp.json`, asJson({ mcpServers: { [CONFIG.mcp.name]: server } }));
  put(
    `${TREE}/mcp.json`,
    asJson({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: { [CONFIG.mcp.name]: { type: "stdio", ...server } },
    }),
  );
  for (const path of walk(join(ROOT, "skills"))) files.set(`${TREE}/${posix(relative(ROOT, path))}`, file(path));
  files.set(`${TREE}/LICENSE`, file(join(ROOT, "LICENSE")));
  put(
    `${TREE}/README.md`,
    Buffer.from(
      `# ${displayName} plugin\n\n${description}\n\n` +
        "Claude Code:\n\n```\n/plugin install hindsight --marketplace hamedmp/hindsight\n```\n\n" +
        "Codex:\n\n```\ncodex plugin marketplace add hamedmp/hindsight\ncodex plugin add hindsight@hindsight\n```\n\n" +
        `This is the installable plugin for Claude Code and Codex. It is generated from \`skills/\` and \`scripts/generate-harness.mjs\` in ${repository}; do not edit it by hand.\n`,
    ),
  );
  put(
    "harness/README.md",
    Buffer.from(
      "# Generated harness output\n\n" +
        `\`hindsight/\` is generated by \`${COMMAND}\` from \`skills/\`, \`package.json\` and the config at the top of that script. Do not edit it by hand.\n\n` +
        "Claude Code and Codex install `hindsight/` through `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. " +
        "Cursor and Pi use the repository root (`.cursor-plugin/plugin.json`, the `pi` block in `package.json`).\n\n" +
        `After changing a skill, the version or the config, run \`${COMMAND}\` and commit the result. CI runs it with \`--check\`.\n`,
    ),
  );

  put(
    ".claude-plugin/marketplace.json",
    asJson({
      name,
      owner: { name: author.name },
      metadata: { description: "Hindsight: local insights from your AI coding-agent history" },
      plugins: [{ name, source: `./${TREE}`, description, version, category: "productivity" }],
    }),
  );
  put(
    ".agents/plugins/marketplace.json",
    asJson({
      name,
      interface: { displayName },
      plugins: [
        {
          name,
          source: { source: "local", path: `./${TREE}` },
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer Tools",
        },
      ],
    }),
  );
  put(
    ".cursor-plugin/plugin.json",
    asJson({
      name,
      displayName,
      version,
      description,
      author: { name: author.name },
      homepage,
      repository,
      license,
      keywords,
      category: "developer-tools",
      tags: ["insights", "history", "mcp"],
      skills: "./skills/",
      mcpServers: "./mcp.json",
    }),
  );
  put("mcp.json", asJson({ mcpServers: { [CONFIG.mcp.name]: server } }));
  return files;
}

const problems = checkSkills();
for (const problem of problems) console.log(`FAIL ${problem}`);
if (problems.length > 0) process.exit(1);

const files = render();
// Every generated path outside the tree is a single file; inside the tree, files on disk that we would not write are drift too.
const onDisk = new Map();
for (const path of files.keys()) if (!path.startsWith(`${TREE}/`) && existsSync(join(ROOT, path))) onDisk.set(path, file(join(ROOT, path)));
if (existsSync(join(ROOT, TREE))) for (const path of walk(join(ROOT, TREE))) onDisk.set(posix(relative(ROOT, path)), file(path));

if (process.argv.includes("--check")) {
  const drifted = [...new Set([...files.keys(), ...onDisk.keys()])].sort().filter((path) => {
    const [want, have] = [files.get(path), onDisk.get(path)];
    return !want || !have || !want.bytes.equals(have.bytes) || want.executable !== have.executable;
  });
  for (const path of drifted.slice(0, 30)) console.log(path);
  if (drifted.length > 0) {
    console.log(`Generated harness files are out of date. Run \`${COMMAND}\` and commit the result.`);
    process.exit(1);
  }
  console.log("Generated harness files are up to date.");
} else {
  rmSync(join(ROOT, TREE), { recursive: true, force: true });
  for (const [path, { bytes, executable }] of files) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), bytes);
    chmodSync(join(ROOT, path), executable ? 0o755 : 0o644);
  }
  console.log(`Wrote ${files.size} generated files.`);
}
