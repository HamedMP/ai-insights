import {
  FRICTION_CAUSES,
  type Evidence,
  type Finding,
  type FrictionCause,
  type FrictionCauseKey,
  type FrictionCauses,
  type FrictionType,
  type Session,
  type SessionFacet,
} from "../schema/types.js";
import { normalizeCommand } from "./findings/commands.js";
import { evidence, plural } from "./findings/context.js";
import { repeatedRules } from "./findings/repeated-instruction.js";
import { corrections, SLOW_GAP_MIN } from "./findings/slow-correction.js";
import { facetKey } from "./facets.js";
import { isAgentDriven } from "./sessions.js";
import type { Clock } from "./time.js";

/** Below this, one odd session moves a share by ten points or more: too few to call anything a pattern. */
export const MIN_CAUSE_SESSIONS = 10;
/** The same floor for the agent review: a share of three judged sessions says nothing. */
export const MIN_JUDGED_SESSIONS = 10;
const MAX_CAUSE_EVIDENCE = 2;

/** Two lookups for files that were not there is the agent guessing the layout, not one typo. */
const MIN_MISSING_FILES = 2;
/** A couple of failed edits or reads is ordinary; three in one session costs real turns. */
const MIN_TOOL_ERRORS = 3;
/** The same command failing this many times running is retrying, not diagnosing (as in the repeated-command finding). */
const MIN_FAILED_STREAK = 3;
/** One step-in is ordinary steering; two in a session, or one after a long solo run, is the agent off track. */
const MIN_STEP_INS = 2;

/** Not tool failures: permissions have their own cause, missing files count as missing context. */
const NOT_TOOL_ERRORS = new Set(["permission_denied", "user_rejected", "file_not_found"]);

interface SignDef {
  key: string;
  label: string;
  /** How strongly this session shows the sign; 0 when it does not. Also orders the evidence. */
  score?: (session: Session, ctx: SessionSignals) => number;
  /** Judged friction types: the session shows the sign when its facet counts any of them. */
  judged?: FrictionType[];
  note: (score: number) => string;
}

interface CauseDef {
  key: FrictionCauseKey;
  label: string;
  basis: string;
  signs: SignDef[];
  /** Findings whose suggestion fits this cause, most specific first. */
  findings: Array<(finding: Finding) => boolean>;
  fallback: { title: string; action: string };
}

interface SessionSignals {
  repeatedRule: Set<Session>;
}

const judgedLabel: Record<FrictionType, string> = {
  misunderstood_request: "Your agent judged the request was misunderstood",
  wrong_approach: "Your agent judged it took a wrong approach",
  buggy_code: "Your agent judged the code was buggy",
  incomplete_work: "Your agent judged the work was left incomplete",
  ignored_instructions: "Your agent judged it ignored instructions",
  over_engineering: "Your agent judged it over-engineered",
  permission_block: "Your agent judged a permission blocked it",
  tool_failure: "Your agent judged a tool failed",
  environment_issue: "Your agent judged the environment got in the way",
  external_blocker: "Your agent judged something outside blocked it",
  context_loss: "Your agent judged context was lost",
  slow_or_stuck: "Your agent judged it was slow or stuck",
};

function judged(type: FrictionType): SignDef {
  return { key: `judged:${type}`, label: judgedLabel[type], judged: [type], note: () => `${judgedLabel[type]}` };
}

function errorsOf(session: Session, keep: (category: string) => boolean): number {
  let count = 0;
  for (const call of session.toolCalls) if (call.error && keep(call.error)) count += 1;
  return count;
}

/** Non-shell tool errors, and shell timeouts: a shell command's own non-zero exit often just answers a question. */
function toolErrors(session: Session): number {
  let count = 0;
  for (const call of session.toolCalls) {
    if (!call.error || NOT_TOOL_ERRORS.has(call.error)) continue;
    if (call.category === "shell" && call.error === "command_failed") continue;
    count += 1;
  }
  return count;
}

/** Longest run of the same shell command failing with nothing else in between, as the repeated-command finding counts it. */
function failedStreak(session: Session): number {
  let best = 0;
  let streak = 0;
  let key: string | null = null;
  for (const call of session.toolCalls) {
    if (call.category === "edit") key = null;
    if (call.category !== "shell" || !call.command) continue;
    const command = normalizeCommand(call.command);
    if (!command || !call.error || (call.error !== "command_failed" && call.error !== "timeout")) {
      key = null;
      continue;
    }
    streak = key === command ? streak + 1 : 1;
    key = command;
    best = Math.max(best, streak);
  }
  return best >= MIN_FAILED_STREAK ? best : 0;
}

function stepIns(session: Session): number {
  if (isAgentDriven(session)) return 0;
  const found = corrections(session);
  return found.length >= MIN_STEP_INS || found.some((item) => item.minutesBefore >= SLOW_GAP_MIN) ? found.length : 0;
}

const suggestionTitle = (title: string) => (finding: Finding) => finding.suggestion?.title === title;
const kind = (value: Finding["kind"]) => (finding: Finding) => finding.kind === value;

const CAUSES: CauseDef[] = [
  {
    key: "missing_context",
    label: "Not enough context given",
    basis: "Sessions where you typed an instruction you also typed in other sessions, or the agent looked for files that were not there.",
    signs: [
      { key: "repeated_rule", label: "You typed an instruction you keep repeating", score: (session, ctx) => (ctx.repeatedRule.has(session) ? 1 : 0), note: () => "You typed an instruction you also typed in other sessions" },
      {
        key: "missing_files",
        label: "The agent looked for files that were not there",
        score: (session) => {
          const count = errorsOf(session, (category) => category === "file_not_found");
          return count >= MIN_MISSING_FILES ? count : 0;
        },
        note: (score) => `${plural(score, "file lookup")} found nothing there`,
      },
    ],
    findings: [kind("repeated_instruction"), suggestionTitle("Describe the project layout")],
    fallback: { title: "Write down what every session needs", action: "Put the rules you keep restating and a short map of the project in CLAUDE.md or AGENTS.md, so each session starts with them." },
  },
  {
    key: "unclear_request",
    label: "Request misread or unclear",
    basis: "Sessions your agent judged it misunderstood what you asked. Only the agent review can see this.",
    signs: [judged("misunderstood_request")],
    findings: [kind("frequent_interruptions")],
    fallback: { title: "Front-load the request", action: "State the goal, constraints and what \"done\" looks like in the first prompt, and ask the agent to restate the task before it starts." },
  },
  {
    key: "context_ran_out",
    label: "Context ran out",
    basis: "Sessions that hit the context limit and were compacted, or that your agent judged lost context.",
    signs: [
      { key: "compacted", label: "Context was compacted", score: (session) => session.features.compactions, note: (score) => `Context was compacted ${plural(score, "time")}` },
      judged("context_loss"),
    ],
    findings: [kind("context_resets"), kind("long_sessions")],
    fallback: { title: "Hand off instead of compacting", action: "When a task outgrows one context, have the agent write progress and next steps to a file, then start a fresh session from it." },
  },
  {
    key: "tool_environment",
    label: "Tool or environment failures",
    basis: `Sessions with ${MIN_TOOL_ERRORS}+ failed tool calls (edits, reads, timeouts; not permissions, missing files or a command's own exit code), or the same command failing ${MIN_FAILED_STREAK}+ times in a row.`,
    signs: [
      { key: "tool_errors", label: `${MIN_TOOL_ERRORS}+ tool calls failed`, score: (session) => { const count = toolErrors(session); return count >= MIN_TOOL_ERRORS ? count : 0; }, note: (score) => `${plural(score, "tool call")} failed` },
      { key: "failed_retries", label: `The same command failed ${MIN_FAILED_STREAK}+ times in a row`, score: failedStreak, note: (score) => `The same command failed ${score} times in a row` },
      judged("tool_failure"),
      judged("environment_issue"),
      judged("external_blocker"),
    ],
    findings: [kind("repeated_failed_command"), kind("tool_error_hotspot")],
    fallback: { title: "Describe your setup once", action: "Note the build, test and run commands that work here, and any setup step they need, in your instructions file." },
  },
  {
    key: "permissions",
    label: "Permissions and approvals",
    basis: "Sessions where a tool call was blocked by permissions, refused at a prompt, or stopped by an automatic reviewer.",
    signs: [
      {
        key: "blocked",
        label: "A tool call was blocked or refused",
        score: (session) => errorsOf(session, (category) => category === "permission_denied" || category === "user_rejected") + (session.approvals?.autoBlocked ?? 0),
        note: (score) => `${plural(score, "tool call")} blocked or refused`,
      },
      judged("permission_block"),
    ],
    findings: [kind("permission_prompt_load")],
    fallback: { title: "Pre-approve the safe commands", action: "Allow the read-only and test commands you always approve in your agent's settings, so prompts are left for the risky ones." },
  },
  {
    key: "off_course",
    label: "Agent went off course",
    basis: `Sessions where you stepped in while the agent was working (twice, or once after ${SLOW_GAP_MIN}+ minutes alone), or your agent judged it took a wrong approach, ignored instructions or left the work broken. A step-in can also mean the first request left something out.`,
    signs: [
      { key: "stepped_in", label: "You stepped in while the agent was working", score: stepIns, note: (score) => `You stepped in ${plural(score, "time")} while the agent was working` },
      judged("wrong_approach"),
      judged("ignored_instructions"),
      judged("over_engineering"),
      judged("buggy_code"),
      judged("incomplete_work"),
      judged("slow_or_stuck"),
    ],
    findings: [kind("slow_correction"), kind("frequent_interruptions")],
    fallback: { title: "Agree on the plan before long runs", action: "For larger tasks, ask for a short plan first and approve it before the agent starts editing." },
  },
];

function judgedCount(facet: SessionFacet | undefined, types: FrictionType[]): number {
  if (!facet) return 0;
  let total = 0;
  for (const type of types) {
    const value = facet.frictions[type];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

export interface CauseInput {
  sessions: Session[];
  facets: Map<string, SessionFacet>;
  findings: Finding[];
  clock: Clock;
}

/**
 * Groups sessions by the kind of trouble they showed. A session counts under every cause it shows a sign of;
 * a cause is a count of sessions, not a diagnosis. Absent below `MIN_CAUSE_SESSIONS`.
 */
export function buildFrictionCauses(input: CauseInput): FrictionCauses | undefined {
  const { sessions, findings } = input;
  if (sessions.length < MIN_CAUSE_SESSIONS) return undefined;
  const judgedSessions = sessions.filter((session) => input.facets.has(facetKey(session.harness, session.id)));
  const usedReview = judgedSessions.length >= MIN_JUDGED_SESSIONS;
  const ctx: SessionSignals = { repeatedRule: new Set(repeatedRules(sessions, input.clock).flatMap((rule) => [...rule.bySession.keys()])) };

  const any = new Set<Session>();
  const causes: FrictionCause[] = [];
  for (const def of CAUSES) {
    const signs = def.signs.filter((sign) => sign.score || usedReview);
    if (signs.length === 0) continue;
    const reviewOnly = signs.every((sign) => !sign.score);
    const pool = reviewOnly ? judgedSessions : sessions;
    const hits: Array<{ session: Session; sign: SignDef; score: number }> = [];
    const perSign = new Map<SignDef, number>();
    const showing = new Set<Session>();
    for (const session of pool) {
      const facet = usedReview ? input.facets.get(facetKey(session.harness, session.id)) : undefined;
      let best: { sign: SignDef; score: number } | null = null;
      for (const sign of signs) {
        const score = sign.score ? sign.score(session, ctx) : judgedCount(facet, sign.judged ?? []);
        if (score <= 0) continue;
        perSign.set(sign, (perSign.get(sign) ?? 0) + 1);
        // Measured signs make better evidence than a judgement, so they win ties for the note.
        if (!best || score > best.score || (score === best.score && !!sign.score && !best.sign.score)) best = { sign, score };
      }
      if (!best) continue;
      showing.add(session);
      hits.push({ session, ...best });
    }
    if (showing.size === 0) continue;
    for (const session of showing) any.add(session);
    const evidenceItems: Evidence[] = hits
      .sort((a, b) => b.score - a.score || Number(!!b.sign.score) - Number(!!a.sign.score) || a.session.startTime.localeCompare(b.session.startTime))
      .slice(0, MAX_CAUSE_EVIDENCE)
      .map((hit) => evidence(hit.session, hit.sign.note(hit.score)));
    let finding: Finding | undefined;
    for (const match of def.findings) {
      finding = findings.find((candidate) => match(candidate) && candidate.suggestion);
      if (finding) break;
    }
    causes.push({
      key: def.key,
      label: def.label,
      sessions: showing.size,
      of: pool.length,
      share: showing.size / pool.length,
      basis: def.basis,
      signs: signs.filter((sign) => perSign.has(sign)).map((sign) => ({ key: sign.key, label: sign.label, sessions: perSign.get(sign)! })),
      evidence: evidenceItems,
      ...(finding ? { findingId: finding.id } : {}),
      suggestion: finding?.suggestion ? { title: finding.suggestion.title, action: finding.suggestion.action } : def.fallback,
    });
  }
  const order = (key: FrictionCauseKey) => FRICTION_CAUSES.indexOf(key);
  causes.sort((a, b) => b.share - a.share || b.sessions - a.sessions || order(a.key) - order(b.key));
  return {
    sessions: sessions.length,
    judged: judgedSessions.length,
    usedReview,
    minSessions: MIN_CAUSE_SESSIONS,
    minJudged: MIN_JUDGED_SESSIONS,
    withAny: any.size,
    causes,
  };
}
