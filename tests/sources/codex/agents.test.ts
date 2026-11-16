import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexSource } from "../../../src/sources/codex/index.js";
import { assistant, event, item, meta, rec, resetClock, rolloutName, shell, Tree, userMessage, uuid, type Rec } from "./fixtures.js";

let tree: Tree;
beforeEach(() => {
  tree = new Tree();
  resetClock();
});
afterEach(() => tree.cleanup());

async function parseOne(records: Rec[]) {
  tree.write(rolloutName(1), records);
  const [file] = await codexSource.discover({ roots: [tree.sessions] });
  const session = await codexSource.parse(file!);
  expect(session).not.toBeNull();
  return { session: session!, file: file! };
}

const done = (payload: Rec): Rec => event({ type: "item_completed", thread_id: uuid(1), turn_id: "t1", item: payload });

describe("codex messages from other agents", () => {
  it("does not count orchestrator relays and cross-session notes as the person's prompts", async () => {
    const { session, file } = await parseOne([
      meta(uuid(1)),
      ...userMessage("build the parser"),
      ...assistant("on it"),
      event({ type: "task_complete" }),
      ...userMessage('<hc from="t35">Note from the orchestrator: rebase on main.</hc>'),
      ...userMessage("<cross-session-message from=\"worker\">tests are green</cross-session-message>"),
      ...userMessage("<subagent_notification>\n{\"agent\":\"helper\",\"status\":\"done\"}\n</subagent_notification>"),
      ...userMessage("Another Codex session sent a message: ping"),
      ...assistant("rebased"),
      event({ type: "task_complete" }),
      ...userMessage("thanks, ship it"),
    ]);
    expect(session.prompts.map((prompt) => prompt.text)).toEqual(["build the parser", "thanks, ship it"]);
    expect(session.userMessageCount).toBe(2);
    // The subagent notice is this session's own helper finishing, a harness event rather than another agent driving it.
    expect(session.agentMessageCount).toBe(3);
    // The person's reply time is measured from the agent's last turn, not from the relays.
    expect(session.userResponseTimesSec).toHaveLength(1);

    const turns = await codexSource.excerpt(file, { maxTurns: 100 });
    expect(turns.filter((turn) => turn.role === "agent").map((turn) => turn.text)).toEqual([
      "Note from the orchestrator: rebase on main.",
      "tests are green",
      "Another Codex session sent a message: ping",
    ]);
    expect(turns.filter((turn) => turn.role === "tool").map((turn) => turn.text)).toEqual(["subagent helper: done"]);
    expect(turns.filter((turn) => turn.role === "user").map((turn) => turn.text)).toEqual(["build the parser", "thanks, ship it"]);
  });

  it("treats replies from the session's own subagents as harness events, so an orchestrating person stays the driver", async () => {
    const reply = (author: string, text: string): Rec[] => [
      rec("inter_agent_communication_metadata", { trigger_turn: true }),
      item({ type: "agent_message", author, recipient: "/root", content: [{ type: "input_text", text }, { type: "encrypted_content", encrypted_content: "zzz" }] }),
    ];
    const { session, file } = await parseOne([
      meta(uuid(1), { thread_source: "user" }),
      done({ type: "UserMessage", id: "u1", content: [{ type: "text", text: "split the work" }] }),
      ...reply("/root/tests", "Message Type: STATUS\ntests written\nmore detail"),
      ...reply("/root/docs", "docs written"),
      ...reply("/root/tests", "all green"),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "all done" }] }),
    ]);
    expect(session.prompts).toHaveLength(1);
    expect(session.userMessageCount).toBe(1);
    expect(session.agentMessageCount).toBe(0);
    const turns = await codexSource.excerpt(file);
    expect(turns.some((turn) => turn.role === "agent")).toBe(false);
    const replies = turns.filter((turn) => turn.role === "tool" && turn.toolName === "subagent_reply");
    expect(replies.map((turn) => turn.text)).toEqual(["subagent tests: Message Type: STATUS tests written more detail", "subagent docs: docs written", "subagent tests: all green"]);
  });

  it("keeps a subagent reply to one bounded line", async () => {
    const { file } = await parseOne([
      meta(uuid(1)),
      ...userMessage("go"),
      item({ type: "agent_message", author: "/root/worker", recipient: "/root", content: [{ type: "input_text", text: "x".repeat(5000) }] }),
    ]);
    const turns = await codexSource.excerpt(file, { maxCharsPerTurn: 2000 });
    const reply = turns.find((turn) => turn.toolName === "subagent_reply")!;
    expect(reply.text.length).toBeLessThanOrEqual(160);
  });

  it("still counts the parent's instructions inside a subagent thread as another agent's", async () => {
    const { session } = await parseOne([
      meta(uuid(1)),
      item({ type: "agent_message", author: "/root", recipient: "/root/worker", content: [{ type: "input_text", text: "do the tests" }] }),
      item({ type: "agent_message", author: "/root/other", recipient: "/root/worker", content: [{ type: "input_text", text: "here is the schema" }] }),
    ]);
    expect(session.agentMessageCount).toBe(2);
  });

  it("samples subagent replies last, after the person's prompts and the agent's own tool calls", async () => {
    const records: Rec[] = [meta(uuid(1)), ...userMessage("coordinate the helpers")];
    for (let index = 0; index < 10; index += 1) {
      records.push(item({ type: "agent_message", author: `/root/h${index}`, recipient: "/root", content: [{ type: "input_text", text: `report ${index}` }] }));
      records.push(...shell(`c${index}`, `check ${index}`, 0, "ok"));
    }
    records.push(...assistant("everything merged"));
    tree.write(rolloutName(1), records);
    const [file] = await codexSource.discover({ roots: [tree.sessions] });
    const turns = await codexSource.excerpt(file!, { maxTurns: 8 });
    expect(turns.filter((turn) => turn.toolName === "subagent_reply")).toHaveLength(0);
    expect(turns.map((turn) => turn.text)).toContain("coordinate the helpers");
    expect(turns.map((turn) => turn.text)).toContain("everything merged");
  });

  it("treats every message in an automation thread as the automation's, not the person's", async () => {
    const { session } = await parseOne([
      meta(uuid(1), { thread_source: "automation" }),
      ...userMessage("nightly: check the build"),
      ...assistant("build is fine"),
    ]);
    expect(session.prompts).toEqual([]);
    expect(session.userMessageCount).toBe(0);
    expect(session.agentMessageCount).toBe(1);
  });
});
