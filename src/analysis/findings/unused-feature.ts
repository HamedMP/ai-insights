import type { Evidence, Finding, Harness, Session, Suggestion } from "../../schema/types.js";
import { evidence, HARNESS_LABELS, harnessesOf, isAgentDriven, isBriefDriven, MAX_EVIDENCE, plural, type Detector } from "./context.js";

/** "Never used" only means something once there is a decent amount of history to have used it in. */
const MIN_SESSIONS = 10;
/** Each suggestion must point at sessions that would have benefited, not just at the feature's absence. */
const MIN_EVIDENCE = 2;
/** Read and search calls in one context: a subagent could have done this exploration and returned a summary. */
const SUBAGENT_EXPLORATION_CALLS = 30;
/** Changes this broad are where agreeing on a plan first pays off. */
const PLAN_CHANGED_LINES = 200;
const PLAN_FILES = 3;
/** CLIs for services that usually have an MCP server with structured access. */
const SERVICE_CLI = /^(?:gh|glab|psql|mysql|sqlite3|mongosh|redis-cli|aws|gcloud|az|kubectl|stripe|vercel|supabase|linear|jira|curl)\b/;
/** Enough calls to the same service CLI that a proper integration would be used. */
const MCP_CLI_CALLS = 5;
/** An opening prompt this long is usually a procedure the person rewrites each time. */
const SKILL_PROMPT_WORDS = 80;

interface FeatureCheck {
  key: string;
  name: string;
  harnesses: Harness[];
  /** Only judge sessions the person steered live: work handed over by an orchestrator or a written brief arrives already planned. */
  personOnly?: boolean;
  used(session: Session): boolean;
  /** Why this session would have benefited, or null. */
  why(session: Session): Evidence | null;
  benefit: string;
  suggestion: Partial<Record<Harness, Suggestion>>;
}

const count = (session: Session, test: (category: string) => boolean) =>
  session.toolCalls.filter((call) => test(call.category)).length;

const CHECKS: FeatureCheck[] = [
  {
    key: "subagents",
    name: "subagents",
    harnesses: ["claude-code"],
    used: (session) => session.features.subagents > 0 || count(session, (c) => c === "subagent") > 0,
    why(session) {
      const exploring = count(session, (c) => c === "read" || c === "search");
      return exploring >= SUBAGENT_EXPLORATION_CALLS
        ? evidence(session, `${exploring} read and search calls ran in the main context`)
        : null;
    },
    benefit: "Subagents explore in their own context and hand back a summary, so long investigations do not crowd out the main conversation.",
    suggestion: {
      "claude-code": {
        type: "feature",
        title: "Delegate exploration to a subagent",
        action: "Ask Claude to \"use a subagent to find where X is handled\", or define your own in `.claude/agents/`.",
        url: "https://code.claude.com/docs/en/sub-agents",
      },
    },
  },
  {
    key: "plan_mode",
    name: "plan mode",
    harnesses: ["claude-code"],
    personOnly: true,
    used: (session) => session.features.planMode || count(session, (c) => c === "plan") > 0,
    why(session) {
      const lines = session.linesAdded + session.linesRemoved;
      return lines >= PLAN_CHANGED_LINES && session.filesModified.length >= PLAN_FILES
        ? evidence(session, `${lines} lines changed across ${plural(session.filesModified.length, "file")} without a plan step`)
        : null;
    },
    benefit: "Plan mode has the agent research and propose an approach before it touches files, which catches misunderstandings while they are cheap.",
    suggestion: {
      "claude-code": {
        type: "feature",
        title: "Start big changes in plan mode",
        action: "Press Shift+Tab twice to enter plan mode, review the plan, then let Claude implement it.",
        url: "https://code.claude.com/docs/en/common-workflows",
      },
    },
  },
  {
    key: "mcp",
    name: "MCP servers",
    harnesses: ["claude-code", "codex"],
    used: (session) => session.features.mcpServers.length > 0 || count(session, (c) => c === "mcp") > 0,
    why(session) {
      const clis = new Map<string, number>();
      for (const call of session.toolCalls) {
        const match = call.category === "shell" && call.command ? SERVICE_CLI.exec(call.command.trim()) : null;
        if (match) clis.set(match[0], (clis.get(match[0]) ?? 0) + 1);
      }
      const top = [...clis].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return top && top[1] >= MCP_CLI_CALLS ? evidence(session, `Called \`${top[0]}\` ${top[1]} times through the shell`) : null;
    },
    benefit: "MCP servers give the agent structured access to the services you already drive through shell commands.",
    suggestion: {
      "claude-code": {
        type: "feature",
        title: "Connect the services you use",
        action: "Add an MCP server for the service you keep calling (`claude mcp add ...`).",
        url: "https://code.claude.com/docs/en/mcp",
      },
      codex: {
        type: "feature",
        title: "Connect the services you use",
        action: "Add an MCP server for the service you keep calling under `[mcp_servers]` in `~/.codex/config.toml`.",
        url: "https://developers.openai.com/codex/mcp",
      },
    },
  },
  {
    key: "skills",
    name: "skills",
    harnesses: ["claude-code", "codex"],
    used: (session) => session.features.skills.length > 0 || count(session, (c) => c === "skill") > 0,
    why(session) {
      const first = session.prompts[0];
      if (!first) return null;
      const wordCount = first.text.split(/\s+/).filter(Boolean).length;
      return wordCount >= SKILL_PROMPT_WORDS ? evidence(session, `Opened with a ${wordCount}-word prompt`, first.timestamp) : null;
    },
    benefit: "Skills package a procedure you keep explaining (how to release, how to review, how to write a migration) so the agent loads it when relevant.",
    suggestion: {
      "claude-code": {
        type: "feature",
        title: "Turn your long prompts into skills",
        action: "Save a procedure you keep typing as a skill in `.claude/skills/<name>/SKILL.md`.",
        url: "https://code.claude.com/docs/en/skills",
      },
      codex: {
        type: "feature",
        title: "Turn your long prompts into skills",
        action: "Save a procedure you keep typing as a skill in `~/.codex/skills/<name>/SKILL.md`.",
        url: "https://developers.openai.com/codex/skills",
      },
    },
  },
];

export const unusedFeature: Detector = ({ sessions }) => {
  const findings: Finding[] = [];
  for (const check of CHECKS) {
    // "Never used" is judged over every session of a harness that has the feature, so the count matches what the person sees.
    const all = sessions.filter((session) => check.harnesses.includes(session.harness));
    if (all.length < MIN_SESSIONS || all.some((session) => check.used(session))) continue;
    const judged = check.personOnly ? all.filter((session) => !isAgentDriven(session) && !isBriefDriven(session)) : all;
    const reasons = judged.flatMap((session) => {
      const item = check.why(session);
      return item ? [item] : [];
    });
    if (reasons.length < MIN_EVIDENCE) continue;
    const harnesses = harnessesOf(all);
    const names = harnesses.map((harness) => HARNESS_LABELS[harness]).join(" and ");
    const fit = check.personOnly
      ? `${reasons.length} of the ${judged.length} sessions you steered yourself looked like a good fit (sessions driven by another agent or started from a written brief are left out)`
      : `${plural(reasons.length, "session")} looked like a good fit`;
    const suggestion = check.suggestion[harnesses.find((harness) => check.suggestion[harness]) ?? harnesses[0]!];
    findings.push({
      id: `unused_feature:${check.key}`,
      kind: "unused_feature",
      severity: "info",
      title: `You have not used ${check.name}`,
      detail: `None of your ${all.length} ${names} sessions used ${check.name}, and ${fit}. ${check.benefit}`,
      harnesses,
      metric: { value: reasons.length, unit: "sessions", label: "sessions that could have used it" },
      evidence: reasons.slice(0, MAX_EVIDENCE),
      ...(suggestion ? { suggestion } : {}),
    });
  }
  return findings;
};
