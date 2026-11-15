import { describe, expect, it, vi } from "vitest";
import register from "../../pi/extension.js";

describe("Pi extension", () => {
  it("registers the hindsight MCP server with the same launch command as every other harness", () => {
    const registerMcpServer = vi.fn();
    register({ registerMcpServer });
    expect(registerMcpServer).toHaveBeenCalledWith("hindsight", { command: "npx", args: ["-y", "@matrix-os/hindsight", "mcp"] });
  });

  it("does not crash Pi when this Pi version has no MCP registration", () => {
    const notify = vi.fn();
    expect(() => register({ ui: { notify } })).not.toThrow();
    expect(() => register({})).not.toThrow();
  });
});
