import { painter, visibleWidth, type Paint, type Style } from "./terminal.js";

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

// An original mark: a rabbit's head with two tall ears, four rows high. The ASCII one keeps the same outline.
const RABBIT_UNICODE = [" █▄  ▄█ ", " ██  ██ ", "▄██████▄", "██▄██▄██", " ▀████▀ "];
const RABBIT_ASCII = [" /|  |\\ ", " ||  || ", ".-'``'-.", "| o  o |", " '-vv-' "];

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
  const indent = 2 + visibleWidth(rabbit[0]!) + 4;
  if (indent + visibleWidth(tagline) > width) return [`  ${paint("strong", "AI Insights")}`, `  ${tagline}`];
  const spaced = style.unicode ? blockWord("AI INSIGHTS") : ["A I   I N S I G H T S"];
  const name = indent + Math.max(...spaced.map(visibleWidth)) <= width ? spaced : ["AI Insights"];
  const right = ["", ...name.map((row) => paint("strong", row)), tagline];
  return rabbit.map((row, index) => `  ${paint("brand", row, true)}    ${right[index] ?? ""}`.trimEnd());
}

/** The mark and wordmark, with a blank line above and below: the first thing printed, before any work starts. */
export function richHeader(version: string, style: Style): string {
  const paint = painter(style);
  return `${["", ...headerLines(version, style, paint, style.unicode ? UNICODE : ASCII), ""].join("\n")}\n`;
}
