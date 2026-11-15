import { z } from "zod";
import {
  FRICTION_TYPES,
  GOAL_CATEGORIES,
  HARNESSES,
  HELPFULNESS,
  OUTCOMES,
  SATISFACTION,
  SESSION_TYPES,
  SUCCESS_TYPES,
  SUGGESTION_TYPES,
  TOOL_CATEGORIES,
  TOOL_ERROR_CATEGORIES,
  type Narrative,
  type Session,
  type SessionFacet,
} from "../schema/types.js";
import { redact } from "../sources/shared.js";

/**
 * Every enum here is built from the contract's const arrays, so the taxonomy the
 * agent is held to cannot drift from the one the analysis and renderer read.
 */
function oneOf<const T extends readonly [string, ...string[]]>(values: T, label: string) {
  return z.enum(values, { error: () => `${label} must be one of: ${values.join(", ")}` });
}

/** Ids end up in file names; this keeps them inside their directory and off dotfiles. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function isSafeId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_PATTERN.test(id) && !id.includes("..");
}

export const SessionIdSchema = z
  .string()
  .refine(isSafeId, { message: "sessionId must be 1-200 letters, digits, '.', '_' or '-' and start with a letter or digit" });

export const HarnessSchema = oneOf(HARNESSES, "harness");

const redacted = (max: number) => z.string().max(max).transform((value) => redact(value));
const shortText = (max: number) => z.string().trim().min(1).max(max).transform((value) => redact(value));

const frictionKeys = new Set<string>(FRICTION_TYPES);

const FrictionsSchema = z
  .record(z.string(), z.number().int().min(0).max(10_000))
  .superRefine((value, ctx) => {
    const unknown = Object.keys(value).filter((key) => !frictionKeys.has(key));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `unknown friction type ${unknown.map((key) => JSON.stringify(key)).join(", ")}; frictions keys must be one of: ${FRICTION_TYPES.join(", ")}`,
      });
    }
  })
  .transform((value) => value as Partial<Record<(typeof FRICTION_TYPES)[number], number>>);

export const SessionFacetSchema = z.strictObject({
  sessionId: SessionIdSchema,
  harness: HarnessSchema,
  underlyingGoal: shortText(500),
  goalCategories: z
    .array(oneOf(GOAL_CATEGORIES, "goalCategories entries"))
    .min(1)
    .max(5)
    .transform((values) => [...new Set(values)]),
  sessionType: oneOf(SESSION_TYPES, "sessionType"),
  outcome: oneOf(OUTCOMES, "outcome"),
  helpfulness: oneOf(HELPFULNESS, "helpfulness"),
  satisfaction: oneOf(SATISFACTION, "satisfaction"),
  primarySuccess: oneOf(SUCCESS_TYPES, "primarySuccess").nullable(),
  frictions: FrictionsSchema,
  frictionDetail: redacted(1000),
  summary: shortText(1000),
}) satisfies z.ZodType<SessionFacet, unknown>;

const HttpUrlSchema = z
  .string()
  .max(500)
  .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), { message: "url must start with http:// or https://" });

export const SuggestionSchema = z.strictObject({
  type: oneOf(SUGGESTION_TYPES, "suggestion type"),
  title: shortText(160),
  action: shortText(600),
  instructionText: redacted(2000).optional(),
  url: HttpUrlSchema.optional(),
});

export const NarrativeSchema = z.strictObject({
  headline: shortText(800),
  workAreas: z
    .array(z.strictObject({ name: shortText(120), sessions: z.number().int().min(0).max(1_000_000), description: shortText(600) }))
    .max(12),
  interactionStyle: redacted(2000),
  wins: z.array(z.strictObject({ title: shortText(160), description: shortText(800) })).max(12),
  frictions: z
    .array(z.strictObject({ title: shortText(160), description: shortText(800), examples: z.array(shortText(400)).max(6) }))
    .max(12),
  suggestions: z.array(SuggestionSchema).max(15),
  horizon: z
    .array(z.strictObject({ title: shortText(160), description: shortText(800), starterPrompt: redacted(2000).optional() }))
    .max(8),
}) satisfies z.ZodType<Narrative, unknown>;

const TokenUsageSchema = z.object({
  input: z.number(),
  cachedInput: z.number(),
  cacheWrite: z.number(),
  cacheWrite5m: z.number().optional(),
  cacheWrite1h: z.number().optional(),
  output: z.number(),
});

/** Read-side check for cached sessions. Loose on extra keys so a newer source's output still loads. */
export const SessionSchema = z.object({
  id: SessionIdSchema,
  harness: HarnessSchema,
  sourcePath: z.string(),
  sourceMtimeMs: z.number(),
  projectPath: z.string().nullable(),
  gitBranch: z.string().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  durationMinutes: z.number(),
  activeMinutes: z.number(),
  models: z.array(z.string()),
  permissionMode: z.string().nullable(),
  userMessageCount: z.number(),
  assistantMessageCount: z.number(),
  prompts: z.array(z.object({ timestamp: z.string(), text: z.string(), interrupted: z.boolean().optional() })),
  userResponseTimesSec: z.array(z.number()),
  requests: z.array(z.object({ id: z.string(), timestamp: z.string(), model: z.string(), usage: TokenUsageSchema })),
  toolCalls: z.array(
    z.object({
      name: z.string(),
      category: z.enum(TOOL_CATEGORIES),
      timestamp: z.string(),
      error: z.enum(TOOL_ERROR_CATEGORIES).optional(),
      command: z.string().optional(),
      filePath: z.string().optional(),
      mcpServer: z.string().optional(),
      skill: z.string().optional(),
    }),
  ),
  features: z.object({
    mcpServers: z.array(z.string()),
    skills: z.array(z.string()),
    slashCommands: z.array(z.string()),
    subagents: z.number(),
    planMode: z.boolean(),
    webSearch: z.boolean(),
    webFetch: z.boolean(),
    compactions: z.number(),
  }),
  linesAdded: z.number(),
  linesRemoved: z.number(),
  filesModified: z.array(z.string()),
  languages: z.record(z.string(), z.number()),
  gitCommits: z.number(),
  gitPushes: z.number(),
  issues: z.number(),
}) satisfies z.ZodType<Session, unknown>;

/** A short message an agent can act on: what is wrong, where, and what is allowed. No values echoed back. */
export function describeIssues(error: z.ZodError, maxIssues = 8): string {
  const lines = error.issues.slice(0, maxIssues).map((issue) => {
    const where = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
  if (error.issues.length > maxIssues) lines.push(`…and ${error.issues.length - maxIssues} more`);
  return lines.join("; ");
}
