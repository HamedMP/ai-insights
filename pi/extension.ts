// Pi loads this file from the `pi.extensions` entry in package.json. The skills come from `pi.skills`.
// Pi's API is typed loosely here so the package does not depend on Pi being installed.

interface PiLike {
  registerMcpServer?: (name: string, config: { command: string; args: string[] }) => unknown;
  ui?: { notify?: (message: string, level?: string) => unknown };
}

export const HINDSIGHT_MCP = { command: "npx", args: ["-y", "@matrix-os/hindsight", "mcp"] };

export default function hindsight(pi: PiLike): void {
  if (typeof pi.registerMcpServer === "function") {
    pi.registerMcpServer("hindsight", HINDSIGHT_MCP);
    return;
  }
  // Older Pi builds have no MCP support; the skills still load, so say why the tools are missing instead of failing.
  pi.ui?.notify?.("Hindsight: this Pi version cannot register MCP servers, so the hindsight_* tools are unavailable.", "warning");
}
