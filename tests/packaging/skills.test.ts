import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DRIVERS,
  FINDING_KINDS,
  FRICTION_TYPES,
  GOAL_CATEGORIES,
  HELPFULNESS,
  OUTCOMES,
  SATISFACTION,
  SESSION_TYPES,
  SUCCESS_TYPES,
  SUGGESTION_TYPES,
  TOOL_CATEGORIES,
  TOOL_ERROR_CATEGORIES,
} from "../../src/schema/types.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SKILLS = join(ROOT, "skills");
const REQUIRED = ["hindsight", "hindsight-coach", "hindsight-setup"];

// The facet fields a skill may list values for, mapped to the contract array the values must come from.
const FACET_FIELDS: Record<string, readonly string[]> = {
  goalCategories: GOAL_CATEGORIES,
  sessionType: SESSION_TYPES,
  outcome: OUTCOMES,
  helpfulness: HELPFULNESS,
  satisfaction: SATISFACTION,
  frictions: FRICTION_TYPES,
  primarySuccess: SUCCESS_TYPES,
  drivenBy: DRIVERS,
};

const TAXONOMY = new Set<string>([
  ...GOAL_CATEGORIES,
  ...SESSION_TYPES,
  ...OUTCOMES,
  ...HELPFULNESS,
  ...SATISFACTION,
  ...FRICTION_TYPES,
  ...SUCCESS_TYPES,
  ...DRIVERS,
  ...FINDING_KINDS,
  ...SUGGESTION_TYPES,
  ...TOOL_CATEGORIES,
  ...TOOL_ERROR_CATEGORIES,
]);

// The MCP tools the integration brief defines. A skill naming any other `hindsight_*` tool would send the agent after something that does not exist.
const MCP_TOOLS = new Set([
  "hindsight_scan",
  "hindsight_report",
  "hindsight_sessions",
  "hindsight_excerpt",
  "hindsight_save_facets",
  "hindsight_save_narrative",
  "hindsight_render",
]);

function skillDirs(): string[] {
  return readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function read(skill: string): string {
  return readFileSync(join(SKILLS, skill, "SKILL.md"), "utf8");
}

function frontmatter(text: string): Record<string, string> {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  if (!block) return {};
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (match) fields[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

function codeSpans(text: string): string[] {
  const withoutFences = text.replace(/```[\s\S]*?```/g, "");
  return [...withoutFences.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
}

describe("skills", () => {
  it("ships the three skills the person invokes", () => {
    for (const skill of REQUIRED) expect(existsSync(join(SKILLS, skill, "SKILL.md")), skill).toBe(true);
  });

  it("every skill loads in every harness: frontmatter is only name and description, and name equals the folder", () => {
    for (const skill of skillDirs()) {
      const text = read(skill);
      const fields = frontmatter(text);
      expect(Object.keys(fields).sort(), skill).toEqual(["description", "name"]);
      expect(fields.name, skill).toBe(skill);
      expect(skill).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(fields.description!.length, skill).toBeGreaterThan(40);
      expect(fields.description!.length, skill).toBeLessThanOrEqual(1024);
      // An unquoted ": " breaks YAML parsing in stricter harnesses.
      expect(fields.description, skill).not.toMatch(/: /);
    }
  });

  it("a facet written by following the skill passes validation: every listed taxonomy value is in the contract", () => {
    const listed = new Map<string, string[]>();
    for (const skill of skillDirs()) {
      for (const line of read(skill).split("\n")) {
        const match = line.match(/^- `([A-Za-z]+)`[^:]*:(.*)$/);
        if (!match || !(match[1]! in FACET_FIELDS)) continue;
        const values = codeSpans(match[2]!).map((span) => span.split(" ")[0]!);
        const allowed = FACET_FIELDS[match[1]!]!;
        for (const value of values) expect(allowed, `${skill}: ${match[1]} lists ${value}`).toContain(value);
        listed.set(match[1]!, [...(listed.get(match[1]!) ?? []), ...values]);
      }
    }
    // The main skill lists every field, so the agent never has to guess a value the contract allows.
    for (const [field, allowed] of Object.entries(FACET_FIELDS)) {
      expect(new Set(listed.get(field) ?? []), field).toEqual(new Set(allowed));
    }
  });

  it("no skill names a snake_case value that the contract does not define", () => {
    for (const skill of skillDirs()) {
      for (const span of codeSpans(read(skill))) {
        if (!/^[a-z]+(?:_[a-z0-9]+)+$/.test(span)) continue;
        if (span.startsWith("hindsight_")) {
          expect(MCP_TOOLS, `${skill} names tool ${span}`).toContain(span);
        } else {
          expect(TAXONOMY, `${skill} names ${span}`).toContain(span);
        }
      }
    }
  });

  it("the main skill walks the whole flow with the real tool names", () => {
    const text = read("hindsight");
    for (const tool of MCP_TOOLS) expect(text, tool).toContain(`\`${tool}\``);
    expect(text).toMatch(/nothing is uploaded|nothing leaves/i);
    expect(text).toMatch(/Matrix OS/);
  });

  it("facet budget goes to sessions that matter: spread sampling, skipped sessions reported, excerpts kept small", () => {
    const text = read("hindsight");
    expect(text).toMatch(/spread/i);
    expect(text).not.toMatch(/missing a facet, newest first|no facet, newest first/i);
    expect(text).toMatch(/skipped/i);
    expect(text).toMatch(/4,000 characters/);
    expect(text).toMatch(/multi-day/i);
  });

  it("the narrative is written from the digest and matches the findings' period and harnesses", () => {
    const text = read("hindsight");
    expect(text).toMatch(/digest/i);
    expect(text).toMatch(/same period and harnesses/i);
    expect(text).toMatch(/headline/);
    // Sections are whole: the skill must not suggest fetching part of one.
    expect(text).not.toMatch(/headlines if you want/);
  });

  it("explains when to use drivenBy, in_progress, orchestration and tooling", () => {
    const text = read("hindsight");
    for (const term of ["`drivenBy`", "`in_progress`", "`orchestration`", "`tooling`"]) expect(text, term).toContain(term);
    expect(text).toMatch(/role `agent`|`agent` role|agent turns/i);
  });

  it("the coach handles a missing global instructions file by proposing the whole new file", () => {
    const text = read("hindsight-coach");
    expect(text).toMatch(/does not exist/i);
    expect(text).toMatch(/full new file|whole new file/i);
  });

  it("the coach skips placeholder suggestions and needs two sessions of evidence for an instruction", () => {
    const text = read("hindsight-coach");
    expect(text).toMatch(/placeholder/i);
    expect(text).toMatch(/temp(orary)? path|\/tmp/i);
    expect(text).toMatch(/at least two sessions/i);
  });

  it("every tool argument or field a skill names exists in the real MCP server", () => {
    const server = readFileSync(join(ROOT, "src", "mcp", "server.ts"), "utf8");
    // Facet, narrative and suggestion fields are the contract's, not the server's; the rest are harness settings.
    const notServer = new Set([
      "sessionId", "underlyingGoal", "goalCategories", "sessionType", "primarySuccess", "frictionDetail", "drivenBy",
      "workAreas", "interactionStyle", "instructionText", "starterPrompt", "cleanupPeriodDays", "mcpServers",
    ]);
    for (const skill of skillDirs()) {
      for (const span of codeSpans(read(skill))) {
        const name = span.match(/^([a-z]+[A-Z][A-Za-z]*)$/)?.[1] ?? span.match(/^([a-z][A-Za-z]*): /)?.[1];
        if (!name || notServer.has(name)) continue;
        expect(server, `${skill} names ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
  });

  it("the main skill uses the verified listing and report arguments", () => {
    const text = read("hindsight");
    for (const span of ['`strategy: "spread"`', "`minUserMessages`", "`skippedReasons`", '`detail: "full"`', "`agentDriven`", "`live`", "`agentHours`"]) {
      expect(text, span).toContain(span);
    }
    // The excerpt tool's own default is the budget; the skill must not impose a second cap.
    expect(text).not.toMatch(/10,000 characters/);
  });

  it("the coach never writes without asking", () => {
    const text = read("hindsight-coach");
    expect(text).toMatch(/diff/i);
    expect(text).toMatch(/ask/i);
    expect(text).toMatch(/never apply/i);
  });

  it("the setup skill checks the server and runs doctor", () => {
    const text = read("hindsight-setup");
    expect(text).toContain("hindsight_scan");
    expect(text).toContain("npx -y @matrix-os/hindsight doctor");
  });
});
