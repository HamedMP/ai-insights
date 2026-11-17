import { pad, painter, visibleWidth, type Paint, type Style } from "./terminal.js";

// Kept apart from the rest of the screen so the CLI can draw it before loading the scanner, the analysis and zod.

export interface Glyphs {
  h: string;
  v: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
  dot: string;
  arrow: string;
  persona: string;
  finding: string;
  report: string;
  notice: string;
}

export const UNICODE: Glyphs = { h: "─", v: "│", tl: "╭", tr: "╮", bl: "╰", br: "╯", dot: "·", arrow: "→", persona: "◆", finding: "▲", report: "▸", notice: "!" };
export const ASCII: Glyphs = { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+", dot: "-", arrow: "->", persona: "*", finding: "!", report: ">", notice: "!" };

/**
 * The Matrix OS rabbit mascot (site/public/media/rabbit.svg, 61x80), ten rows high. Made once at design time:
 * the artwork was rasterised and its coverage sampled, ears and head as quadrant blocks (2x2 per cell) and
 * each of the five body strokes along its own centre line, since the strokes sit 8 units apart, one per row.
 * The ASCII one is drawn by hand over the same outline: two ears, the head, five strokes and the tail.
 */
export const RABBIT_UNICODE = [
  "       ▀▄▄",
  "    ▄▄▖ ▀▜▄",
  "     ▀▛█▄ ▀▙",
  "       ▝▀▀▌▝▄▄",
  "           ▐██▙",
  "       ▝▀▀▀▀▝",
  "    ▀▀▀▀▀ ▀▝▀▘",
  "  ▝▀▀▀▀▘▀ ▀▀▀▘",
  "  ▀▀▀▀▀▘▀▘ ▀▀",
  "▀▀ ▀▘▝▀▀▘▝▘ ▀",
];
export const RABBIT_ASCII = [
  String.raw`       \._`,
  String.raw`    ._  '\.`,
  String.raw`     '\. '\.`,
  String.raw`        ''  .-.`,
  String.raw`           (  o)`,
  String.raw`       ======`,
  String.raw`    ===== = ==`,
  String.raw`  ====== = ===`,
  String.raw`  ======= = ==`,
  String.raw`() ======== =`,
];
const MARK_WIDTH = 16;
/** The wordmark sits beside the middle of the mark. */
const NAME_ROW = 4;

// Two-row block letters for the wordmark.
const LETTERS: Record<string, [string, string]> = {
  A: ["▄▀█", "█▀█"],
  I: ["█", "█"],
  N: ["█▄ █", "█ ▀█"],
  S: ["█▀", "▄█"],
  G: ["█▀▀", "█▄█"],
  H: ["█ █", "█▀█"],
  T: ["▀█▀", " █ "],
  " ": [" ", " "],
};

function blockWord(text: string): [string, string] {
  const top: string[] = [];
  const bottom: string[] = [];
  for (const char of text) {
    const [a, b] = LETTERS[char]!;
    top.push(a);
    bottom.push(b);
  }
  return [top.join(" "), bottom.join(" ")];
}

function headerLines(version: string, style: Style, paint: Paint, glyphs: Glyphs): string[] {
  const width = style.width;
  const tagline = `${paint("muted", "by")} ${paint("brand", "Matrix OS", true)} ${paint("muted", `${glyphs.dot} v${version}`)}`;
  const rabbit = style.unicode ? RABBIT_UNICODE : RABBIT_ASCII;
  const indent = 2 + MARK_WIDTH + 4;
  if (indent + visibleWidth(tagline) > width) {
    // Too narrow for the name beside the mark: the mark above it, or the name alone in a tiny window.
    const name = [`  ${paint("strong", "AI Insights")}`, `  ${tagline}`];
    return 2 + MARK_WIDTH <= width ? [...rabbit.map((row) => `  ${paint("mascot", row)}`.trimEnd()), "", ...name] : name;
  }
  const spaced = style.unicode ? blockWord("AI INSIGHTS") : ["A I   I N S I G H T S"];
  const name = indent + Math.max(...spaced.map(visibleWidth)) <= width ? spaced : ["AI Insights"];
  const right: string[] = [];
  right[NAME_ROW] = paint("strong", name[0]!);
  if (name[1]) right[NAME_ROW + 1] = paint("strong", name[1]);
  right[NAME_ROW + name.length] = tagline;
  return rabbit.map((row, index) => `  ${pad(paint("mascot", row), MARK_WIDTH)}    ${right[index] ?? ""}`.trimEnd());
}

/** The mark and wordmark, with a blank line above and below: the first thing printed, before any work starts. */
export function richHeader(version: string, style: Style): string {
  const paint = painter(style);
  return `${["", ...headerLines(version, style, paint, style.unicode ? UNICODE : ASCII), ""].join("\n")}\n`;
}
