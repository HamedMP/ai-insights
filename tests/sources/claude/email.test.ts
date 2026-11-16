import { describe, expect, it } from "vitest";
import { clean, redact } from "../../../src/sources/shared.js";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { assistant, prompt, text, toolResult, toolUse, transcript } from "./helpers.js";

const T = (minute: number) => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();

describe("email addresses never leave a source", () => {
  it("redacts the common forms", () => {
    expect(redact("logged in as jane.doe+work@example.co.uk")).toBe("logged in as [email]");
    expect(redact("Login successful: Jane_Doe@Mail.Example.COM.")).toBe("Login successful: [email].");
    expect(redact('{"email":"j@example.ai"} <j.d@example.org> mailto:x-y@sub.example.dev')).toBe(
      '{"email":"[email]"} <[email]> mailto:[email]',
    );
    expect(redact("https://example.com/login?email=jane%40example.com&next=/")).toBe("https://example.com/login?email=[email]&next=/");
    expect(redact("Co-Authored-By: Jane <1234+jane@users.noreply.github.com>")).toBe("Co-Authored-By: Jane <[email]>");
  });

  it("leaves things that only look like addresses", () => {
    const keep = [
      "git clone git@github.com:org/repo.git",
      "systemctl restart getty@1.service and app@2.service",
      "cp icon@2x.png dist/",
      "pnpm add react@18.3.1 @types/node",
      "@functools.lru_cache",
      "ssh me@buildbox",
      "curl http://user@host.docker.internal:8080",
    ];
    for (const line of keep) expect(redact(line)).toBe(line);
  });

  it("is redacted in prompts, commands and excerpts", async () => {
    const file = transcript([
      prompt(T(0), "my account is jane@example.com, why does login fail?"),
      assistant(T(1), "m1", [text("Checking jane@example.com."), toolUse("b", "Bash", { command: "grep -r jane@example.com logs/" })], { stop: "tool_use" }),
      toolResult(T(2), "b", "no user jane@example.com", { error: true }),
    ]);
    const session = (await claudeSource.parse(file))!;
    const turns = await claudeSource.excerpt(file);
    const everything = JSON.stringify({ session, turns });
    expect(everything).not.toContain("jane@example.com");
    expect(session.prompts[0]!.text).toBe("my account is [email], why does login fail?");
    expect(clean("a@example.com", 100)).toBe("[email]");
  });
});
