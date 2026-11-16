#!/usr/bin/env node
// Build the sample report for the website from invented sessions, then render it.
// Usage: node scripts/demo-report.mjs [out.html]   (default: site/demo/report.html)
// Pass --json <path> to also write the Report JSON next to it.
//
// Everything here is synthetic: invented projects (acme-api, web-app, ...), invented prompts,
// generated session ids and a fixed seed and clock, so the output is the same on every run.
// Nothing is read from ~/.claude, ~/.codex or ~/.hindsight. The sessions go through the real
// analysis (`buildReport`) and renderer, so findings, wording and charts match the product.
// Needs Node 22.18+ (built-in TypeScript type stripping and module.registerHooks).
import { mkdirSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (typeof nodeModule.registerHooks !== "function") {
  console.error("demo-report needs Node 22.18 or newer (module.registerHooks).");
  process.exit(1);
}

// Sources import siblings as `./x.js` (the compiled name); resolve those to the `.ts` file on disk.
nodeModule.registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && specifier.endsWith(".js")) return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildReport } = await import("../src/analysis/index.ts");
const { renderReport } = await import("../src/render/index.ts");

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonPath = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const outPath = resolve(args[0] ?? join(root, "site/demo/report.html"));

// ---------------------------------------------------------------------------
// Deterministic randomness and clock
// ---------------------------------------------------------------------------

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261113);
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;
function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) if ((roll -= weight) < 0) return value;
  return entries[entries.length - 1][0];
}
const hex = (length) => Array.from({ length }, () => Math.floor(random() * 16).toString(16)).join("");
const uuid = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${pick(["8", "9", "a", "b"])}${hex(3)}-${hex(12)}`;

const ZONE = "Europe/Berlin";
const NOW = new Date("2026-11-13T19:30:00Z");
const DAY = 86_400_000;
const MIN = 60_000;
/** Claude Code keeps about 30 days; Codex history goes further back. */
const CLAUDE_FROM = Date.parse("2026-10-17T00:00:00Z");
const CODEX_FROM = Date.parse("2026-09-24T00:00:00Z");
const BUSY_DAY = Date.parse("2026-11-11T00:00:00Z");

// ---------------------------------------------------------------------------
// Invented projects
// ---------------------------------------------------------------------------

const HOME = "/home/demo/code";
const PROJECTS = {
  api: {
    path: `${HOME}/acme-api`,
    weight: 5,
    files: ["src/routes/orders.ts", "src/routes/invoices.ts", "src/db/schema.ts", "src/services/billing.ts", "src/lib/money.ts", "test/orders.test.ts", "test/billing.test.ts", "README.md"],
    commands: [["pnpm test", 5], ["pnpm lint", 2], ["pnpm typecheck", 2], ["git status", 3], ["git diff --stat", 2], ["pnpm db:migrate", 1], ["git add -A && git commit -m wip", 1]],
    actions: ["add cursor pagination to", "add input validation to", "write tests for", "find out why there is a 500 in", "add rate limiting to", "log slow queries in", "clean up the error handling in", "speed up"],
    targets: ["GET /orders", "POST /invoices", "the refunds handler", "GET /customers/:id", "the billing webhook", "PATCH /orders/:id", "the money helpers", "the tax id lookup"],
  },
  web: {
    path: `${HOME}/web-app`,
    weight: 5,
    files: ["src/pages/checkout.tsx", "src/components/CartSummary.tsx", "src/components/SearchBox.tsx", "src/hooks/useOrders.ts", "src/styles/theme.css", "e2e/checkout.spec.ts", "src/pages/account.tsx"],
    commands: [["pnpm test", 4], ["pnpm test:e2e", 1], ["pnpm build", 2], ["git status", 3], ["pnpm lint", 2], ["git diff", 1]],
    actions: ["fix the layout of", "add an e2e test for", "split into smaller components:", "fix dark mode colours on", "add loading states to", "make keyboard navigation work on", "build the new version of"],
    targets: ["the checkout page", "the cart summary", "the search box", "the account page", "the order history list", "the guest checkout flow", "the address form"],
  },
  infra: {
    path: `${HOME}/infra`,
    weight: 2,
    files: ["deploy/api.yaml", "deploy/web.yaml", "terraform/main.tf", ".github/workflows/deploy.yml", "scripts/rollout.sh"],
    commands: [["kubectl get pods -n staging", 3], ["terraform plan", 2], ["git status", 2], ["bash scripts/rollout.sh staging", 1], ["gh pr create --draft --fill", 2]],
    actions: ["find out why the staging deploy fails for", "add a health check to", "raise the memory limit of", "add a canary step for", "explain the last outage of"],
    targets: ["the api service", "the web container", "the worker pool", "the deploy workflow"],
  },
  data: {
    path: `${HOME}/data-pipeline`,
    weight: 2,
    files: ["pipeline/load_orders.py", "pipeline/transform.py", "tests/test_transform.py", "sql/daily_revenue.sql", "notebooks/explore.md"],
    commands: [["pytest -q", 4], ["python -m pipeline.load_orders --dry-run", 2], ["git status", 2], ["ruff check .", 2]],
    actions: ["fix the double counting in", "add a test for", "skip bad rows in", "write a query for", "profile"],
    targets: ["daily revenue", "the orders loader", "the weekly cohorts", "the refunds transform"],
  },
  docs: {
    path: `${HOME}/docs-site`,
    weight: 1,
    files: ["content/getting-started.md", "content/api/orders.md", "content/changelog.md", "astro.config.mjs"],
    commands: [["pnpm build", 2], ["git status", 2]],
    actions: ["document", "write the changelog entry for", "fix the broken links in"],
    targets: ["the orders pagination params", "this week's release", "the getting started guide"],
  },
};
/** Worktrees of web-app used by the orchestrated afternoon. */
const WORKTREES = ["checkout", "search", "account", "cart", "a11y", "perf", "i18n", "e2e"].map((name) => `${HOME}/web-app-wt/${name}`);

/** Short steers: fewer than three meaningful words, so only the habit below reads as a repeated instruction. */
const FOLLOW_UPS = ["continue", "yes", "looks good", "run it again", "commit it", "try again", "go ahead", "why?", "keep going", "ok next", "revert that", "show the diff", "smaller please", "wrong file"];
/** Varies the opening prompt so the same task is not typed word for word across sessions. */
const CONSTRAINTS = ["", "", " and keep the public API the same", " with tests", " without new dependencies", " behind a feature flag", ", small steps please", " and explain the change after"];
/** A standing rule the person keeps typing, so the repeated-instruction finding has something real to say. */
const HABIT = [
  "run the linter and the type check before you say it is done",
  "run the linter and type check before you say it is done",
  "please run the linter and the type check before saying it is done",
];

const EXTENSION = { ts: "TypeScript", tsx: "TypeScript", py: "Python", md: "Markdown", yaml: "YAML", yml: "YAML", tf: "HCL", sh: "Shell", css: "CSS", sql: "SQL", mjs: "JavaScript" };

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

const iso = (ms) => new Date(ms).toISOString();
let requestSerial = 0;

function toolCall(harness, project, at, plan) {
  const category = weighted([["read", 30], ["search", 14], ["edit", 24], ["shell", 26], ["web", plan.web ? 3 : 0], ["subagent", plan.subagents ? 3 : 0], ["mcp", plan.mcp ? 2 : 0]]);
  const timestamp = iso(at);
  const codex = harness === "codex";
  if (category === "read" || category === "search") {
    const filePath = `${project.path}/${pick(project.files)}`;
    if (codex) return { name: "shell", category: "shell", timestamp, command: category === "read" ? `sed -n 1,160p ${pick(project.files)}` : `rg -n "${pick(["Money", "orders", "status", "retry"])}" src` };
    return category === "read" ? { name: "Read", category, timestamp, filePath } : { name: pick(["Grep", "Glob"]), category, timestamp };
  }
  if (category === "edit") {
    const filePath = `${project.path}/${pick(project.files)}`;
    const call = { name: codex ? "apply_patch" : pick(["Edit", "Edit", "Edit", "Write"]), category, timestamp, filePath };
    if (chance(0.05)) call.error = "edit_mismatch";
    return call;
  }
  if (category === "shell") {
    const command = weighted(project.commands);
    const call = { name: codex ? "shell" : "Bash", category, timestamp, command };
    // The e2e suite needs a running dev server the agent never starts, so it fails nearly every time.
    if (command === "pnpm test:e2e" && chance(0.9)) call.error = "command_failed";
    else if (!codex && command === "gh pr create --draft --fill" && chance(0.8)) call.error = "permission_denied";
    else if (!codex && command.startsWith("kubectl") && chance(0.5)) call.error = "permission_denied";
    else if (chance(0.07)) call.error = pick(["command_failed", "command_failed", "timeout"]);
    return call;
  }
  if (category === "web") return { name: pick(["WebFetch", "WebSearch"]), category, timestamp };
  if (category === "subagent") return { name: "Task", category, timestamp };
  return { name: "mcp__playwright__browser_snapshot", category: "mcp", timestamp, mcpServer: "playwright" };
}

function makeSession({ harness, projectKey, start, minutes, prompts, model, worktree = null, agentDriven = false, compactions = 0, flaky = false, habit = false }) {
  const project = PROJECTS[projectKey];
  const projectPath = worktree ?? project.path;
  const plan = { web: chance(0.25), subagents: harness === "claude-code" && chance(0.3), mcp: projectKey === "web" && chance(0.3) };
  const promptList = [];
  const requests = [];
  const toolCalls = [];
  const responseTimes = [];
  const end = start + minutes * MIN;
  const step = (minutes * MIN) / Math.max(1, prompts);
  const task = `${pick(project.actions)} ${pick(project.targets)}${pick(CONSTRAINTS)}`;
  let context = 18_000 + int(0, 6_000);
  let at = start;
  for (let index = 0; index < prompts; index += 1) {
    at = start + index * step + random() * step * 0.2;
    if (!agentDriven) {
      const text = index === 0 ? task : habit && index === 1 ? pick(HABIT) : pick(FOLLOW_UPS);
      promptList.push({ timestamp: iso(at), text, ...(index > 0 && chance(0.08) ? { interrupted: true } : {}) });
      if (index > 0) responseTimes.push(int(6, 420));
    }
    const turns = int(2, 7);
    let t = at + 4_000;
    for (let turn = 0; turn < turns && t < end; turn += 1) {
      context = Math.min(165_000, context + int(800, 3_500));
      requestSerial += 1;
      requests.push({
        id: `req_${String(requestSerial).padStart(6, "0")}`,
        timestamp: iso(t),
        model,
        usage: { input: int(40, 1_800), cachedInput: context, cacheWrite: int(400, 4_500), output: int(150, 1_600) },
      });
      for (let call = int(0, 2); call > 0; call -= 1) toolCalls.push(toolCall(harness, project, t + 1_500, plan));
      t += int(12, 75) * 1_000;
    }
    // One stubborn run in a flaky session: the agent reruns the same failing suite with nothing changed in between.
    if (flaky && index === Math.floor(prompts / 2)) {
      for (let retry = int(4, 7); retry > 0; retry -= 1) {
        t += int(20, 60) * 1_000;
        toolCalls.push({ name: "Bash", category: "shell", timestamp: iso(t), command: "pnpm test:e2e", error: "command_failed" });
      }
    }
    if (compactions && index > 0 && index % Math.max(2, Math.floor(prompts / (compactions + 1))) === 0) context = 24_000;
  }
  const edits = toolCalls.filter((call) => call.category === "edit" && !call.error);
  const languages = {};
  for (const call of toolCalls) {
    const ext = call.filePath?.split(".").pop();
    const language = ext && EXTENSION[ext];
    if (language) languages[language] = (languages[language] ?? 0) + 1;
  }
  const lastAt = Math.max(start + 60_000, ...toolCalls.map((call) => Date.parse(call.timestamp)), ...requests.map((request) => Date.parse(request.timestamp)));
  const durationMinutes = Math.round((lastAt - start) / MIN);
  const shell = toolCalls.filter((call) => call.category === "shell");
  return {
    id: uuid(),
    harness,
    sourcePath: `demo://${harness}/${requestSerial}.jsonl`,
    sourceMtimeMs: lastAt,
    projectPath,
    projectRoot: worktree ? project.path : projectPath,
    gitBranch: worktree ? `feat/${worktree.split("/").pop()}` : pick(["main", "main", "fix/orders", "feat/pagination"]),
    startTime: iso(start),
    endTime: iso(lastAt),
    durationMinutes,
    activeMinutes: Math.min(durationMinutes, Math.round(minutes * 0.92)),
    models: [model],
    permissionMode: harness === "claude-code" ? "default" : null,
    userMessageCount: promptList.length,
    assistantMessageCount: requests.length,
    prompts: promptList,
    ...(agentDriven ? { agentMessageCount: prompts } : {}),
    userResponseTimesSec: responseTimes,
    requests,
    toolCalls,
    features: {
      mcpServers: plan.mcp ? ["playwright"] : [],
      skills: [],
      slashCommands: [...(compactions ? ["/compact"] : []), ...(chance(0.1) ? ["/review"] : [])],
      subagents: toolCalls.filter((call) => call.category === "subagent").length,
      planMode: false,
      webSearch: toolCalls.some((call) => call.name === "WebSearch"),
      webFetch: toolCalls.some((call) => call.name === "WebFetch"),
      compactions,
    },
    linesAdded: edits.length * int(6, 28),
    linesRemoved: edits.length * int(2, 12),
    filesModified: [...new Set(edits.map((call) => call.filePath))],
    languages,
    gitCommits: shell.some((call) => call.command.includes("commit")) ? int(1, 3) : chance(0.4) ? 1 : 0,
    gitPushes: chance(0.3) ? 1 : 0,
    issues: 0,
  };
}

// ---------------------------------------------------------------------------
// Six weeks of work
// ---------------------------------------------------------------------------

const projectWeights = Object.entries(PROJECTS).map(([key, project]) => [key, project.weight]);
const sessions = [];
const local = (dayMs, hour) => dayMs + (hour - 1) * 3_600_000; // Berlin is UTC+1 in this window.
let habitLeft = 7;

for (let day = CODEX_FROM; day < NOW.getTime() - DAY / 2; day += DAY) {
  const weekday = new Date(day).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  const claude = day >= CLAUDE_FROM;
  const count = weekend ? (chance(0.5) ? int(0, 2) : 0) : claude ? int(3, 7) : int(1, 3);
  let hour = weekend ? 11 : 8.5 + random();
  for (let k = 0; k < count && hour < 22; k += 1) {
    const harness = claude && chance(0.72) ? "claude-code" : "codex";
    const projectKey = weighted(projectWeights);
    const kind = weighted([["normal", 7], ["long", harness === "claude-code" ? 2 : 0.5], ["quick", 2]]);
    const minutes = kind === "long" ? int(160, 290) : kind === "quick" ? int(3, 9) : int(18, 110);
    const prompts = kind === "long" ? int(36, 70) : kind === "quick" ? int(1, 2) : int(4, 22);
    const compactions = kind === "long" && harness === "claude-code" ? int(1, 4) : 0;
    const model = harness === "codex" ? "gpt-5.4" : kind === "long" || chance(0.25) ? "claude-opus-4-8" : "claude-sonnet-4-6";
    const habit = harness === "claude-code" && projectKey === "api" && kind !== "quick" && habitLeft > 0 && chance(0.6);
    if (habit) habitLeft -= 1;
    const flaky = projectKey === "web" && harness === "claude-code" && kind !== "quick" && chance(0.3);
    // Sessions overlap: the next one often starts before this one ends.
    const start = local(day, hour);
    sessions.push(makeSession({ harness, projectKey, start, minutes, prompts, model, compactions, flaky, habit }));
    hour += (minutes / 60) * (chance(0.5) ? 0.4 : 1.05) + random() * 0.6;
  }
}

// The busy afternoon: one orchestrator session fans out work to agents in separate web-app worktrees.
{
  const start = local(BUSY_DAY, 13.25);
  sessions.push(makeSession({ harness: "claude-code", projectKey: "web", start: start - 15 * MIN, minutes: 250, prompts: 30, model: "claude-opus-4-8", compactions: 2 }));
  WORKTREES.forEach((worktree, index) => {
    sessions.push(
      makeSession({
        harness: index % 4 === 3 ? "codex" : "claude-code",
        projectKey: "web",
        worktree,
        start: start + index * 11 * MIN,
        minutes: int(70, 140),
        prompts: int(5, 9),
        model: index % 4 === 3 ? "gpt-5.4" : "claude-sonnet-4-6",
        agentDriven: true,
      }),
    );
  });
}

sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));

// ---------------------------------------------------------------------------
// The model-run layer: facets and a narrative, as the person's own agent would write them
// ---------------------------------------------------------------------------

const GOALS = { api: ["feature", "bug_fix", "refactor"], web: ["feature", "bug_fix", "tests"], infra: ["devops", "debugging"], data: ["data_analysis", "bug_fix"], docs: ["docs", "writing"] };
const facets = sessions
  .filter((session) => Date.parse(session.startTime) >= Date.parse("2026-10-20T00:00:00Z"))
  .map((session) => {
    const key = Object.keys(PROJECTS).find((name) => (session.projectRoot ?? "").endsWith(PROJECTS[name].path.split("/").pop()));
    const outcome = weighted([["fully_achieved", 10], ["mostly_achieved", 7], ["partially_achieved", 3], ["not_achieved", 1]]);
    const friction = outcome === "fully_achieved" ? {} : { [pick(["buggy_code", "wrong_approach", "environment_issue", "context_loss", "misunderstood_request"])]: int(1, 2) };
    return {
      sessionId: session.id,
      harness: session.harness,
      underlyingGoal: session.prompts[0]?.text ?? "Implement the task the orchestrator assigned",
      goalCategories: [pick(GOALS[key ?? "web"])],
      sessionType: session.userMessageCount <= 2 ? "quick_question" : weighted([["single_task", 5], ["iterative_refinement", 4], ["multi_task", 2]]),
      outcome,
      helpfulness: weighted([["essential", 3], ["very_helpful", 5], ["moderately_helpful", 2]]),
      satisfaction: outcome === "not_achieved" ? "dissatisfied" : weighted([["satisfied", 5], ["likely_satisfied", 4], ["neutral", 1]]),
      primarySuccess: pick(["correct_code_edits", "multi_file_changes", "good_debugging", "fast_accurate_search", null]),
      frictions: friction,
      frictionDetail: Object.keys(friction).length ? "The first approach needed a correction before it worked." : "",
      summary: "Synthetic demo session.",
      drivenBy: session.agentMessageCount ? "agent" : "person",
    };
  });

const COVERAGE = [
  { harness: "claude-code", label: "Claude Code", found: true, files: 0, sessions: 0, bytes: 1_480_000_000, issues: 0, oldest: null, newest: null },
  { harness: "codex", label: "Codex", found: true, files: 0, sessions: 0, bytes: 310_000_000, issues: 0, oldest: null, newest: null },
  { harness: "cursor", label: "Cursor", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null },
  { harness: "pi", label: "Pi", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null },
  { harness: "opencode", label: "OpenCode", found: false, files: 0, sessions: 0, issues: 0, oldest: null, newest: null },
].map((entry) => {
  const own = sessions.filter((session) => session.harness === entry.harness);
  if (!own.length) return entry;
  return { ...entry, files: own.length, sessions: own.length, oldest: own[0].startTime, newest: own[own.length - 1].endTime };
});

const deterministic = buildReport({ sessions, coverage: COVERAGE, timeZone: ZONE, now: NOW, facets });
const idOf = (kind) => deterministic.findings.find((finding) => finding.kind === kind)?.id;

const narrative = {
  headline:
    "You split your weeks between acme-api and web-app, and on busy afternoons you run several agents side by side. Most sessions land. The time you lose goes to an e2e suite that cannot pass on this machine and to long sessions that run out of context.",
  workAreas: [
    { name: "Orders and billing API", sessions: 0, description: "Pagination, invoices and the billing webhook in acme-api: feature work with a steady test loop." },
    { name: "Checkout and account pages", sessions: 0, description: "web-app UI work, from bug fixes to a full afternoon of parallel agents across worktrees." },
    { name: "Data pipeline", sessions: 0, description: "Revenue transforms and loaders; short sessions, mostly debugging numbers." },
    { name: "Deploys", sessions: 0, description: "Staging rollouts and CI jobs in infra, with many shell commands and some blocked ones." },
  ],
  interactionStyle:
    "You open with a one-line goal and steer with short follow-ups. You correct early when the agent picks the wrong file, which keeps sessions short. You rarely tell the agent how a project is tested, so it rediscovers the commands each time.",
  wins: [
    { title: "Parallel afternoon on web-app", description: "One orchestrating session handed eight scoped tasks to agents in separate worktrees, and most came back mergeable." },
    { title: "Clean refactors in acme-api", description: "Moving money rounding into one helper touched many files and landed with a green test run." },
    { title: "Quick root causes in the pipeline", description: "The refund double count was traced to one join in a few turns." },
  ],
  frictions: [
    { title: "An e2e suite that cannot pass here", description: "The agent reruns pnpm test:e2e without starting the dev server, then retries the same failing run.", examples: ["Checkout fix: five e2e runs in a row before anyone looked at the error", "Guest checkout test: the suite failed on a connection refused, not on the test"] },
    { title: "Context lost in long sessions", description: "After compaction the agent forgot that the old response shape had to stay, and changed it again.", examples: ["Four-hour pagination session compacted three times"] },
  ],
  suggestions: [
    {
      type: "instructions",
      title: "Say how the e2e suite runs",
      action: "Tell the agent to start the dev server before the e2e suite, and to stop after two identical failures.",
      instructionText:
        "## End-to-end tests\n- Start the app with `pnpm dev` in the background before running `pnpm test:e2e`.\n- If the suite fails twice with the same error, stop and report the error instead of rerunning it.",
      ...(idOf("repeated_failed_command") ? { findingId: idOf("repeated_failed_command") } : {}),
    },
    {
      type: "habit",
      title: "Write a handover before the context fills",
      action: "When a session has been compacted once, have the agent write HANDOFF.md with the goal, what is done and the next step, then start fresh from it.",
      instructionText: "When this session has been compacted once, finish the current step, write HANDOFF.md (goal, done, next step, open questions) and tell me to start a new session from it.",
      ...(idOf("context_resets") ? { findingId: idOf("context_resets") } : {}),
    },
    {
      type: "instructions",
      title: "Write the definition of done down once",
      action: "You keep asking for the linter and type check before 'done'. Put it in the project instructions.",
      instructionText: "## Before you say a change is done\n- Run `pnpm lint` and `pnpm typecheck` and fix what they report.",
      ...(idOf("repeated_instruction") ? { findingId: idOf("repeated_instruction") } : {}),
    },
    {
      type: "model_choice",
      title: "Use a lighter model for quick questions",
      action: "One-line lookups do not need the most expensive model; switch with /model for short sessions.",
    },
  ],
  horizon: [
    {
      title: "Make the parallel afternoon a routine",
      description: "The worktree fan-out worked. A short brief per worktree and a merge checklist would make it repeatable.",
      starterPrompt: "Create a worktree for each task in TASKS.md, start one agent per worktree with that task as its brief, and report which branches pass `pnpm test` when they finish.",
    },
    { title: "Self-checking pull requests", description: "Have the agent open a draft PR, wait for CI, read failures and fix them before asking you to review." },
  ],
};
for (const area of narrative.workAreas) {
  const key = { "Orders and billing API": "api", "Checkout and account pages": "web", "Data pipeline": "data", Deploys: "infra" }[area.name];
  area.sessions = sessions.filter((session) => (session.projectRoot ?? "") === PROJECTS[key].path).length;
}

const report = { ...deterministic, narrative };
const htmlText = renderReport(report);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, htmlText);
if (jsonPath) writeFileSync(resolve(jsonPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `wrote ${outPath} (${Math.round(htmlText.length / 1024)} KB): ${sessions.length} sessions, ${report.findings.length} findings [${report.findings.map((finding) => finding.kind).join(", ")}], peak ${report.activity.parallelSessions.maxConcurrent} at once`,
);
