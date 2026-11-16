import type { Session } from "../schema/types.js";

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
