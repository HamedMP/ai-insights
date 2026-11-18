import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../menubar-scripts/ai-insights.30m.sh", import.meta.url));
const FAKE = fileURLToPath(new URL("../fixtures/fake-cli.mjs", import.meta.url));

function run(env: Record<string, string>): string {
  const result = spawnSync("bash", [SCRIPT], { env: { ...process.env, AI_INSIGHTS_PLUGIN_PATH_DONE: "1", AI_INSIGHTS_CLI: FAKE, ...env }, encoding: "utf8", timeout: 20_000 });
  return result.stdout;
}

describe.skipIf(process.platform === "win32")("SwiftBar / xbar script", () => {
  it("puts this week's sessions in the menu bar and the three periods and the tip in the menu", () => {
    const out = run({}).split("\n");
    expect(out[0]).toBe("AI 41");
    expect(out).toContain("This week: 41 sessions · 6.1 h · ≈ $27.90 | font=Menlo");
    expect(out.some((line) => line.startsWith("Tip: 9 sessions this week"))).toBe(true);
    expect(out.some((line) => line.startsWith("Open full report | bash="))).toBe(true);
  });

  it("leaves every cost out when asked to", () => {
    const out = run({ AI_INSIGHTS_HIDE_COST: "1" });
    expect(out).not.toContain("$");
    expect(out).toContain("This week: 41 sessions · 6.1 h | font=Menlo");
  });

  it("shows a calm message when the CLI fails or prints something else", () => {
    expect(run({ FAKE_CLI_MODE: "fail" }).split("\n")[0]).toBe("AI !");
    expect(run({ FAKE_CLI_MODE: "garbage" }).split("\n")[0]).toBe("AI !");
  });

  it("explains how to install the CLI when it is missing", () => {
    const out = run({ AI_INSIGHTS_CLI: "", PATH: "/usr/bin:/bin" });
    expect(out.split("\n")[0]).toBe("AI ?");
    expect(out).toContain("npm i -g ai-insights");
  });
});
