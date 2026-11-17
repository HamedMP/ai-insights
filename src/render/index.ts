import { clientAssets } from "./assets.js";
import { safeTimeZone } from "./format.js";
import type { RenderExtras } from "../schema/types.js";
import { buildView, type PageView, type RenderInput } from "./view.js";
import { eventBanner } from "./event-banner.js";

export type { PageView, RenderInput, RunSnapshotInput } from "./view.js";
export { buildView, recapView } from "./view.js";

/** JSON for an inline data block: `<` is escaped so text in the report can never close the tag. */
function dataJson(view: PageView): string {
  return JSON.stringify(view).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * Nothing may load from anywhere: an escaping bug still cannot fetch a resource or run an injected script,
 * because only our script's hash runs. The data block is JSON, which CSP does not execute. `blob:` serves the
 * exported video preview and downloads; `data:` the fonts and the frames rasterised for export.
 */
function csp(hash: string): string {
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; img-src data: blob:; font-src data:; media-src blob:; base-uri 'none'; form-action 'none'`;
}

const escapeText = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Render a report as one self-contained HTML document: inline CSS, JS, fonts and data, no network.
 * `extras.runs` are the saved snapshots, oldest first, this run last, for the "over time" section.
 */
export function renderReport(report: RenderInput, extras: RenderExtras = {}): string {
  const zone = safeTimeZone(String(report.timeZone ?? "UTC"));
  const view = buildView(report, zone, extras);
  const assets = clientAssets();
  const banner = eventBanner(view.recap !== null);
  const title = view.generatedLabel ? `AI Insights · ${view.generatedLabel}` : "AI Insights report";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp(assets.scriptHash)}">
<meta name="color-scheme" content="light">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="AI Insights">
<title>${escapeText(title)}</title>
<style id="card-css">${assets.cardCss}</style>
<style>${assets.pageCss}</style>
</head>
<body>
<noscript><p class="noscript">This report draws its charts and cards with JavaScript, which is turned off. Open it in a browser with JavaScript on; it still loads nothing from the network.</p></noscript>
${banner ? banner + "\n" : ""}<div id="root"></div>
<div id="measure" aria-hidden="true"></div>
<script id="report-data" type="application/json">${dataJson(view)}</script>
${Object.entries(assets.styleFonts).map(([id, css]) => `<script id="style-fonts-${id}" type="text/plain">${css}</script>`).join("\n")}
<script>${assets.script}</script>
</body>
</html>
`;
}
