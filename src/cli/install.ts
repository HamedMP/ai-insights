import { AGENT_IDS, AGENT_LABELS, MARKETPLACE_NAME, MARKETPLACE_SOURCE, LEGACY_PLUGIN_ID, PLUGIN_ID, type AgentId, type AgentStatus } from "./agents.js";
import type { Spawner } from "./spawn.js";

// What `ai-insights install` and `uninstall` do in each agent. Claude Code and Codex are set up through their
// own plugin commands, run as child processes: AI Insights edits no agent config file itself. Those commands
// fetch the plugin from GitHub; that is the agent's own CLI doing what the person asked, the same as typing it.
// Cursor, OpenCode and Pi have no plugin command that is tested here, so they get the steps printed.

/** Adding a marketplace clones it from GitHub; a slow connection gets this long before the step is reported as failed. */
export const STEP_TIMEOUT_MS = 120_000;

export interface Step {
  agent: AgentId;
  /** The program to start: the absolute path found on PATH, else the bare name. */
  command: string;
  args: string[];
  /** The command as a person would type it. */
  display: string;
}

export interface AgentPlan {
  agent: AgentStatus;
  /** "run": steps below; "done": nothing to do; "manual": print `manual`; "absent": agent not on this machine. */
  action: "run" | "done" | "manual" | "absent";
  steps: Step[];
  manual: string[];
  notes: string[];
}

const CLI_NAME: Partial<Record<AgentId, string>> = { "claude-code": "claude", codex: "codex" };

function step(agent: AgentStatus, args: string[]): Step {
  const name = CLI_NAME[agent.id]!;
  return { agent: agent.id, command: agent.command ?? name, args, display: [name, ...args].join(" ") };
}

const MANUAL_INSTALL: Partial<Record<AgentId, string[]>> = {
  cursor: ["From a clone of https://github.com/hamedmp/ai-insights run: scripts/install.sh --harness cursor (untested install)"],
  opencode: ["From a clone of https://github.com/hamedmp/ai-insights run: scripts/install.sh --harness opencode (untested install)"],
  pi: ["Run: pi install git:github.com/hamedmp/ai-insights (untested install)"],
};

const MANUAL_UNINSTALL: Partial<Record<AgentId, string[]>> = {
  cursor: ['Remove "ai-insights" from mcpServers in ~/.cursor/mcp.json and the three ai-insights skill folders from ~/.cursor/skills'],
  opencode: ["Run: opencode mcp remove ai-insights, and remove the three ai-insights skill folders from ~/.agents/skills"],
  pi: ["Run: pi remove git:github.com/hamedmp/ai-insights"],
};

function legacyNote(agent: AgentStatus): string[] {
  return agent.legacy ? [`The pre-0.2 plugin ${LEGACY_PLUGIN_ID} is installed too; remove it with: claude plugin uninstall ${LEGACY_PLUGIN_ID}`] : [];
}

function selected(agents: AgentStatus[], wanted: AgentId[] | undefined): AgentStatus[] {
  const order = wanted && wanted.length ? wanted : AGENT_IDS;
  return order.flatMap((id) => agents.filter((agent) => agent.id === id && (agent.present || (wanted?.includes(id) ?? false))));
}

export function installPlan(agents: AgentStatus[], wanted?: AgentId[]): AgentPlan[] {
  return selected(agents, wanted).map((agent) => {
    const base = { agent, steps: [] as Step[], manual: [] as string[], notes: legacyNote(agent) };
    if (!agent.present) return { ...base, action: "absent" };
    if (agent.id === "claude-code" || agent.id === "codex") {
      if (agent.plugin === "installed") {
        const update = agent.id === "claude-code" ? `claude plugin update ${PLUGIN_ID}` : `codex plugin marketplace upgrade ${MARKETPLACE_NAME}`;
        return { ...base, action: "done", notes: [...base.notes, `Already installed. For the newest version run: ${update}`] };
      }
      const add = agent.marketplace ? [] : [step(agent, ["plugin", "marketplace", "add", MARKETPLACE_SOURCE])];
      const install = agent.id === "claude-code" ? step(agent, ["plugin", "install", PLUGIN_ID, "--scope", "user"]) : step(agent, ["plugin", "add", PLUGIN_ID]);
      return { ...base, action: "run", steps: [...add, install] };
    }
    return { ...base, action: "manual", manual: MANUAL_INSTALL[agent.id] ?? [] };
  });
}

export function uninstallPlan(agents: AgentStatus[], wanted?: AgentId[]): AgentPlan[] {
  return selected(agents, wanted).map((agent) => {
    const base = { agent, steps: [] as Step[], manual: [] as string[], notes: legacyNote(agent) };
    if (!agent.present) return { ...base, action: "absent" };
    if (agent.id === "claude-code" || agent.id === "codex") {
      const remove =
        agent.plugin === "installed" ? [agent.id === "claude-code" ? step(agent, ["plugin", "uninstall", PLUGIN_ID, "--scope", "user"]) : step(agent, ["plugin", "remove", PLUGIN_ID])] : [];
      const market = agent.marketplace ? [step(agent, ["plugin", "marketplace", "remove", MARKETPLACE_NAME])] : [];
      const steps = [...remove, ...market];
      return steps.length ? { ...base, action: "run", steps } : { ...base, action: "done", notes: [...base.notes, "Not installed."] };
    }
    return { ...base, action: "manual", manual: MANUAL_UNINSTALL[agent.id] ?? [] };
  });
}

/** The plan as lines, before anything runs: the exact commands, so nothing happens that was not shown. */
export function describePlan(plans: AgentPlan[], verb: "install" | "uninstall"): string[] {
  const lines: string[] = [];
  for (const plan of plans) {
    const label = AGENT_LABELS[plan.agent.id];
    switch (plan.action) {
      case "absent":
        lines.push(`${label}: not found on this machine`);
        break;
      case "done":
        lines.push(`${label}: nothing to ${verb}`);
        break;
      case "run":
        lines.push(`${label}: will run`);
        for (const entry of plan.steps) lines.push(`  ${entry.display}`);
        break;
      case "manual":
        lines.push(`${label}: not automatic here.`);
        for (const entry of plan.manual) lines.push(`  ${entry}`);
        break;
    }
    for (const note of plan.notes) lines.push(`  ${note}`);
  }
  return lines;
}

export interface StepOutcome {
  step: Step;
  ok: boolean;
  /** One line for the person: why it failed. */
  detail?: string;
}

function lastLine(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 300);
}

function failure(result: Awaited<ReturnType<Spawner>>): string {
  if (result.timedOut) return `timed out after ${Math.round(STEP_TIMEOUT_MS / 1000)}s`;
  if (result.error) return `could not start (${result.error})`;
  const said = lastLine(result.stderr) || lastLine(result.stdout);
  return `exit code ${result.code ?? "?"}${said ? `: ${said}` : ""}`;
}

/**
 * Runs each agent's steps in order, stopping that agent at its first failure. A failure is reported, never
 * thrown, and the other agents still run.
 */
export async function executePlans(plans: AgentPlan[], spawner: Spawner, env: NodeJS.ProcessEnv, write: (line: string) => void): Promise<StepOutcome[]> {
  const outcomes: StepOutcome[] = [];
  for (const plan of plans) {
    if (plan.action !== "run") continue;
    for (const entry of plan.steps) {
      write(`  ${entry.display}`);
      let result: Awaited<ReturnType<Spawner>>;
      try {
        result = await spawner(entry.command, entry.args, { timeoutMs: STEP_TIMEOUT_MS, env });
      } catch (error) {
        result = { ok: false, code: null, timedOut: false, error: error instanceof Error ? error.message : String(error), stdout: "", stderr: "" };
      }
      if (result.ok) {
        outcomes.push({ step: entry, ok: true });
        write("    done");
        continue;
      }
      const detail = failure(result);
      outcomes.push({ step: entry, ok: false, detail });
      write(`    failed: ${detail}`);
      write(`    You can run it yourself: ${entry.display}`);
      break;
    }
  }
  return outcomes;
}
