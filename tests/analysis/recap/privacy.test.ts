import { describe, expect, it } from "vitest";
import { buildReport } from "../../../src/analysis/index.js";
import type { Session } from "../../../src/schema/types.js";
import { at, coverage, day, facet, NOW, prompt, request, session, shell, tool } from "../factory.js";

/** Tokens no allowlist holds. Each stands for something private: a person, a project, a host, a product. */
const PRIVATE = ["quintavius", "zorblatt", "frobnicorp", "vexmoor", "ulthane", "grimsby-internal", "pellucid", "orrin"];

function leaky(index: number): Session {
  const [person, project, company, host, product, skill, server, branch] = PRIVATE;
  const base = session({
    id: `leaky-${index}`,
    startTime: day(index),
    projectPath: `/home/${person}/code/${project}`,
    projectRoot: `/home/${person}/code/${project}`,
    gitBranch: `${branch}/secret-${project}`,
    models: [`${company}-${product}-v9`],
    prompts: [
      prompt(`${person} here, can you fix the ${project} deploy on ${host}.${company}.com`, day(index, 1)),
      prompt(`<${product}_brief>run ${project} for ${person}@${company}.io</${product}_brief>`, day(index, 2)),
      prompt(`/${skill} ${project}`, day(index, 3)),
      prompt(`${project}`, day(index, 4)),
      prompt(`please ${product} the ${person} thing, thanks ${person}`, day(index, 5)),
      prompt(`${person}? ${project}? ${company}?`, day(index, 6), true),
    ],
    userMessageCount: 6,
    requests: [
      request({ model: `${company}-${product}-v9`, timestamp: day(index, 1) }),
      request({ model: `openrouter/${company}/${product}`, timestamp: day(index, 2) }),
      request({ model: "claude-sonnet-4-6", timestamp: day(index, 3) }),
    ],
    toolCalls: [
      shell(`/home/${person}/bin/${project}-ctl --host ${host}`, "command_failed", day(index, 1)),
      shell(`${product} sync ${company}`, "command_failed", day(index, 2)),
      shell(`cd /srv/${project} && ./${product}.sh`, undefined, day(index, 3)),
      shell(`npx ${company}-cli deploy`, undefined, day(index, 3)),
      tool("skill", { skill: `${company}:${skill}`, timestamp: day(index, 4) }),
      tool("skill", { skill, timestamp: day(index, 4) }),
      tool("mcp", { name: `mcp__${server}__get`, mcpServer: server, timestamp: day(index, 4) }),
      tool("edit", { filePath: `/home/${person}/code/${project}/${product}.ts`, timestamp: day(index, 5) }),
    ],
    filesModified: [`/home/${person}/code/${project}/${product}.ts`],
  });
  base.features = { ...base.features, mcpServers: [server!], skills: [skill!, `${company}:${skill}`], slashCommands: [`/${skill}`], slashCommandCounts: { [`/${skill}`]: 3, [`/${project}`]: 1 } };
  return base;
}

describe("recap privacy", () => {
  it("never carries a project, path, person, email, host, product, branch or prompt text, whatever the history holds", () => {
    const sessions = Array.from({ length: 6 }, (_, index) => leaky(index));
    const facets = sessions.map((s) => facet(s.id, { underlyingGoal: `ship ${PRIVATE[1]} for ${PRIVATE[0]}`, summary: `${PRIVATE[2]} work`, frictionDetail: PRIVATE[3]! }));
    const report = buildReport({ sessions, facets, coverage: [coverage("claude-code", sessions.length)], now: NOW, timeZone: "UTC" });
    const serialized = JSON.stringify(report.recap).toLowerCase();
    for (const token of PRIVATE) expect(serialized, token).not.toContain(token);
    for (const fragment of ["/home", "/srv", ".com", ".io", "@", "secret", "brief", ".ts", ".sh"]) expect(serialized, fragment).not.toContain(fragment);
    // The full report does hold them, so the test would notice if they never reached the analysis at all.
    expect(JSON.stringify(report).toLowerCase()).toContain(PRIVATE[1]);
    // Neutral labels stand in for the private names.
    expect(report.recap!.models.map((model) => model.key)).toContain("Another model");
    expect(report.recap!.slash.map((entry) => entry.key)).toEqual(["a custom one"]);
    expect(report.recap!.shell.programs.map((entry) => entry.key)).toContain("your own CLI");
    expect(report.recap!.connectors).toEqual([{ key: "a custom one", count: 6 }]);
    expect(report.recap!.skills).toEqual([{ key: "a custom one", count: 12 }]);
  });

  it("keeps a repeated-instruction finding's quoted prompt out of the tips", () => {
    const sessions = Array.from({ length: 8 }, (_, index) =>
      session({ startTime: day(index), prompts: [prompt(`always run the zorblatt migration check before quintavius merges`, day(index, 1)), prompt("ok", at(index * 1440 + 3))] }),
    );
    const report = buildReport({ sessions, coverage: [coverage("claude-code", 8)], now: NOW, timeZone: "UTC" });
    expect(JSON.stringify(report.recap)).not.toMatch(/zorblatt|quintavius/);
  });
});
