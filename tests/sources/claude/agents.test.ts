import { describe, expect, it } from "vitest";
import { claudeSource } from "../../../src/sources/claude/index.js";
import { shortenHome } from "../../../src/sources/claude/classify.js";
import { assistant, attachment, prompt, system, text, toolResult, toolUse, transcript } from "./helpers.js";

const T = (minute: number, second = 0) => new Date(Date.UTC(2026, 0, 5, 10, minute, second)).toISOString();
const DAY = 24 * 60;

async function parse(lines: Array<unknown | string>) {
  const session = await claudeSource.parse(transcript(lines));
  expect(session).not.toBeNull();
  return session!;
}

const human = { origin: { kind: "human" }, promptSource: "typed" };

describe("claude source: messages from other agents", () => {
  it("never counts relayed or injected agent messages as the person's prompts", async () => {
    const session = await parse([
      prompt(T(0), "build the parser", human),
      assistant(T(1), "m1", [text("done")]),
      // Terminal-hub relays arrive marked as typed by a human.
      prompt(T(2), '<hc from="t35">Wave 2: merge main first</hc>', human),
      prompt(T(2, 10), '<hc from="t6" reach="all">Owner decision: ship it</hc>', human),
      prompt(T(2, 15), "<hc>t3 is blocked on the contract</hc>", human),
      prompt(T(2, 20), "Another Claude session sent a message: <teammate-message>done</teammate-message>"),
      prompt(T(2, 30), "<task-notification><task-id>b1</task-id><status>completed</status></task-notification>", {
        origin: { kind: "task-notification" },
        promptSource: "system",
      }),
      prompt(T(2, 40), "Continue PR #12: check the review score", { isMeta: true, promptSource: "system" }),
      attachment(T(2, 50), { type: "queued_command", commandMode: "prompt", prompt: '<hc from="t35">also rebase</hc>', origin: { kind: "human" } }),
      attachment(T(2, 55), { type: "queued_command", commandMode: "task-notification", prompt: "<task-notification/>", origin: { kind: "task-notification" } }),
      attachment(T(2, 56), {
        type: "queued_command",
        commandMode: "prompt",
        prompt: "<cross-session-message from=x>hi</cross-session-message>",
        origin: { kind: "peer" },
        isMeta: true,
      }),
      assistant(T(3), "m2", [text("on it")]),
      // The harness expanding a skill body is neither the person nor another agent.
      prompt(T(3, 30), "Base directory for this skill: ...", { isMeta: true }),
      prompt(T(5), 'thanks. what did <hc from="t35"> mean in that note?', human),
      prompt(T(5, 30), '<pasted_content id="p1"><hc from="t35">note</hc></pasted_content>', human),
    ]);
    expect(session.prompts.map((p) => p.text)).toEqual([
      "build the parser",
      'thanks. what did <hc from="t35"> mean in that note?',
      '<pasted_content id="p1"><hc from="t35">note</hc></pasted_content>',
    ]);
    expect(session.userMessageCount).toBe(3);
    // Three hub relays, a hand-back, a queued relay and a peer message. Task notifications and the
    // scheduled wake-up are the harness reporting on the agent's own work, not another agent.
    expect(session.agentMessageCount).toBe(6);
    // Only the person's reply to the agent's last answer is a response time.
    expect(session.userResponseTimesSec).toEqual([120]);
  });
});

describe("claude source: home directories", () => {
  it("shortens home directories so usernames do not travel with prompts and commands", async () => {
    const session = await parse([
      prompt(T(0), "look at /home/alice/proj/a.ts and /Users/bob/notes.md, not https://example.com/home/page"),
      assistant(T(1), "m1", [toolUse("b", "Bash", { command: "cat /home/alice/.bashrc && ls /home/alice" })], { stop: "tool_use" }),
      toolResult(T(1, 5), "b", "ok"),
    ]);
    expect(session.prompts[0]!.text).toBe("look at ~/proj/a.ts and ~/notes.md, not https://example.com/home/page");
    expect(session.toolCalls[0]!.command).toBe("cat ~/.bashrc && ls ~");
  });

  it("handles the common home layouts", () => {
    expect(shortenHome("C:\\Users\\carol\\repo and /root/x and /home/d.e-f/y")).toBe("~\\repo and /root/x and ~/y");
    expect(shortenHome("file:///home/alice/report.html")).toBe("file://~/report.html");
    expect(shortenHome("/homework/a")).toBe("/homework/a");
    expect(shortenHome("cp $ROOT/home/alice/x . && open http://localhost:5173/@fs/Users/bob/app/main.ts")).toBe(
      "cp $ROOT~/x . && open http://localhost:5173/@fs~/app/main.ts",
    );
    expect(shortenHome("see https://example.com/home/page and https://example.com/Users/guide")).toBe(
      "see https://example.com/home/page and https://example.com/Users/guide",
    );
  });
});

describe("claude source: time", () => {
  it("does not stretch a session with harness bookkeeping written when it was reopened", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(1), "m1", [text("done")]),
      attachment(T(3 * DAY), { type: "skill_listing", content: "..." }),
      attachment(T(3 * DAY + 1), { type: "deferred_tools_delta" }),
      system(T(3 * DAY + 2), "informational", { content: "..." }),
      system(T(3 * DAY + 3), "away_summary", { content: "..." }),
    ]);
    expect(session.endTime).toBe(T(1));
    expect(session.durationMinutes).toBe(1);
    expect(session.activeMinutes).toBe(1);
  });

  it("gives a session woken days later by another agent only the minutes it spent reacting", async () => {
    const session = await parse([
      prompt(T(0), "go"),
      assistant(T(4), "m1", [text("done")]),
      prompt(T(3 * DAY), '<hc from="t35">status?</hc>', human),
      assistant(T(3 * DAY + 2), "m2", [text("all green")]),
    ]);
    expect(session.agentMessageCount).toBe(1);
    expect(session.userMessageCount).toBe(1);
    expect(session.durationMinutes).toBe(3 * DAY + 2);
    expect(session.activeMinutes).toBe(6);
  });
});
