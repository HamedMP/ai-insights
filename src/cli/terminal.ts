import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/** What the output stream is, as the CLI sees it. Tests pass this in; the real CLI reads process.stdout. */
export interface TerminalInfo {
  /** stdout. */
  isTTY: boolean;
  columns?: number;
  /** stdin is a terminal a person can answer from. */
  stdin?: boolean;
  /** stderr is a terminal, where the progress line goes. */
  stderr?: boolean;
}

export interface Style {
  /** The designed result screen. Off when piped (stable plain text) and on dumb terminals. */
  rich: boolean;
  /** 0 none, 1 sixteen colours, 2 the 256-colour palette, 3 truecolor. */
  color: 0 | 1 | 2 | 3;
  /** Block and box-drawing characters, or plain ASCII. */
  unicode: boolean;
  /** OSC 8 links. Every link also prints its target or a readable label, so a terminal that ignores them loses nothing. */
  hyperlinks: boolean;
  /** Light background, when the terminal says so (COLORFGBG); picks darker shades. */
  light: boolean;
  /** Columns to lay out in: the terminal's width, at most MAX_WIDTH. */
  width: number;
}

/** Lines longer than this are hard to read, however wide the window. */
export const MAX_WIDTH = 80;
const MIN_WIDTH = 20;

function forcedLevel(value: string | undefined): Style["color"] | null {
  if (value === undefined) return null;
  const normalised = value.trim().toLowerCase();
  if (normalised === "0" || normalised === "false") return 0;
  if (normalised === "2") return 2;
  if (normalised === "3") return 3;
  return 1;
}

function unicodeLikely(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (env.TERM === "linux") return false;
  if (platform !== "win32") return true;
  // The classic Windows console host renders box characters as question marks; the modern hosts below do not.
  return Boolean(
    env.WT_SESSION ||
      env.TERMINUS_SUBLIME ||
      env.ConEmuTask === "{cmd::Cmder}" ||
      env.TERM_PROGRAM === "vscode" ||
      env.TERM === "xterm-256color" ||
      env.TERM === "alacritty" ||
      env.TERMINAL_EMULATOR === "JetBrains-JediTerm",
  );
}

/**
 * NO_COLOR (any non-empty value) turns colour and links off; FORCE_COLOR turns them on even when piped, and wins
 * over NO_COLOR as it does for Node itself. TERM=dumb gets plain text.
 */
export function detectStyle(env: NodeJS.ProcessEnv, terminal: TerminalInfo | undefined, platform: NodeJS.Platform = process.platform): Style {
  const tty = terminal?.isTTY === true;
  const dumb = env.TERM === "dumb";
  const forced = forcedLevel(env.FORCE_COLOR);
  const noColor = typeof env.NO_COLOR === "string" && env.NO_COLOR !== "";
  let color: Style["color"];
  if (forced !== null) color = forced;
  else if (noColor || !tty || dumb) color = 0;
  else if (env.COLORTERM === "truecolor" || env.COLORTERM === "24bit") color = 3;
  else if (/256/.test(env.TERM ?? "") || platform === "win32") color = 2;
  else color = 1;
  const rich = !dumb && (tty || (forced !== null && forced > 0));
  const hyperlinkSetting = forcedLevel(env.FORCE_HYPERLINK);
  // The Linux console has no OSC 8 and can print the sequence as junk.
  const hyperlinks = rich && (hyperlinkSetting !== null ? hyperlinkSetting > 0 : color > 0 && env.TERM !== "linux");
  const envColumns = Number(env.COLUMNS);
  const columns = terminal?.columns && terminal.columns > 0 ? terminal.columns : Number.isInteger(envColumns) && envColumns > 0 ? envColumns : MAX_WIDTH;
  const background = (env.COLORFGBG ?? "").split(";").at(-1);
  return {
    rich,
    color,
    unicode: rich && unicodeLikely(env, platform),
    hyperlinks,
    light: background === "7" || background === "15",
    width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, columns)),
  };
}

// -- links --------------------------------------------------------------------

/**
 * A file:// URL for a local path. pathToFileURL percent-encodes spaces, non-ASCII and controls; the second pass
 * encodes anything else outside printable ASCII so the URL can never end or break the escape sequence it sits in.
 */
export function fileUrl(path: string): string {
  return pathToFileURL(path).href.replace(/[^\x21-\x7e]/gu, (char) => encodeURIComponent(char));
}

const OSC = "\u001b]8;";
const ST = "\u001b\\";

/** Wraps visible text in an OSC 8 link. `id` lets a terminal treat a link split over several lines as one. */
export function hyperlink(url: string, text: string, id?: string): string {
  const safe = url.replace(/[^\x21-\x7e]/gu, (char) => encodeURIComponent(char));
  return `${OSC}${id ? `id=${id}` : ""};${safe}${ST}${text}${OSC};${ST}`;
}

export function linkId(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

// -- measuring ----------------------------------------------------------------

// CSI sequences (colours) and OSC sequences (links), terminated by BEL or ST.
const ANSI = /\u001b\[[0-9;]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

function charWidth(codePoint: number): number {
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  // Combining marks and zero-width joiners take no column.
  if ((codePoint >= 0x300 && codePoint <= 0x36f) || codePoint === 0x200d || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/** Columns the text takes on screen, escape codes excluded. */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const char of stripAnsi(text)) width += charWidth(char.codePointAt(0)!);
  return width;
}

/** Splits text into chunks of at most `width` columns, never inside a character. */
export function chunk(text: string, width: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let used = 0;
  for (const char of text) {
    const w = charWidth(char.codePointAt(0)!);
    if (used + w > width && current) {
      chunks.push(current);
      current = "";
      used = 0;
    }
    current += char;
    used += w;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks;
}

// -- colour -------------------------------------------------------------------

export type Tone = "brand" | "accent" | "muted" | "warn" | "strong" | "plain";

const SHADES: Record<Exclude<Tone, "strong" | "plain">, { dark: [number, number, number]; light: [number, number, number]; c256: number; c16: number }> = {
  // The site's orange and a terminal green; darker shades on light backgrounds keep the contrast.
  brand: { dark: [255, 122, 47], light: [194, 65, 12], c256: 208, c16: 33 },
  accent: { dark: [74, 222, 128], light: [21, 128, 61], c256: 78, c16: 32 },
  muted: { dark: [140, 140, 150], light: [100, 100, 110], c256: 245, c16: 90 },
  warn: { dark: [250, 204, 21], light: [161, 98, 7], c256: 220, c16: 33 },
};

export interface Paint {
  (tone: Tone, text: string, bold?: boolean): string;
}

export function painter(style: Style): Paint {
  return (tone, text, bold = false) => {
    if (style.color === 0 || text === "") return text;
    let open = bold || tone === "strong" ? "1;" : "";
    if (tone !== "strong" && tone !== "plain") {
      const shade = SHADES[tone];
      const [r, g, b] = style.light ? shade.light : shade.dark;
      open += style.color === 3 ? `38;2;${r};${g};${b}` : style.color === 2 ? `38;5;${shade.c256}` : `${shade.c16}`;
    }
    open = open.replace(/;$/u, "");
    if (!open) return text;
    return `\u001b[${open}m${text}\u001b[0m`;
  };
}

// -- wrapping -----------------------------------------------------------------

/** A piece of a line: plain words, or text with a tone, a link, or kept on one line (`keep`). */
export type Segment = string | { text: string; tone?: Tone; bold?: boolean; url?: string; keep?: boolean };

interface Piece {
  text: string;
  tone: Tone;
  bold: boolean;
  url?: string;
  /** Spaces before this piece when it does not start a line; two keep a deliberate gap. */
  spaceBefore: number;
}

function pieces(segments: Segment[]): Piece[] {
  const out: Piece[] = [];
  let pendingSpace = 0;
  for (const segment of segments) {
    const seg = typeof segment === "string" ? { text: segment } : segment;
    const tone = seg.tone ?? "plain";
    const bold = seg.bold ?? false;
    const extra = seg.url ? { url: seg.url } : {};
    if (seg.keep || seg.url) {
      const leading = /^\s*/u.exec(seg.text)![0].length;
      const text = seg.text.trim();
      if (text) out.push({ text, tone, bold, ...extra, spaceBefore: Math.max(pendingSpace, leading) });
      pendingSpace = /\s*$/u.exec(seg.text)![0].length;
      continue;
    }
    // ASCII whitespace only: a no-break space (U+00A0) keeps two words on one line.
    const parts = seg.text.split(/([ \t\n]+)/u);
    for (const part of parts) {
      if (part === "") continue;
      if (/^[ \t\n]+$/u.test(part)) {
        pendingSpace = Math.max(pendingSpace, part.length);
        continue;
      }
      out.push({ text: part, tone, bold, ...extra, spaceBefore: pendingSpace });
      pendingSpace = 0;
    }
  }
  if (out[0]) out[0].spaceBefore = 0;
  return out;
}

function renderPiece(piece: Piece, raw: string, style: Style, paint: Paint): string {
  const painted = paint(piece.tone, raw.replace(/\u00a0/gu, " "), piece.bold);
  if (!piece.url || !style.hyperlinks) return painted;
  return hyperlink(piece.url, painted, linkId(piece.url));
}

/**
 * Lays styled segments out in lines of at most `width` columns, the first line after `first` and the rest after
 * `rest` (a hanging indent). A word or link longer than a line is split, and a split link keeps one OSC 8 id.
 */
export function wrapSegments(segments: Segment[], width: number, style: Style, first = "", rest = first): string[] {
  const paint = painter(style);
  const lines: string[] = [];
  let line = first;
  let used = visibleWidth(first);
  let empty = true;
  const restWidth = visibleWidth(rest);
  const newLine = () => {
    lines.push(line.trimEnd());
    line = rest;
    used = restWidth;
    empty = true;
  };
  // Group pieces with no space between them (a link and the comma after it) so they move to the next line together.
  const words: Piece[][] = [];
  for (const piece of pieces(segments)) {
    if (piece.spaceBefore > 0 || words.length === 0) words.push([piece]);
    else words.at(-1)!.push(piece);
  }
  for (const word of words) {
    const wordWidth = word.reduce((sum, piece) => sum + visibleWidth(piece.text), 0);
    if (!empty && used + word[0]!.spaceBefore + wordWidth > width) newLine();
    if (!empty) {
      line += " ".repeat(word[0]!.spaceBefore);
      used += word[0]!.spaceBefore;
    }
    for (const piece of word) {
      const pieceWidth = visibleWidth(piece.text);
      if (used + pieceWidth <= width) {
        line += renderPiece(piece, piece.text, style, paint);
        used += pieceWidth;
      } else {
        // Longer than what is left: fill this line, carry on below.
        let remaining = piece.text;
        while (remaining) {
          const room = Math.max(1, width - used);
          if (visibleWidth(remaining) <= room) {
            line += renderPiece(piece, remaining, style, paint);
            used += visibleWidth(remaining);
            break;
          }
          const [head] = chunk(remaining, room);
          line += renderPiece(piece, head!, style, paint);
          remaining = remaining.slice(head!.length);
          newLine();
          empty = false;
        }
      }
      empty = false;
    }
  }
  lines.push(line.trimEnd());
  return lines;
}

/** Pads with spaces to `width` visible columns. */
export function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}
