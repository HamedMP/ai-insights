import type { Session } from "../schema/types.js";
import { parseMs } from "./time.js";

/** Worktrees and subfolders of one repository are one project to the person, so everything groups by the root. */
export function projectKey(session: Session): string | null {
  return session.projectRoot ?? session.projectPath ?? null;
}

/**
 * True when other agents (an orchestrator, task notifications) sent more messages than the
 * person typed. Such sessions say little about how the person steers an agent.
 */
export function isAgentDriven(session: Session): boolean {
  const agent = session.agentMessageCount ?? 0;
  return agent > 0 && agent > Math.max(session.userMessageCount, session.prompts.length);
}

/** An opening prompt this long already lays out the plan; asking for another one adds little. */
const BRIEF_WORDS = 60;
/** "Read the handoff file and follow it": the plan was written before the session started. */
const POINTS_AT_BRIEF = /\b(?:read|follow|open|see)\b[^\n]{0,100}?(?:\.md\b|\b(?:handoff|handover|brief|spec)\b)/i;

/** True when the session started from a written brief rather than being worked out live with the agent. */
export function isBriefDriven(session: Session): boolean {
  const first = session.prompts[0]?.text ?? "";
  return first.split(/\s+/).filter(Boolean).length >= BRIEF_WORDS || POINTS_AT_BRIEF.test(first);
}

type SessionKey = Pick<Session, "harness" | "id"> & { startTime: string | null };

function byStart(a: SessionKey, b: SessionKey): number {
  return (
    (parseMs(a.startTime) ?? Number.POSITIVE_INFINITY) - (parseMs(b.startTime) ?? Number.POSITIVE_INFINITY) ||
    a.harness.localeCompare(b.harness) ||
    a.id.localeCompare(b.id)
  );
}

/** One copy per session, oldest first: the scan may hand over the same transcript twice (a backup root, a moved file). */
export function uniqueSessions<S extends SessionKey>(sessions: S[]): S[] {
  const seen = new Set<string>();
  const out: S[] = [];
  for (const session of [...sessions].sort(byStart)) {
    const key = `${session.harness}\u0000${session.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(session);
  }
  return out;
}
