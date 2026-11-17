import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_LABELS, detectAgents, type AgentStatus } from "../../src/cli/agents.js";
import { executePlans, installPlan, uninstallPlan } from "../../src/cli/install.js";
import { OFFER_FILE } from "../../src/cli/install-offer.js";
import { run, type CliDeps } from "../../src/cli/main.js";
import type { Answer } from "../../src/cli/open.js";
import type { SpawnResult, Spawner } from "../../src/cli/spawn.js";
import { fakeBuildReport, fakeRenderReport, fakeSource, makeSession, tempHome } from "../store/fixtures.js";

// Nothing here starts a real agent CLI: every install goes through a recording spawner.

let home: string;
let cleanup: () => Promise<void>;
let out: string;
let spawned: string[];
let answers: Answer[];
let asked: string[];

const ok: SpawnResult = { ok: true, code: 0, timedOut: false, stdout: "", stderr: "" };

function recorder(results: Record<string, SpawnResult> = {}): Spawner {
  return async (command, args) => {
    const line = [command, ...args].join(" ");
    spawned.push(line);
    return results[line] ?? ok;
  };
}

function agent(id: AgentStatus["id"], fields: Partial<AgentStatus> = {}): AgentStatus {
  const cli = id === "claude-code" ? "claude" : id;
  return { id, label: AGENT_LABELS[id], present: true, command: `/bin/${cli}`, plugin: id === "claude-code" || id === "codex" ? "missing" : "unknown", marketplace: false, legacy: false, ...fields };
}

const bothMissing = async () => [agent("claude-code"), agent("codex"), agent("cursor", { present: false }), agent("opencode", { present: false }), agent("pi", { present: false })];

function deps(overrides: Partial<CliDeps> = {}): Partial<CliDeps> {
  return {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      out += text;
    },
    env: { AI_INSIGHTS_HOME: home },
    sources: [fakeSource("claude-code", [makeSession({ id: "c1" })])],
    buildReport: fakeBuildReport(),
    renderReport: fakeRenderReport,
    now: () => new Date("2026-11-15T12:00:00Z"),
    timeZone: "UTC",
    openFile: async () => undefined,
    retentionPolicies: async () => new Map(),
    terminal: { isTTY: true, columns: 100, stdin: true, stderr: false },
    prompt: async (question) => {
      asked.push(question);
      return answers.shift() ?? "no";
    },
    spawner: recorder(),
    detectAgents: bothMissing,
    ...overrides,
  };
}

beforeEach(async () => {
  ({ home, cleanup } = await tempHome());
  out = "";
  spawned = [];
  answers = [];
  asked = [];
});
afterEach(async () => cleanup());

describe("finding agents and the plugin", () => {
  async function fakeMachine(files: Record<string, string>, onPath: string[]) {
    const user = join(home, "user");
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(user, path, ".."), { recursive: true });
      await writeFile(join(user, path), text);
    }
    const bin = join(home, "bin");
    await mkdir(bin, { recursive: true });
    for (const name of onPath) await writeFile(join(bin, name), "");
    return detectAgents({ env: { PATH: bin }, platform: "linux", home: user });
  }

  it("sees which agents are installed and which already have the plugin, from their own files", async () => {
    const agents = await fakeMachine(
      {
        ".claude/plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "hindsight@hindsight": [{}] } }),
        ".claude/plugins/known_marketplaces.json": JSON.stringify({ "ai-insights": {} }),
        ".codex/config.toml": '[marketplaces.ai-insights]\nsource = "x"\n\n[plugins."ai-insights@ai-insights"]\nenabled = true\n',
      },
      ["claude", "codex"],
    );
    const byId = Object.fromEntries(agents.map((entry) => [entry.id, entry]));
    expect(byId["claude-code"]).toMatchObject({ present: true, plugin: "missing", marketplace: true, legacy: true });
    expect(byId.codex).toMatchObject({ present: true, plugin: "installed", marketplace: true });
    expect(byId.pi).toMatchObject({ present: false });
  });

  it("treats unreadable or odd config as not installed rather than failing", async () => {
    const agents = await fakeMachine({ ".claude/plugins/installed_plugins.json": "{not json", ".codex/config.toml": "# [plugins.\"ai-insights@ai-insights\"]\n" }, ["claude", "codex"]);
    expect(agents.find((entry) => entry.id === "claude-code")?.plugin).toBe("missing");
    expect(agents.find((entry) => entry.id === "codex")?.plugin).toBe("missing");
  });
});

describe("the install plan", () => {
  it("uses each agent's own plugin commands, adding the marketplace only when it is missing", () => {
    const plans = installPlan([agent("claude-code"), agent("codex", { marketplace: true })]);
    expect(plans.flatMap((plan) => plan.steps.map((step) => step.display))).toEqual([
      "claude plugin marketplace add hamedmp/ai-insights",
      "claude plugin install ai-insights@ai-insights --scope user",
      "codex plugin add ai-insights@ai-insights",
    ]);
  });

  it("does nothing where the plugin is already there, and says how to update", () => {
    const [plan] = installPlan([agent("claude-code", { plugin: "installed", marketplace: true })]);
    expect(plan?.action).toBe("done");
    expect(plan?.notes.join(" ")).toContain("claude plugin update ai-insights@ai-insights");
  });

  it("prints steps for agents without a tested plugin command instead of editing their config", () => {
    const [plan] = installPlan([agent("pi")]);
    expect(plan).toMatchObject({ action: "manual", steps: [] });
    expect(plan?.manual.join(" ")).toContain("pi install git:github.com/hamedmp/ai-insights");
  });

  it("points out the pre-0.2 plugin so the person can remove it", () => {
    const [plan] = installPlan([agent("claude-code", { legacy: true })]);
    expect(plan?.notes.join(" ")).toContain("claude plugin uninstall hindsight@hindsight");
  });

  it("uninstall removes the plugin, then the marketplace it came from", () => {
    const plans = uninstallPlan([agent("claude-code", { plugin: "installed", marketplace: true }), agent("codex", { plugin: "installed", marketplace: true })]);
    expect(plans.flatMap((plan) => plan.steps.map((step) => step.display))).toEqual([
      "claude plugin uninstall ai-insights@ai-insights --scope user",
      "claude plugin marketplace remove ai-insights",
      "codex plugin remove ai-insights@ai-insights",
      "codex plugin marketplace remove ai-insights",
    ]);
  });
});

describe("running the plan", () => {
  it("reports a failed step in one line, stops that agent, and still sets up the others", async () => {
    const lines: string[] = [];
    const spawner = recorder({ "/bin/claude plugin marketplace add hamedmp/ai-insights": { ok: false, code: 1, timedOut: false, stdout: "", stderr: "fatal: could not reach github.com\n" } });
    const outcomes = await executePlans(installPlan([agent("claude-code"), agent("codex")]), spawner, {}, (line) => lines.push(line));
    expect(spawned).toEqual(["/bin/claude plugin marketplace add hamedmp/ai-insights", "/bin/codex plugin marketplace add hamedmp/ai-insights", "/bin/codex plugin add ai-insights@ai-insights"]);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, true, true]);
    expect(lines.join("\n")).toContain("failed: exit code 1: fatal: could not reach github.com");
  });

  it("turns a timeout or a spawner that throws into a reported failure", async () => {
    const lines: string[] = [];
    const timeout: Spawner = async () => ({ ok: false, code: null, timedOut: true, stdout: "", stderr: "" });
    await executePlans(installPlan([agent("codex", { marketplace: true })]), timeout, {}, (line) => lines.push(line));
    expect(lines.join("\n")).toContain("timed out after 120s");
    const throwing: Spawner = async () => {
      throw new Error("spawn EACCES");
    };
    const outcomes = await executePlans(installPlan([agent("codex", { marketplace: true })]), throwing, {}, () => undefined);
    expect(outcomes[0]).toMatchObject({ ok: false, detail: "could not start (spawn EACCES)" });
  });
});

describe("ai-insights install", () => {
  it("--dry-run prints the exact commands and runs none", async () => {
    expect(await run(["install", "--dry-run"], deps())).toBe(0);
    expect(out).toContain("claude plugin install ai-insights@ai-insights --scope user");
    expect(out).toContain("Dry run: nothing was changed.");
    expect(spawned).toEqual([]);
  });

  it("will not run anything unattended without --yes", async () => {
    expect(await run(["install"], deps({ terminal: { isTTY: false } }))).toBe(1);
    expect(out).toContain("--yes");
    expect(spawned).toEqual([]);
  });

  it("asks once on a terminal, and runs the commands it showed after a yes", async () => {
    answers = ["yes"];
    expect(await run(["install"], deps())).toBe(0);
    expect(asked).toEqual(["Run these commands? [Y/n]"]);
    expect(spawned).toHaveLength(4);
    expect(out).toContain("AI Insights itself sends nothing");
    expect(out).toContain("/analyze-ai-usage");
  });

  it("--harness limits it to one agent, and names an agent that is not installed", async () => {
    expect(await run(["install", "--yes", "--harness", "codex"], deps())).toBe(0);
    expect(spawned.every((line) => line.startsWith("/bin/codex"))).toBe(true);
    out = "";
    expect(await run(["install", "--yes", "--harness", "pi"], deps())).toBe(1);
    expect(out).toContain("Pi: not found on this machine");
  });

  it("rejects an unknown agent name with usage help", async () => {
    expect(await run(["install", "--harness", "vim"], deps())).toBe(2);
    expect(out).toContain("--harness must be one of");
  });

  it("uninstall runs the removal commands and keeps the report and cache", async () => {
    const installed = async () => [agent("claude-code", { plugin: "installed", marketplace: true })];
    expect(await run(["uninstall", "--yes"], deps({ detectAgents: installed }))).toBe(0);
    expect(spawned).toEqual(["/bin/claude plugin uninstall ai-insights@ai-insights --scope user", "/bin/claude plugin marketplace remove ai-insights"]);
    expect(out).toContain("left as they are");
  });
});

describe("the offer after a normal run", () => {
  it("asks once after the report, naming what it adds and where, and installs on yes", async () => {
    answers = ["no", "yes"];
    expect(await run([], deps())).toBe(0);
    expect(asked).toEqual(["Open the report in your browser? [Y/n]", "Install it now? [Y/n]"]);
    expect(out).toContain("Add AI Insights to Claude Code and Codex? It installs the ai-insights plugin:");
    expect(out).toContain("analyze-ai-usage");
    expect(out).toContain("ai-insights-setup), so you can run a review");
    expect(spawned).toHaveLength(4);
  });

  it("remembers a no for 30 days, then asks again", async () => {
    answers = ["no", "no"];
    await run([], deps());
    expect(JSON.parse(await readFile(join(home, OFFER_FILE), "utf8"))).toMatchObject({ declinedAt: "2026-11-15T12:00:00.000Z" });
    asked = [];
    await run([], deps({ now: () => new Date("2026-12-10T12:00:00Z") }));
    expect(asked).toEqual(["Open the report in your browser? [Y/n]"]);
    asked = [];
    await run([], deps({ now: () => new Date("2026-12-16T12:00:00Z") }));
    expect(asked).toContain("Install it now? [Y/n]");
    expect(spawned).toEqual([]);
  });

  it("asks again on a new minor version even within 30 days", async () => {
    await writeFile(join(home, OFFER_FILE), JSON.stringify({ declinedAt: "2026-11-14T00:00:00.000Z", version: "0.1.0" }));
    await run(["--no-open"], deps());
    expect(asked).toEqual(["Install it now? [Y/n]"]);
  });

  it.each([
    ["--no-install-prompt", { argv: ["--no-open", "--no-install-prompt"] }],
    ["AI_INSIGHTS_NO_INSTALL_PROMPT=1", { argv: ["--no-open"], env: { AI_INSIGHTS_NO_INSTALL_PROMPT: "1" } }],
    ["CI", { argv: ["--no-open"], env: { CI: "true" } }],
    ["stdin is not a terminal", { argv: ["--no-open"], terminal: { isTTY: true, stdin: false } }],
  ])("never asks with %s", async (_name, setup: { argv: string[]; env?: NodeJS.ProcessEnv; terminal?: CliDeps["terminal"] }) => {
    await run(setup.argv, deps({ env: { AI_INSIGHTS_HOME: home, ...setup.env }, ...(setup.terminal ? { terminal: setup.terminal } : {}) }));
    expect(asked).toEqual([]);
    expect(out).not.toContain("Add AI Insights to");
  });

  it("stays quiet when every agent that can be set up already has the plugin", async () => {
    const done = async () => [agent("claude-code", { plugin: "installed" }), agent("cursor")];
    await run(["--no-open"], deps({ detectAgents: done }));
    expect(asked).toEqual([]);
  });

  it("does not ask after Ctrl-C at the open question", async () => {
    answers = ["cancel"];
    expect(await run([], deps())).toBe(130);
    expect(asked).toHaveLength(1);
  });
});
