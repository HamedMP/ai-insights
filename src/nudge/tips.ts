// The fixed wording of a coaching tip, by finding kind. Shared by the quick views (src/analysis/periods.ts) and the
// session-start hook, which is compiled from src/nudge/ and so imports nothing: no prompts, commands or paths can
// reach a tip, only these words and the period they are about ("this week").

/** The first sentence: what happened, in the period `scope` names. */
export const TIP_LEADS: Record<string, (scope: string) => string> = {
  repeated_failed_command: (scope) => `A command kept failing ${scope}.`,
  repeated_instruction: (scope) => `You typed the same instruction more than once ${scope}.`,
  slow_correction: (scope) => `Corrections came late ${scope}.`,
  frequent_interruptions: (scope) => `You stopped the agent often ${scope}.`,
  context_resets: (scope) => `Sessions ran out of context ${scope}.`,
  long_sessions: (scope) => `Some sessions ran very long ${scope}.`,
  cache_miss_cost: (scope) => `Little was read from the prompt cache ${scope}.`,
  expensive_model_for_simple_work: (scope) => `Top-tier models answered quick questions ${scope}.`,
  no_tests_before_done: (scope) => `Code was committed without a test run ${scope}.`,
  permission_prompt_load: (scope) => `Permission prompts kept interrupting ${scope}.`,
  tool_error_hotspot: (scope) => `One tool failed often ${scope}.`,
  unused_feature: () => "Something to try:",
};

/** What to do about it, for readers that have only the kind (the hook): the report gives the specific step. */
export const TIP_ADVICE: Record<string, string> = {
  repeated_failed_command: "Tell the agent how the command should be run, in your instructions file.",
  repeated_instruction: "Write it down once in your instructions file.",
  slow_correction: "Agree on the plan before long runs.",
  frequent_interruptions: "Front-load the request: say what done looks like up front.",
  context_resets: "Try /clear between unrelated tasks, or hand off instead of compacting.",
  long_sessions: "Split work at natural checkpoints and start fresh.",
  cache_miss_cost: "Keep sessions continuous and avoid switching models mid-session.",
  expensive_model_for_simple_work: "Use a smaller model for quick questions.",
  no_tests_before_done: "Make passing checks part of done.",
  permission_prompt_load: "Allow the commands you keep approving.",
  tool_error_hotspot: "The report says why it fails and what to change.",
  unused_feature: "the report suggests a feature you have not used yet.",
};

/** The whole tip for a reader with only its kind; null for a kind with no fixed wording. */
export function tipText(id: string, scope: string): string | null {
  const lead = Object.hasOwn(TIP_LEADS, id) ? TIP_LEADS[id] : undefined;
  const advice = Object.hasOwn(TIP_ADVICE, id) ? TIP_ADVICE[id] : undefined;
  if (!lead || !advice) return null;
  return `${lead(scope)} ${advice}`;
}
