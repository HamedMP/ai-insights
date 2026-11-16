import { describe, expect, it, vi } from "vitest";
import register from "../../pi/extension.js";

describe("Pi extension", () => {
  it("registers the ai-insights MCP server with the same launch command as every other harness", () => {
    const registerMcpServer = vi.fn();
    register({ registerMcpServer });
    expect(registerMcpServer).toHaveBeenCalledWith("ai-insights", { command: "npx", args: ["-y", "ai-insights", "mcp"] });
  });

  it("does not crash Pi when this Pi version has no MCP registration", () => {
    const notify = vi.fn();
    expect(() => register({ ui: { notify } })).not.toThrow();
    expect(() => register({})).not.toThrow();
  });
});
