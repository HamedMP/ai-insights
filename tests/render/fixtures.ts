import type {
  Activity,
  Count,
  Coverage,
  FacetAggregate,
  Finding,
  Narrative,
  Report,
  UsageSummary,
  UsageTotals,
} from "../../src/schema/types.js";

/** Small seeded PRNG so fixtures are identical on every run. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysEndingAt(end: string, count: number): string[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  const out: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) out.push(dayString(new Date(last - index * 86_400_000)));
  return out;
}

function totals(input: number, cachedInput: number, cacheWrite: number, output: number, requests: number, usd: number | null, unpriced = 0): UsageTotals {
  return { tokens: input + cachedInput + cacheWrite + output, input, cachedInput, cacheWrite, output, requests, estimatedUsd: usd, unpriced };
}

function sumTotals(rows: UsageTotals[]): UsageTotals {
  const out = totals(0, 0, 0, 0, 0, 0, 0);
  let anyPriced = false;
  for (const row of rows) {
    out.input += row.input;
    out.cachedInput += row.cachedInput;
    out.cacheWrite += row.cacheWrite;
    out.output += row.output;
    out.requests += row.requests;
    out.unpriced += row.unpriced;
    if (row.estimatedUsd !== null) {
      anyPriced = true;
      out.estimatedUsd = (out.estimatedUsd ?? 0) + row.estimatedUsd;
    }
  }
  out.tokens = out.input + out.cachedInput + out.cacheWrite + out.output;
  if (!anyPriced) out.estimatedUsd = null;
  return out;
}

interface ReportShape {
  days: number;
  end: string;
  seed: number;
  /** Fraction of days with any activity. */
  density: number;
  harnesses: Array<"claude-code" | "codex">;
}

function buildDeterministic(shape: ReportShape): Report {
  const random = rng(shape.seed);
  const dayList = daysEndingAt(shape.end, shape.days);
  const daily: Activity["daily"] = [];
  const usageDaily: UsageSummary["daily"] = [];
  const hourHistogram = new Array<number>(24).fill(0);
  let sessions = 0;
  let userMessages = 0;
  let activeMinutes = 0;

  for (const day of dayList) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    if (random() > shape.density * (weekend ? 0.45 : 1)) continue;
    const daySessions = 1 + Math.floor(random() * (weekend ? 3 : 9));
    const dayMessages = daySessions * (4 + Math.floor(random() * 18));
    const dayMinutes = daySessions * (12 + Math.floor(random() * 50));
    sessions += daySessions;
    userMessages += dayMessages;
    activeMinutes += dayMinutes;
    daily.push({ day, sessions: daySessions, userMessages: dayMessages, activeMinutes: dayMinutes });
    for (let message = 0; message < dayMessages; message += 1) {
      const hour = Math.min(23, Math.max(0, Math.round(9 + random() * 6 + (random() - 0.5) * 10)));
      hourHistogram[hour] = (hourHistogram[hour] ?? 0) + 1;
    }
    const cached = dayMessages * (180_000 + Math.floor(random() * 220_000));
    const input = dayMessages * (2_000 + Math.floor(random() * 6_000));
    const write = dayMessages * (9_000 + Math.floor(random() * 20_000));
    const output = dayMessages * (1_200 + Math.floor(random() * 3_000));
    const usd = cached * 0.3e-6 + input * 3e-6 + write * 3.75e-6 + output * 15e-6;
    usageDaily.push({ day, ...totals(input, cached, write, output, dayMessages * 6, Math.round(usd * 100) / 100) });
  }

  const usageAll = sumTotals(usageDaily);
  const share = [0.62, 0.21, 0.12, 0.05];
  const modelNames: Array<{ harness: "claude-code" | "codex"; model: string; priced: boolean }> = [
    { harness: "claude-code", model: "claude-opus-4-1", priced: true },
    { harness: "claude-code", model: "claude-sonnet-4-5", priced: true },
    { harness: "codex", model: "gpt-5-codex", priced: true },
    { harness: "codex", model: "local-experimental-model", priced: false },
  ];
  const models: UsageSummary["models"] = modelNames
    .filter((entry) => shape.harnesses.includes(entry.harness))
    .map((entry, index) => {
      const part = share[index] ?? 0.05;
      return {
        harness: entry.harness,
        model: entry.model,
        ...totals(
          Math.round(usageAll.input * part),
          Math.round(usageAll.cachedInput * part),
          Math.round(usageAll.cacheWrite * part),
          Math.round(usageAll.output * part),
          Math.round(usageAll.requests * part),
          entry.priced && usageAll.estimatedUsd !== null ? Math.round(usageAll.estimatedUsd * part * 100) / 100 : null,
          entry.priced ? 0 : Math.round(usageAll.requests * part),
        ),
      };
    });
  const unpriced = models.reduce((sum, row) => sum + row.unpriced, 0);

  const usage: UsageSummary = {
    ...usageAll,
    unpriced,
    daily: usageDaily,
    models,
    cacheHitRate: usageAll.cachedInput / Math.max(1, usageAll.input + usageAll.cachedInput + usageAll.cacheWrite),
    pricingVersion: "2026-10-01",
  };

  const first = daily[0]?.day ?? shape.end;
  const last = daily[daily.length - 1]?.day ?? shape.end;
  const claudeShare = shape.harnesses.length > 1 ? 0.72 : 1;
  const byHarness: Activity["byHarness"] = shape.harnesses.map((harness) => ({
    harness,
    sessions: Math.round(sessions * (harness === "claude-code" ? claudeShare : 1 - claudeShare)),
    activeMinutes: Math.round(activeMinutes * (harness === "claude-code" ? claudeShare : 1 - claudeShare)),
  }));

  const coverage: Coverage[] = [
    {
      harness: "claude-code",
      label: "Claude Code",
      found: true,
      files: Math.round(sessions * claudeShare) + 4,
      sessions: Math.round(sessions * claudeShare),
      bytes: 2_100_000_000,
      issues: 3,
      oldest: `${first}T08:12:00.000Z`,
      newest: `${last}T22:41:00.000Z`,
    },
    {
      harness: "codex",
      label: "Codex",
      found: shape.harnesses.includes("codex"),
      files: shape.harnesses.includes("codex") ? Math.round(sessions * (1 - claudeShare)) : 0,
      sessions: shape.harnesses.includes("codex") ? Math.round(sessions * (1 - claudeShare)) : 0,
      issues: 0,
      oldest: shape.harnesses.includes("codex") ? `${first}T10:00:00.000Z` : null,
      newest: shape.harnesses.includes("codex") ? `${last}T18:00:00.000Z` : null,
    },
    { harness: "cursor", label: "Cursor", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null },
    { harness: "pi", label: "Pi", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null },
    { harness: "opencode", label: "OpenCode", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null },
  ];

  const tools: Count[] = [
    { key: "Bash", count: 4210 },
    { key: "Read", count: 3890 },
    { key: "Edit", count: 2410 },
    { key: "Grep", count: 1320 },
    { key: "apply_patch", count: 980 },
    { key: "Write", count: 612 },
    { key: "Glob", count: 540 },
    { key: "TodoWrite", count: 388 },
    { key: "Task", count: 140 },
    { key: "mcp__linear__get_issue", count: 92 },
    { key: "WebFetch", count: 61 },
    { key: "WebSearch", count: 40 },
    { key: "NotebookEdit", count: 3 },
  ];

  const activity: Activity = {
    sessions,
    activeDays: daily.length,
    longestStreakDays: Math.min(daily.length, 11),
    totalActiveMinutes: activeMinutes,
    userMessages,
    assistantMessages: userMessages * 7,
    linesAdded: sessions * 212,
    linesRemoved: sessions * 87,
    filesModified: sessions * 6,
    gitCommits: Math.round(sessions * 0.8),
    hourHistogram,
    daily,
    byHarness,
    projects: [
      { projectPath: "/home/dev/code/storefront", sessions: Math.round(sessions * 0.34), activeMinutes: Math.round(activeMinutes * 0.38) },
      { projectPath: "/home/dev/code/billing-service", sessions: Math.round(sessions * 0.22), activeMinutes: Math.round(activeMinutes * 0.2) },
      { projectPath: "/Users/dev/work/design-system", sessions: Math.round(sessions * 0.14), activeMinutes: Math.round(activeMinutes * 0.12) },
      { projectPath: "/home/dev/code/infra", sessions: Math.round(sessions * 0.1), activeMinutes: Math.round(activeMinutes * 0.09) },
      { projectPath: "/home/dev/notes", sessions: Math.round(sessions * 0.05), activeMinutes: Math.round(activeMinutes * 0.03) },
    ],
    languages: [
      { key: "TypeScript", count: 5120 },
      { key: "Markdown", count: 940 },
      { key: "Python", count: 610 },
      { key: "JSON", count: 480 },
      { key: "Shell", count: 300 },
      { key: "CSS", count: 220 },
      { key: "SQL", count: 140 },
      { key: "YAML", count: 90 },
    ],
    tools,
    toolCategories: [
      { key: "shell", count: 4210 },
      { key: "read", count: 4430 },
      { key: "edit", count: 4005 },
      { key: "search", count: 1860 },
      { key: "web", count: 101 },
      { key: "subagent", count: 140 },
      { key: "mcp", count: 92 },
    ],
    toolErrors: [
      { key: "command_failed", count: 512 },
      { key: "edit_mismatch", count: 140 },
      { key: "user_rejected", count: 96 },
      { key: "file_not_found", count: 41 },
      { key: "timeout", count: 12 },
    ],
    responseTimeBuckets: [
      { key: "<10s", count: 820 },
      { key: "10-30s", count: 1240 },
      { key: "30s-1m", count: 910 },
      { key: "1-5m", count: 1310 },
      { key: "5-15m", count: 420 },
      { key: ">15m", count: 230 },
    ],
    medianResponseTimeSec: 52,
    parallelSessions: { overlapEvents: 64, maxConcurrent: 4, sessionsInvolved: 121 },
    features: {
      mcpServers: [{ key: "linear", count: 31 }, { key: "playwright", count: 9 }],
      skills: [{ key: "frontend-design", count: 12 }],
      slashCommands: [{ key: "/review", count: 18 }, { key: "/compact", count: 44 }, { key: "/init", count: 2 }],
      sessionsWithSubagents: 37,
      sessionsWithPlanMode: 0,
      sessionsWithWeb: 22,
      compactions: 88,
    },
  };

  const findings: Finding[] = [
    {
      id: "repeated_failed_command:pnpm test",
      kind: "repeated_failed_command",
      severity: "high",
      title: "`pnpm test` keeps failing in the same way",
      detail: "The same test command failed 46 times across 19 sessions, usually several times in a row before the approach changed.",
      harnesses: ["claude-code"],
      metric: { value: 46, unit: "failures", label: "failed runs" },
      evidence: [
        { sessionId: "a1b2c3d4-0001", harness: "claude-code", timestamp: `${last}T14:02:00.000Z`, note: "`pnpm test` failed 6 times in a row" },
        { sessionId: "a1b2c3d4-0002", harness: "claude-code", timestamp: `${last}T10:31:00.000Z`, note: "`pnpm test` failed 4 times in a row" },
        { sessionId: "a1b2c3d4-0003", harness: "claude-code", note: "`pnpm test --run` failed 3 times in a row" },
        { sessionId: "a1b2c3d4-0004", harness: "claude-code", note: "`pnpm test` failed 3 times" },
        { sessionId: "a1b2c3d4-0005", harness: "claude-code", note: "`pnpm test` failed 3 times" },
        { sessionId: "a1b2c3d4-0006", harness: "claude-code", note: "`pnpm test` failed 2 times" },
        { sessionId: "a1b2c3d4-0007", harness: "claude-code", note: "`pnpm test` failed 2 times" },
      ],
      suggestion: {
        type: "instructions",
        title: "Tell the agent how tests run here",
        action: "Add the exact test command and how to run a single file, so the agent stops guessing.",
        instructionText: "## Tests\n- Run one file with `pnpm exec vitest run path/to/file.test.ts`.\n- Run `pnpm typecheck` before saying a change is done.\n- If a test fails twice the same way, stop and explain the failure instead of retrying.",
      },
    },
    {
      id: "cache_miss_cost",
      kind: "cache_miss_cost",
      severity: "medium",
      title: "Cache misses cost about $41",
      detail: "11% of input was re-sent without a cache hit, mostly after long idle gaps that expire the 5 minute cache.",
      harnesses: ["claude-code"],
      metric: { value: 41.2, unit: "USD", label: "estimated extra cost" },
      evidence: [
        { sessionId: "a1b2c3d4-0010", harness: "claude-code", timestamp: `${last}T09:00:00.000Z`, note: "3 cache rebuilds after 20 minute gaps" },
        { sessionId: "a1b2c3d4-0011", harness: "claude-code", note: "2 cache rebuilds after switching models mid-session" },
      ],
      suggestion: {
        type: "habit",
        title: "Start a fresh session after a long break",
        action: "After a break of more than a few minutes, a new focused session is cheaper than reviving a long one.",
      },
    },
    {
      id: "context_resets",
      kind: "context_resets",
      severity: "medium",
      title: "Context was compacted 88 times",
      detail: "Long sessions hit the context limit often; work after a compaction is more likely to repeat earlier mistakes.",
      harnesses: ["claude-code"],
      metric: { value: 88, unit: "compactions", label: "compactions" },
      evidence: [
        { sessionId: "a1b2c3d4-0020", harness: "claude-code", note: "5 compactions in one 6 hour session" },
        { sessionId: "a1b2c3d4-0021", harness: "claude-code", note: "4 compactions in one session" },
      ],
      suggestion: {
        type: "habit",
        title: "Split long tasks into planned sessions",
        action: "Write a short plan file first and start each step in a fresh session that reads it.",
      },
    },
    {
      id: "tool_error_hotspot:edit_mismatch",
      kind: "tool_error_hotspot",
      severity: "low",
      title: "Edits often miss their target",
      detail: "140 edits failed because the text to replace had changed or was not unique.",
      harnesses: ["claude-code", "codex"],
      metric: { value: 140, unit: "errors", label: "edit mismatches" },
      evidence: [
        { sessionId: "a1b2c3d4-0030", harness: "codex", note: "apply_patch rejected 5 times on the same file" },
        { sessionId: "a1b2c3d4-0031", harness: "claude-code", note: "Edit failed 3 times: old text not unique" },
      ],
    },
    {
      id: "history_disk_usage",
      kind: "history_disk_usage",
      severity: "info",
      title: "Agent history takes 2400 MB on disk",
      detail: "Your agent transcripts take 2400 MB across Claude Code, Codex.",
      harnesses: ["claude-code", "codex"],
      metric: { value: 2400, unit: "MB", label: "agent history on disk" },
      evidence: [{ sessionId: "a1b2c3d4-0050", harness: "claude-code", note: "Claude Code history takes 2100 MB on disk" }],
      suggestion: {
        type: "plugin",
        title: "Compress and save disk space",
        action: "Agent transcripts repeat a lot of text, so they compress very well. packmem compresses your agent history to save disk space without losing it.",
      },
    },
    {
      id: "unused_feature:plan_mode",
      kind: "unused_feature",
      severity: "info",
      title: "Plan mode is never used",
      detail: "None of your sessions used plan mode, yet 23 sessions were multi-step refactors.",
      harnesses: ["claude-code"],
      evidence: [{ sessionId: "a1b2c3d4-0040", harness: "claude-code", note: "6 hour refactor started without a plan" }],
      suggestion: {
        type: "feature",
        title: "Try plan mode for multi-step work",
        action: "Press Shift+Tab twice to enter plan mode and agree a plan before any file changes.",
        url: "https://docs.claude.com/en/docs/claude-code/common-workflows",
      },
    },
    {
      id: "unused_feature:hooks",
      kind: "unused_feature",
      severity: "info",
      title: "No hooks configured",
      detail: "A post-edit hook could run the formatter and typecheck automatically.",
      harnesses: ["claude-code"],
      evidence: [{ sessionId: "a1b2c3d4-0041", harness: "claude-code", note: "Formatter run by hand in 31 sessions" }],
      suggestion: {
        type: "feature",
        title: "Add a post-edit hook",
        action: "Run your formatter after every edit so style fixes never need a turn.",
      },
    },
  ];

  return {
    version: 1,
    generatedAt: `${shape.end}T23:30:00.000Z`,
    timeZone: "Europe/Berlin",
    range: { from: `${first}T08:12:00.000Z`, to: `${last}T22:41:00.000Z` },
    coverage,
    activity,
    usage,
    findings,
    facets: null,
    narrative: null,
  };
}

const facets: FacetAggregate = {
  sessionsWithFacets: 30,
  goalCategories: [
    { key: "feature", count: 12 },
    { key: "bug_fix", count: 8 },
    { key: "refactor", count: 5 },
    { key: "tests", count: 4 },
    { key: "devops", count: 2 },
    { key: "docs", count: 1 },
  ],
  sessionTypes: [
    { key: "single_task", count: 11 },
    { key: "iterative_refinement", count: 9 },
    { key: "multi_task", count: 6 },
    { key: "exploration", count: 3 },
    { key: "quick_question", count: 1 },
  ],
  outcomes: [
    { key: "fully_achieved", count: 14 },
    { key: "mostly_achieved", count: 9 },
    { key: "partially_achieved", count: 4 },
    { key: "not_achieved", count: 2 },
    { key: "unclear", count: 1 },
  ],
  helpfulness: [
    { key: "essential", count: 9 },
    { key: "very_helpful", count: 13 },
    { key: "moderately_helpful", count: 6 },
    { key: "slightly_helpful", count: 2 },
  ],
  satisfaction: [
    { key: "satisfied", count: 12 },
    { key: "likely_satisfied", count: 10 },
    { key: "neutral", count: 5 },
    { key: "dissatisfied", count: 3 },
  ],
  frictions: [
    { key: "buggy_code", count: 11 },
    { key: "wrong_approach", count: 7 },
    { key: "misunderstood_request", count: 5 },
    { key: "environment_issue", count: 4 },
    { key: "context_loss", count: 3 },
  ],
  successes: [
    { key: "multi_file_changes", count: 10 },
    { key: "good_debugging", count: 7 },
    { key: "correct_code_edits", count: 6 },
    { key: "fast_accurate_search", count: 4 },
  ],
};

const narrative: Narrative = {
  headline:
    "You mostly ship product features in a TypeScript storefront, working in long focused afternoons. Claude Code does the heavy lifting; Codex comes in for reviews. Most sessions land, but test runs and stale context cost you the most time.",
  workAreas: [
    { name: "Storefront checkout", sessions: 48, description: "Cart, payment and order-confirmation flows, usually multi-file feature work with tests." },
    { name: "Billing service", sessions: 31, description: "Webhook handling and invoice generation; more debugging than building." },
    { name: "Design system", sessions: 19, description: "Component refactors and visual polish, often iterated over several rounds." },
    { name: "Infrastructure", sessions: 12, description: "CI pipelines and deploy scripts, short sessions with many shell commands." },
  ],
  interactionStyle:
    "You give a clear goal up front and then steer in short follow-ups. You interrupt early when the approach looks wrong, which saves time, but you rarely state constraints like which test command to use, so the agent rediscovers them each session.",
  wins: [
    { title: "Large refactors land cleanly", description: "Multi-file changes across the design system went through with few corrections and green CI." },
    { title: "Fast root-causing in billing", description: "Webhook bugs were traced from logs to the failing handler in a handful of turns." },
    { title: "Good use of subagents for search", description: "Delegating code search kept the main context small on big tasks." },
  ],
  frictions: [
    {
      title: "Test loops",
      description: "The agent reruns the full suite after each small change and retries the same failing fix.",
      examples: ["Checkout session: six identical test runs before switching approach", "Billing session: fixed the test instead of the bug"],
    },
    {
      title: "Lost context in long sessions",
      description: "After compaction the agent forgot decisions made earlier and reintroduced a removed dependency.",
      examples: ["Six-hour design-system session compacted five times"],
    },
  ],
  suggestions: [
    {
      type: "instructions",
      title: "Record project conventions once",
      action: "Add the conventions you repeat most often to the project instructions file.",
      instructionText: "## Conventions\n- Use the existing `Money` type for all prices; never floats.\n- Prefer small pure functions; no new dependencies without asking.",
    },
    {
      type: "model_choice",
      title: "Use a lighter model for quick questions",
      action: "Short lookups and one-line fixes do not need the most expensive model.",
    },
    {
      type: "plugin",
      title: "Install a test-runner plugin",
      action: "A plugin that runs only the affected tests would cut most of the repeated full-suite runs.",
      url: "https://example.org/plugins/test-runner",
    },
  ],
  horizon: [
    {
      title: "Parallel feature branches",
      description: "You already run sessions side by side. Git worktrees with one agent each would let them work without stepping on each other.",
      starterPrompt: "Create a git worktree for the checkout refactor and work only inside it. Run the checkout tests before reporting back.",
    },
    {
      title: "Self-checking pull requests",
      description: "Have the agent open a draft PR, run CI, read failures and fix them before asking for review.",
    },
  ],
};

/** A full report: deterministic analysis plus facets and narrative from the insights skill. */
export function makeReport(overrides: Partial<Report> = {}): Report {
  const base = buildDeterministic({ days: 150, end: "2026-11-14", seed: 7, density: 0.8, harnesses: ["claude-code", "codex"] });
  return { ...base, facets, narrative, ...overrides };
}

/** The first run: deterministic analysis only, a short history and a single harness. */
export function makeDeterministicReport(overrides: Partial<Report> = {}): Report {
  const base = buildDeterministic({ days: 26, end: "2026-11-14", seed: 3, density: 0.85, harnesses: ["claude-code"] });
  const shortHistory: Finding = {
    id: "short_history",
    kind: "short_history",
    severity: "low",
    title: "Only 26 days of history",
    detail: "Claude Code deletes transcripts after about 30 days, so long-term trends are already gone.",
    harnesses: ["claude-code"],
    metric: { value: 26, unit: "days", label: "days of history" },
    evidence: [{ sessionId: "b0000000-0001", harness: "claude-code", note: "Oldest transcript is 26 days old" }],
    suggestion: {
      type: "matrix",
      title: "Keep your full history",
      action: "Back your history up to Matrix OS to see long-term trends.",
      url: "https://matrix-os.com",
    },
  };
  return { ...base, findings: [...base.findings, shortHistory], ...overrides };
}

/** A year of dense daily data, many models and many findings, to bound output size. */
export function makeYearReport(): Report {
  const base = buildDeterministic({ days: 365, end: "2026-11-14", seed: 11, density: 1, harnesses: ["claude-code", "codex"] });
  const models = Array.from({ length: 40 }, (_, index) => ({
    harness: (index % 2 === 0 ? "claude-code" : "codex") as "claude-code" | "codex",
    model: `model-${index}`,
    ...totals(1000 * index, 50_000 * index, 4000 * index, 900 * index, 10 * index, index % 5 === 0 ? null : index * 1.5, index % 5 === 0 ? 10 * index : 0),
  }));
  const template = base.findings[0]!;
  const findings = Array.from({ length: 80 }, (_, index) => ({ ...template, id: `f-${index}`, title: `${template.title} (${index})` }));
  const projects = Array.from({ length: 300 }, (_, index) => ({ projectPath: `/home/dev/code/project-${index}`, sessions: 300 - index, activeMinutes: 900 - index }));
  return {
    ...base,
    usage: { ...base.usage, models },
    findings,
    activity: { ...base.activity, projects },
    facets,
    narrative,
  };
}

/** Strings a hostile transcript could smuggle into the report. */
export const HOSTILE = {
  script: "<script>alert('pwned')</script>",
  img: "\"><img src=x onerror=alert(1)>",
  style: "</style><style>body{background:url(https://evil.example/x.png)}</style>",
  link: "<a href=\"https://evil.example\">click</a>",
  svg: "</svg><svg onload=alert(1)>",
  textarea: "</textarea></pre></code><iframe src=\"https://evil.example\"></iframe>",
};

/** Suggestion URLs a hostile or broken report could carry; only the http(s) ones may become links. */
export const HOSTILE_URLS = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "//evil.example/x",
  "file:///etc/passwd",
  "https://ok.example/a\" onmouseover=\"alert(1)",
  "http://plain.example/docs",
];

/** A full report with hostile text in every string field the renderer shows. */
export function makeHostileReport(): Report {
  const report = makeReport();
  const all = Object.values(HOSTILE).join(" ");
  const first = report.findings[0]!;
  return {
    ...report,
    timeZone: HOSTILE.script,
    coverage: report.coverage.map((entry) => ({ ...entry, label: `${entry.label} ${HOSTILE.img}` })),
    activity: {
      ...report.activity,
      projects: [{ projectPath: `/home/dev/${HOSTILE.script}`, sessions: 9, activeMinutes: 90 }, ...report.activity.projects],
      languages: [{ key: HOSTILE.svg, count: 99999 }, ...report.activity.languages],
      tools: [{ key: `mcp__${HOSTILE.img}`, count: 99999 }, ...report.activity.tools],
      toolErrors: [{ key: HOSTILE.style, count: 9999 }, ...report.activity.toolErrors],
      features: {
        ...report.activity.features,
        mcpServers: [{ key: HOSTILE.link, count: 3 }],
        skills: [{ key: HOSTILE.textarea, count: 2 }],
        slashCommands: [{ key: `/${HOSTILE.script}`, count: 1 }],
      },
    },
    usage: { ...report.usage, pricingVersion: HOSTILE.img, models: [{ ...report.usage.models[0]!, model: HOSTILE.svg }, ...report.usage.models] },
    findings: [
      {
        ...first,
        title: `${first.title} ${HOSTILE.script}`,
        detail: all,
        metric: { value: 3, unit: HOSTILE.img, label: HOSTILE.style },
        evidence: [{ sessionId: HOSTILE.img, harness: "claude-code", timestamp: HOSTILE.script, note: all }],
        suggestion: { type: "feature", title: HOSTILE.link, action: all, url: "javascript:alert(1)", instructionText: all },
      },
      ...report.findings.slice(1),
      { ...first, id: "short_history", kind: "short_history", title: HOSTILE.script, detail: all, metric: { value: 12, unit: HOSTILE.img, label: HOSTILE.svg } },
    ],
    facets: {
      ...report.facets!,
      frictions: [{ key: HOSTILE.script, count: 4 }],
      goalCategories: [{ key: HOSTILE.img, count: 4 }],
    },
    narrative: {
      headline: all,
      workAreas: [{ name: HOSTILE.script, sessions: 3, description: all }],
      interactionStyle: all,
      wins: [{ title: HOSTILE.img, description: all }],
      frictions: [{ title: HOSTILE.svg, description: all, examples: [HOSTILE.script, HOSTILE.textarea] }],
      suggestions: [
        { type: "instructions", title: HOSTILE.style, action: all, instructionText: all, url: HOSTILE.link },
        ...HOSTILE_URLS.map((url, index) => ({ type: "plugin" as const, title: `Hostile link ${index}`, action: all, url })),
      ],
      horizon: [{ title: HOSTILE.link, description: all, starterPrompt: all }],
    },
  };
}

/** Nothing found at all: a machine with no history yet. */
export function makeEmptyReport(): Report {
  const base = makeDeterministicReport();
  return {
    ...base,
    range: { from: null, to: null },
    coverage: base.coverage.map((entry) => ({ ...entry, found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null })),
    activity: {
      sessions: 0,
      activeDays: 0,
      longestStreakDays: 0,
      totalActiveMinutes: 0,
      userMessages: 0,
      assistantMessages: 0,
      linesAdded: 0,
      linesRemoved: 0,
      filesModified: 0,
      gitCommits: 0,
      hourHistogram: [],
      daily: [],
      byHarness: [],
      projects: [],
      languages: [],
      tools: [],
      toolCategories: [],
      toolErrors: [],
      responseTimeBuckets: [],
      medianResponseTimeSec: null,
      parallelSessions: { overlapEvents: 0, maxConcurrent: 0, sessionsInvolved: 0 },
      features: { mcpServers: [], skills: [], slashCommands: [], sessionsWithSubagents: 0, sessionsWithPlanMode: 0, sessionsWithWeb: 0, compactions: 0 },
    },
    usage: { ...totals(0, 0, 0, 0, 0, null), daily: [], models: [], cacheHitRate: null, pricingVersion: "2026-10-01" },
    findings: [],
    facets: null,
    narrative: null,
  };
}
