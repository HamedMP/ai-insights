/**
 * Every report string is untrusted: prompts, paths and tool names come from
 * transcripts. The `html` tag escapes every interpolation unless it is already
 * `SafeHtml`, so forgetting to escape is not possible by construction.
 */

export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/** Mark trusted, renderer-authored markup. Never pass report text here. */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

function interpolate(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (value === null || value === undefined || value === false || value === true) return "";
  if (Array.isArray(value)) return value.map(interpolate).join("");
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) out += interpolate(values[index]) + (strings[index + 1] ?? "");
  return new SafeHtml(out);
}

export function join(parts: Array<SafeHtml | null | undefined | false>, separator = ""): SafeHtml {
  return new SafeHtml(parts.filter((part): part is SafeHtml => part instanceof SafeHtml).map((part) => part.value).join(separator));
}
