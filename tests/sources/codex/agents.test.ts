import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexSource } from "../../../src/sources/codex/index.js";
import { assistant, event, item, meta, rec, resetClock, rolloutName, Tree, userMessage, uuid, type Rec } from "./fixtures.js";

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
    expect(session.agentMessageCount).toBe(4);
    // The person's reply time is measured from the agent's last turn, not from the relays.
    expect(session.userResponseTimesSec).toHaveLength(1);

    const turns = await codexSource.excerpt(file, { maxTurns: 100 });
    expect(turns.filter((turn) => turn.role === "agent").map((turn) => turn.text)).toEqual([
      "Note from the orchestrator: rebase on main.",
      "tests are green",
      '{"agent":"helper","status":"done"}',
      "Another Codex session sent a message: ping",
    ]);
    expect(turns.filter((turn) => turn.role === "user").map((turn) => turn.text)).toEqual(["build the parser", "thanks, ship it"]);
  });

  it("counts messages a subagent sends back to the main thread as agent messages", async () => {
    const { session, file } = await parseOne([
      meta(uuid(1), { thread_source: "user" }),
      done({ type: "UserMessage", id: "u1", content: [{ type: "text", text: "split the work" }] }),
      rec("inter_agent_communication_metadata", { trigger_turn: false }),
      item({ type: "agent_message", author: "/root/tests", recipient: "/root", content: [{ type: "input_text", text: "tests written" }, { type: "encrypted_content", encrypted_content: "zzz" }] }),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "all done" }] }),
    ]);
    expect(session.prompts).toHaveLength(1);
    expect(session.agentMessageCount).toBe(1);
    const turns = await codexSource.excerpt(file);
    expect(turns.find((turn) => turn.role === "agent")?.text).toBe("tests: tests written");
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
