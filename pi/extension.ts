// Pi loads this file from the `pi.extensions` entry in package.json. The skills come from `pi.skills`.
// Pi's API is typed loosely here so the package does not depend on Pi being installed.

interface PiLike {
  registerMcpServer?: (name: string, config: { command: string; args: string[] }) => unknown;
  ui?: { notify?: (message: string, level?: string) => unknown };
}

export const AI_INSIGHTS_MCP = { command: "npx", args: ["-y", "ai-insights", "mcp"] };

export default function aiInsights(pi: PiLike): void {
  if (typeof pi.registerMcpServer === "function") {
    pi.registerMcpServer("ai-insights", AI_INSIGHTS_MCP);
    return;
  }
  // Older Pi builds have no MCP support; the skills still load, so say why the tools are missing instead of failing.
  pi.ui?.notify?.("AI Insights: this Pi version cannot register MCP servers, so the ai_insights_* tools are unavailable.", "warning");
}
