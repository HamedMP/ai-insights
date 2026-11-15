import { count, formatDate, formatInt, parseInstant, plural } from "../format.js";
import { html, type SafeHtml } from "../html.js";
import { harnessLabel } from "../labels.js";
import { sectionHead, type RenderContext } from "../components.js";
import type { Coverage } from "../../schema/types.js";

const DAY_MS = 86_400_000;

function historyDays(entry: Coverage): number | null {
  const oldest = parseInstant(entry.oldest);
  const newest = parseInstant(entry.newest);
  if (oldest === null || newest === null) return null;
  return Math.max(1, Math.round((newest - oldest) / DAY_MS) + 1);
}

function coverageCard(context: RenderContext, entry: Coverage): SafeHtml {
  const label = entry.label || harnessLabel(entry.harness);
  if (!entry.found) {
    return html`<div class="card off"><div class="card-head"><h3>${label}</h3><span class="status off">Not found</span></div><p class="muted" style="margin-top:10px;font-size:var(--fs-sm)">No history for this tool on this machine.</p></div>`;
  }
  const oldest = formatDate(entry.oldest, context.zone);
  const newest = formatDate(entry.newest, context.zone);
  const days = historyDays(entry);
  return html`<div class="card"><div class="card-head"><h3>${label}</h3><span class="status on">Found</span></div>
<dl class="facts">
<dt>Sessions</dt><dd>${formatInt(entry.sessions)}</dd>
<dt>Transcript files</dt><dd>${formatInt(entry.files)}</dd>
${oldest ? html`<dt>Oldest</dt><dd>${oldest}</dd>` : null}
${newest ? html`<dt>Newest</dt><dd>${newest}</dd>` : null}
${days !== null ? html`<dt>History</dt><dd>${plural(days, "day")}</dd>` : null}
${count(entry.issues) > 0 ? html`<dt>Records skipped</dt><dd>${formatInt(entry.issues)}</dd>` : null}
</dl></div>`;
}

export function coverageSection(context: RenderContext): SafeHtml {
  const coverage = [...(context.report.coverage ?? [])].sort((a, b) => Number(b.found) - Number(a.found));
  const found = coverage.filter((entry) => entry.found);
  const oldest = found.map((entry) => parseInstant(entry.oldest)).filter((ms): ms is number => ms !== null);
  const newest = found.map((entry) => parseInstant(entry.newest)).filter((ms): ms is number => ms !== null);
  let intro: string;
  if (found.length === 0) {
    intro = "No coding-agent history was found on this machine.";
  } else {
    const names = found.map((entry) => entry.label || harnessLabel(entry.harness));
    const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const span = oldest.length > 0 && newest.length > 0 ? Math.round((Math.max(...newest) - Math.min(...oldest)) / DAY_MS) + 1 : null;
    const since = oldest.length > 0 ? formatDate(new Date(Math.min(...oldest)).toISOString(), context.zone) : null;
    intro = `History found for ${list}.${span !== null && since ? ` It goes back ${plural(span, "day")}, to ${since}.` : ""} Records Hindsight could not read are skipped and counted, never guessed at.`;
  }
  return html`<section id="coverage" class="coverage">
${sectionHead("Coverage", "What Hindsight found", intro)}
<div class="grid">${coverage.map((entry) => coverageCard(context, entry))}</div>
</section>`;
}
