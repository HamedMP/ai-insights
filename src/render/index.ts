import { createHash } from "node:crypto";
import type { Report } from "../schema/types.js";
import { closingChapter, frictionChapter, improveChapter, insightChapter, insightsPromptChapter } from "./chapters/advice.js";
import { indexActions } from "./chapters/common.js";
import { coverageChapter, delegationChapter, parallelChapter, rhythmChapter, usageChapter, type ChapterInput } from "./chapters/data.js";
import { hookSection, MARK, type NavItem } from "./chapters/hook.js";
import { createContext } from "./components.js";
import { formatDate, safeTimeZone } from "./format.js";
import { html, raw, type SafeHtml } from "./html.js";
import { SCRIPT } from "./script.js";
import { buildStory, chapterTips, rankActions } from "./story.js";
import { STYLES } from "./styles.js";

const SCRIPT_HASH = createHash("sha256").update(SCRIPT).digest("base64");

/**
 * Nothing may load from anywhere: an escaping bug still cannot fetch a
 * resource or run an injected script, because only our script's hash runs.
 * Links need no allowance; a click is a navigation, not a load.
 */
const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; img-src data:; base-uri 'none'; form-action 'none'`;

type Builder = (input: ChapterInput) => SafeHtml | null;

/** Chapters in reading order: the facts first, then the agent's read, then what to do. */
const CHAPTERS: Array<{ id: string; label: string; build: Builder }> = [
  { id: "rhythm", label: "Rhythm", build: rhythmChapter },
  { id: "delegation", label: "Delegation", build: delegationChapter },
  { id: "parallel", label: "Parallel", build: parallelChapter },
  { id: "coverage", label: "Where", build: coverageChapter },
  { id: "usage", label: "Cost", build: usageChapter },
  { id: "story", label: "Your agent's read", build: (input) => (input.context.report.narrative || input.context.report.facets ? insightChapter(input) : null) },
  { id: "insights-prompt", label: "Add the why", build: (input) => (input.context.report.narrative ? null : insightsPromptChapter(input)) },
  { id: "friction", label: "Friction", build: frictionChapter },
];

/** Render a report as one self-contained HTML document: inline CSS, JS and SVG, no network. */
export function renderReport(report: Report): string {
  const context = createContext(report, safeTimeZone(String(report.timeZone ?? "UTC")));
  const story = buildStory(report, context.zone);
  const tips = chapterTips(report);
  const ranked = rankActions(report);
  const actions = indexActions([...ranked.top, ...ranked.rest]);

  const built: Array<{ id: string; label: string; content: SafeHtml }> = [];
  let index = 1;
  for (const entry of CHAPTERS) {
    const content = entry.build({ context, story, tips, actions, index });
    if (content) {
      built.push({ id: entry.id, label: entry.label, content });
      index += 1;
    }
  }
  const improve = improveChapter({ context, story, tips, actions, index, ranked });
  if (improve) built.push({ id: "improve", label: "Improve", content: improve });
  const closing = closingChapter({ context, story, tips, actions, index });

  const nav: NavItem[] = built.filter((entry) => entry.id !== "insights-prompt").map(({ id, label }) => ({ id, label }));
  const generated = formatDate(report.generatedAt, context.zone);

  const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${raw(CSP)}">
<meta name="color-scheme" content="dark light">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="AI Insights">
<title>${generated ? `AI Insights · ${generated}` : "AI Insights report"}</title>
<style>${raw(STYLES)}</style>
</head>
<body>
<main>
${hookSection(context, story, nav)}
${built.map((entry) => entry.content)}
${closing}
</main>
<footer><span class="brand small">${MARK}<span>ai insights</span></span><p>Generated${generated ? ` on ${generated}` : ""} from your local agent history. Days and hours are in ${context.zone}. Nothing in this report was uploaded, and it loads nothing from the network.</p></footer>
<script>${raw(SCRIPT)}</script>
</body>
</html>
`;
  return document.value;
}
