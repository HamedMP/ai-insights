import type { Report, Retention } from "../schema/types.js";
import { describeHeadline, formatUsd } from "../store/pipeline.js";
import { harnessLabel } from "../store/scan.js";
import { MATRIX_URL } from "../render/view.js";
import { ASCII, UNICODE, type Glyphs } from "./header.js";
import { fileUrl, pad, painter, visibleWidth, wrapSegments, type Paint, type Segment, type Style } from "./terminal.js";

export const SITE_URL = "https://ai-insights.app/";
export const TROUBLESHOOTING_URL = "https://ai-insights.app/docs/troubleshooting";
const HASHTAG = "#MyAIInsights";

// -- wording shared by both layouts --------------------------------------------

export function compact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
  return value.toLocaleString("en-US");
}

export function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
}

export function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "?";
}

/** "A", "A and B", "A, B and C". */
function listText(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function topFinding(report: Report) {
  const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
  return [...report.findings].sort((a, b) => rank[a.severity] - rank[b.severity])[0];
}

function agentsFound(report: Report): string[] {
  return report.coverage.filter((entry) => entry.sessions > 0).map((entry) => entry.label);
}

/** Three lines a person can read at a glance: what was covered, how much, and the top finding. */
export function summaryLines(report: Report): string[] {
  const found = agentsFound(report);
  const numbers = describeHeadline(report);
  const top = topFinding(report);
  return [
    `${plural(report.activity.sessions, "session")} across ${found.length > 0 ? listText(found) : "no harness"}, ${day(report.range.from)} to ${day(report.range.to)}.`,
    `${numbers.time} on ${plural(report.activity.activeDays, "day")}; ${compact(report.usage.tokens)} tokens, ${numbers.cost}.`,
    top ? `Top finding: ${top.title}` : "No findings yet: more history makes for better tips.",
  ];
}

interface RetentionParts {
  /** "12 Claude Code sessions can be deleted within 7 days (from 2026-11-18)." */
  what: string;
  /** The settings change that keeps them, or "" when there is none to suggest. */
  fix: string;
}

function retentionParts(retention: Retention | undefined, now: Date): RetentionParts | null {
  if (!retention || retention.atRisk.sessions <= 0) return null;
  const due = retention.harnesses.filter((entry) => (entry.atRisk?.sessions ?? 0) > 0).sort((a, b) => b.atRisk!.sessions - a.atRisk!.sessions);
  const counts = due.map((entry) => `${entry.atRisk!.sessions.toLocaleString("en-US")} ${harnessLabel(entry.harness)}`).join(" and ");
  const noun = retention.atRisk.sessions === 1 ? "session" : "sessions";
  const next = retention.atRisk.nextDeletion ? Date.parse(retention.atRisk.nextDeletion) : Number.NaN;
  const when = Number.isFinite(next) ? (next <= now.getTime() ? " (some at the agent's next start)" : ` (from ${day(new Date(next).toISOString())})`) : "";
  const lead = due[0]!;
  const file = lead.setting?.file;
  const fix =
    lead.source === "managed"
      ? "ask an admin (managed settings set this)"
      : lead.harness === "claude-code" && file
        ? `add "cleanupPeriodDays": 365 to ${file}`
        : lead.harness === "gemini" && file
          ? `set general.sessionRetention.maxAge to "365d" in ${file}`
          : "";
  return { what: `${counts} ${noun} can be deleted within ${plural(retention.windowDays, "day")}${when}.`, fix };
}

/**
 * One line when transcripts are about to be deleted, naming the change that keeps them; null otherwise.
 * "12 Claude Code sessions can be deleted within 7 days (from 2026-11-18). ..."
 */
export function retentionLine(retention: Retention | undefined, now: Date): string | null {
  const parts = retentionParts(retention, now);
  if (!parts) return null;
  return `${parts.what} AI Insights keeps their stats; to keep the transcripts, ${parts.fix ? `${parts.fix} or ` : ""}archive them with \`npx packmem archive\`.`;
}

export interface ResultInput {
  report: Report;
  htmlPath: string;
  version: string;
  now: Date;
  /** How the report reaches the browser: opened now (--open), a question after the screen, or by hand. */
  open: "now" | "ask" | "manual";
  /** Facets or a narrative are saved, so the agent review has run. */
  reviewed: boolean;
}

interface Step {
  title: string;
  detail: Segment[];
}

/**
 * What to do with the report, in the order people do it. Button labels are the report's own (src/render/client/page.js)
 * and the website's (/share), so the words match what is on screen.
 */
function nextSteps(input: ResultInput, rich: boolean): Step[] {
  const label = (text: string): Segment => (rich ? { text, bold: true, keep: true } : `"${text}"`);
  const code = (text: string): Segment => (rich ? { text, tone: "accent", keep: true } : text);
  const steps: Step[] = [];
  if (rich) {
    const open: Segment[] =
      input.open === "now"
        ? ["opening it in your browser now."]
        : input.open === "ask"
          ? ["press Enter below to open it in your browser, or click the report path above."]
          : ["click the report path above, or add ", code("--open"), " next time."];
    steps.push({ title: "Open", detail: open });
    if (input.report.recap) {
      steps.push({ title: "Play", detail: [label("Play your recap"), " in the report, then ", label("Make a video"), " to export it."] });
      steps.push({
        title: "Publish",
        detail: [
          label("Join the leaderboard"),
          ", then ",
          label("Publish to the leaderboard"),
          "; sign in on ",
          { text: "ai-insights.app", url: SITE_URL, tone: "accent", keep: true },
          " and press ",
          label("Publish"),
          ". Your profile: ",
          { text: "ai-insights.app/u/<handle>", url: `${SITE_URL}leaderboard`, tone: "accent", keep: true },
        ],
      });
      steps.push({ title: "Share", detail: ["post your cards or profile with ", { text: HASHTAG, tone: "brand", bold: true, keep: true }, "."] });
    }
    if (!input.reviewed) steps.push({ title: "Go deeper", detail: ["run the ", code("analyze-ai-usage"), " skill in your agent."] });
    return steps;
  }
  steps.push({ title: "Open the report", detail: [input.open === "now" ? "opening it in your browser now." : "open the file above in your browser, or run again with --open."] });
  if (input.report.recap) {
    steps.push({ title: "Play your recap", detail: ["press ", label("Play your recap"), " in the report; ", label("Make a video"), " saves it as a video or images."] });
    steps.push({
      title: "Publish to the leaderboard",
      detail: ["in the report press ", label("Join the leaderboard"), ", then ", label("Publish to the leaderboard"), "; sign in on ", SITE_URL, " and press ", label("Publish"), `. Your profile: ${SITE_URL}u/<handle>`],
    });
    steps.push({ title: "Share it", detail: [`use the X or LinkedIn buttons in the report, or post your cards with ${HASHTAG}.`] });
  }
  if (!input.reviewed) steps.push({ title: "Go deeper", detail: ["run the analyze-ai-usage skill in your agent to add what went well and what got in the way."] });
  return steps;
}

function personaText(report: Report): { title: string; earned: string[]; reason: string } | null {
  const persona = report.recap?.persona;
  if (!persona) return null;
  return { title: persona.title, earned: (persona.earned ?? []).map((title) => title.title), reason: persona.reason };
}

// -- plain text: piped, CI, dumb terminals --------------------------------------

const plainText = (segments: Segment[]) => segments.map((segment) => (typeof segment === "string" ? segment : segment.text)).join("");

/** Stable text with no escape codes: the summary, the report path, any notice, then numbered steps. */
export function plainResult(input: ResultInput): string {
  const lines = summaryLines(input.report);
  const persona = personaText(input.report);
  if (persona) lines.push(`Persona: ${persona.title}${persona.earned.length ? ` (also ${listText(persona.earned)})` : ""}`);
  lines.push("", `Report: ${input.htmlPath}`);
  const keep = retentionLine(input.report.retention, input.now);
  if (keep) lines.push(keep);
  lines.push("", "Next steps");
  nextSteps(input, false).forEach((step, index) => lines.push(`  ${index + 1}. ${step.title}: ${plainText(step.detail)}`));
  return `${lines.join("\n")}\n`;
}

// -- the designed screen ---------------------------------------------------------

function hoursValue(hours: number): string {
  return hours < 10 ? hours.toFixed(1).replace(/\.0$/u, "") : Math.round(hours).toLocaleString("en-US");
}

function statsPanel(input: ResultInput, style: Style, paint: Paint, glyphs: Glyphs): string[] {
  const { report } = input;
  const numbers = describeHeadline(report);
  // Two columns of margin each side: a line that fills the last column makes some terminals wrap early.
  const outer = style.width - 4;
  const inner = outer - 4;
  const cost = numbers.estimatedUsd === null ? "n/a" : `${formatUsd(numbers.estimatedUsd)}${numbers.unpricedRequests > 0 ? "+" : ""}`;
  const tiles: Array<[string, string]> = [
    [report.activity.sessions.toLocaleString("en-US"), report.activity.sessions === 1 ? "session" : "sessions"],
    [report.activity.activeDays.toLocaleString("en-US"), report.activity.activeDays === 1 ? "active day" : "active days"],
    numbers.activeHours === null ? [hoursValue(numbers.agentHours), "agent-hours"] : [hoursValue(numbers.activeHours), "active hours"],
    [compact(report.usage.tokens), "tokens"],
    [cost, "est. cost"],
  ];
  // A grid like a scoreboard: equal cells spread across the panel, as many per row as fit.
  const gap = 3;
  const widest = Math.max(...tiles.map((tile) => Math.max(visibleWidth(tile[0]), visibleWidth(tile[1]))));
  const columns = Math.max(1, Math.min(tiles.length, Math.floor((inner + gap) / (widest + gap))));
  const cell = Math.max(widest + gap, Math.floor(inner / columns));
  const rows: Array<Array<[string, string]>> = [];
  for (let index = 0; index < tiles.length; index += columns) rows.push(tiles.slice(index, index + columns));
  const body: string[] = [];
  for (const row of rows) {
    const values = row.map((tile, index) => (index === row.length - 1 ? paint("accent", tile[0], true) : pad(paint("accent", tile[0], true), cell))).join("");
    const labels = row.map((tile, index) => (index === row.length - 1 ? paint("muted", tile[1]) : pad(paint("muted", tile[1]), cell))).join("");
    body.push(values, labels);
  }
  const notes: string[] = [];
  const agents = agentsFound(report);
  if (agents.length) notes.push(agents.join(", "));
  if (numbers.activeHours !== null) notes.push(`${hoursValue(numbers.agentHours)} agent-hours in parallel`);
  if (numbers.estimatedUsd === null) notes.push(numbers.requests > 0 ? "no request could be priced" : "no model requests to price");
  else if (numbers.unpricedRequests > 0) notes.push(`${numbers.unpricedShare < 0.01 ? "<1%" : `${Math.round(numbers.unpricedShare * 100)}%`} of requests unpriced`);
  else notes.push("API list prices");
  // A no-break space ties each dot to the note before it, so a wrapped line never starts with one.
  body.push("", ...wrapSegments([{ text: notes.join(`\u00a0${glyphs.dot} `), tone: "muted" }], inner, style));

  const title = ` ${day(report.range.from)} ${glyphs.arrow} ${day(report.range.to)} `;
  const frame = (text: string) => paint("muted", text);
  const top =
    visibleWidth(title) + 4 <= outer
      ? `${frame(`${glyphs.tl}${glyphs.h}`)}${paint("strong", title)}${frame(`${glyphs.h.repeat(outer - 3 - visibleWidth(title))}${glyphs.tr}`)}`
      : frame(`${glyphs.tl}${glyphs.h.repeat(outer - 2)}${glyphs.tr}`);
  const lines = [`  ${top}`];
  for (const line of body) lines.push(`  ${frame(glyphs.v)} ${pad(line, inner)} ${frame(glyphs.v)}`);
  lines.push(`  ${frame(`${glyphs.bl}${glyphs.h.repeat(outer - 2)}${glyphs.br}`)}`);
  return lines;
}

function rule(text: string, style: Style, paint: Paint, glyphs: Glyphs): string {
  const lead = `  ${paint("strong", text)} `;
  return `${lead}${paint("muted", glyphs.h.repeat(Math.max(0, style.width - 2 - visibleWidth(lead))))}`;
}

/** The result screen people see on a terminal: mark, numbers, persona, top finding, the report link, then what to do next. */
export function richResult(input: ResultInput, style: Style): string {
  const paint = painter(style);
  const glyphs = style.unicode ? UNICODE : ASCII;
  // Text stops two columns short of the edge, where the panel's frame ends.
  const width = style.width - 2;
  // The header (src/cli/header.ts) is printed before the scan; this is everything after it.
  const lines: string[] = [...statsPanel(input, style, paint, glyphs), ""];

  const persona = personaText(input.report);
  if (persona) {
    lines.push(...wrapSegments([{ text: persona.title, tone: "brand", bold: true, keep: true }], width, style, `  ${paint("brand", glyphs.persona)} `, "    "));
    if (persona.earned.length) {
      const earned: Segment[] = [{ text: "also", tone: "muted" }];
      persona.earned.forEach((title, index) => earned.push({ text: index === 0 ? " " : ` ${glyphs.dot} `, tone: "muted" }, { text: title, tone: "strong", keep: true }));
      lines.push(...wrapSegments(earned, width, style, "    "));
    }
  }
  const top = topFinding(input.report);
  lines.push(
    ...wrapSegments(
      top ? [{ text: "Top finding", tone: "warn", bold: true, keep: true }, `  ${top.title}`] : [{ text: "No findings yet:", tone: "warn", bold: true }, " more history makes for better tips."],
      width,
      style,
      `  ${paint("warn", glyphs.finding)} `,
      "    ",
    ),
  );
  lines.push(
    ...wrapSegments([{ text: "Report", tone: "accent", bold: true, keep: true }, "  ", { text: input.htmlPath, url: fileUrl(input.htmlPath), keep: true }], width, style, `  ${paint("accent", glyphs.report)} `, "    "),
  );

  lines.push("", rule("What to do next", style, paint, glyphs));
  const steps = nextSteps(input, true);
  const titleWidth = Math.max(...steps.map((step) => visibleWidth(step.title)));
  const side = width - (5 + titleWidth + 2) >= 36;
  steps.forEach((step, index) => {
    const number = `  ${paint("brand", String(index + 1), true)}  `;
    if (side) {
      const lead = `${number}${pad(paint("strong", step.title), titleWidth + 2)}`;
      lines.push(...wrapSegments(step.detail, width, style, lead, " ".repeat(visibleWidth(lead))));
    } else {
      lines.push(`${number}${paint("strong", step.title)}`);
      lines.push(...wrapSegments(step.detail, width, style, "     "));
    }
  });

  const keep = retentionParts(input.report.retention, input.now);
  if (keep) {
    const segments: Segment[] = [{ text: keep.what, tone: "warn" }, " Keep them: "];
    if (keep.fix) segments.push(`${keep.fix} or `);
    segments.push("run ", { text: "npx packmem archive", tone: "accent", keep: true }, ".");
    lines.push("", ...wrapSegments(segments, width, style, `  ${paint("warn", glyphs.notice, true)} `, "    "));
  }
  // The report's own closing link, word for word: nothing here uploads history, so claim no more than it does.
  lines.push(
    "",
    ...wrapSegments(
      [{ text: "Keep your history with Matrix OS", bold: true }, `  ${glyphs.arrow}  `, { text: MATRIX_URL.replace(/^https:\/\//u, ""), url: MATRIX_URL, tone: "accent", keep: true }],
      width,
      style,
      "  ",
    ),
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function resultScreen(input: ResultInput, style: Style): string {
  return style.rich ? richResult(input, style) : plainResult(input);
}

// -- when things go wrong --------------------------------------------------------

/** No sessions: what happened, what to try, and where the docs are. The first line is the one the docs quote. */
export function noHistoryText(filters: string[]): string {
  const lines = ["No agent sessions found. Run `ai-insights doctor` to see where AI Insights looked."];
  lines.push("AI Insights reads Claude Code, Codex, Cursor, Pi, OpenCode and Gemini CLI history from their usual folders on this machine.");
  if (filters.length) lines.push(`Your filters (${filters.join(", ")}) may leave nothing: try again without them.`);
  lines.push(`More help: ${TROUBLESHOOTING_URL}`);
  return `${lines.join("\n")}\n`;
}

export function failureHint(): string {
  return `Run it again with AI_INSIGHTS_DEBUG=1 for the details, or see ${TROUBLESHOOTING_URL}\n`;
}
