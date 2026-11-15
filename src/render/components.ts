import type { Report } from "../schema/types.js";
import { clip } from "./format.js";
import type { Line } from "./story.js";
import { html, type SafeHtml } from "./html.js";

/** Per-render state, so ids are deterministic and unique within one document. */
export interface RenderContext {
  report: Report;
  zone: string;
  nextId(prefix: string): string;
}

export function createContext(report: Report, zone: string): RenderContext {
  const counters = new Map<string, number>();
  return {
    report,
    zone,
    nextId(prefix) {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}-${next}`;
    },
  };
}

export function sectionHead(eyebrow: string, title: string, intro?: string | SafeHtml | null): SafeHtml {
  return html`<header class="section-head"><div class="eyebrow">${eyebrow}</div><h2>${title}</h2>${intro ? html`<p>${intro}</p>` : null}</header>`;
}

export interface Tile {
  value: string;
  label: string;
  sub?: string | null;
}

export function tiles(items: Tile[], label: string, className = ""): SafeHtml {
  return html`<div class="tiles${className ? ` ${className}` : ""}" role="list" aria-label="${label}">${items.map(
    (item) => html`<div class="tile" role="listitem"><span class="value">${item.value}</span><span class="label">${item.label}</span>${item.sub ? html`<span class="sub">${item.sub}</span>` : null}</div>`,
  )}</div>`;
}

export const MAX_COPY_CHARS = 6000;

/** A <pre> with a copy button; the script copies the element's text, never markup. */
export function copyBlock(context: RenderContext, text: string, label: string): SafeHtml {
  const id = context.nextId("copy");
  return html`<div class="copy"><pre id="${id}" tabindex="0" aria-label="${label}">${clip(text, MAX_COPY_CHARS)}</pre><button type="button" data-copy="${id}" aria-label="Copy ${label}">Copy</button></div>`;
}

/**
 * Report text often marks commands with backticks. Show those spans as code;
 * every piece still goes through the escaping \`html\` tag.
 */
export function rich(text: unknown, max: number, maxCode = 48): SafeHtml {
  const value = clip(text, max);
  const parts = value.split(/`([^`\n]{1,300})`/);
  // Long command keys (temp paths, hashes) would swamp a title; the full text is in the title attribute.
  return html`${parts.map((part, index) =>
    index % 2 === 1 ? (part.length > maxCode ? html`<code title="${part}">${clip(part, maxCode)}</code>` : html`<code>${part}</code>`) : part,
  )}`;
}

export function card(content: SafeHtml, className = ""): SafeHtml {
  return html`<div class="card${className ? ` ${className}` : ""}">${content}</div>`;
}

/** A story line as HTML: the strong segments (its numbers and names) are emphasised. */
export function statement(line: Line | null | undefined, className = "statement"): SafeHtml | null {
  if (!line || line.length === 0) return null;
  return html`<p class="${className}">${line.map((segment) => (segment.strong ? html`<em>${segment.text}</em>` : segment.text))}</p>`;
}

export interface ChapterOptions {
  id: string;
  index: number;
  kicker: string;
  lead: Line | null;
  second?: Line | null;
  body: SafeHtml | null;
  tip?: SafeHtml | null;
  className?: string;
}

export function chapter(options: ChapterOptions): SafeHtml {
  return html`<section id="${options.id}" class="chapter${options.className ? ` ${options.className}` : ""}">
<header class="ch-head reveal"><div class="ch-index micro"><span>${String(options.index).padStart(2, "0")}</span><span>${options.kicker}</span></div>${statement(options.lead)}${statement(options.second ?? null, "statement second")}</header>
${options.body ? html`<div class="ch-body">${options.body}</div>` : null}
${options.tip ?? null}
</section>`;
}

export function panel(label: string, content: SafeHtml | null, options: { className?: string; aside?: string | SafeHtml | null } = {}): SafeHtml | null {
  if (!content) return null;
  return html`<div class="panel reveal${options.className ? ` ${options.className}` : ""}"><div class="panel-head micro"><span>${label}</span>${options.aside ? html`<span class="panel-aside">${options.aside}</span>` : null}</div>${content}</div>`;
}
