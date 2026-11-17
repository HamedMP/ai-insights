import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The page's client code, styles and fonts live as real files in `client/` next to this module. `tsc` does
 * not copy them, so `pnpm build` runs `scripts/build-client.mjs`, which checks them and copies the folder to
 * `dist/render/client/`. The renderer reads them once per process and inlines them: the report stays one
 * self-contained file and nothing is generated into the source tree, so nothing can go stale.
 */

const CLIENT = fileURLToPath(new URL("./client/", import.meta.url));

/** Embedded faces: [family, file, weight range]. All are SIL OFL 1.1; the licence texts ship beside them. */
export const FONTS: Array<[string, string, string]> = [
  ["Brico", "bricolage-grotesque-latin-wght-normal.woff2", "200 800"],
  ["GeistR", "geist-latin-wght-normal.woff2", "100 900"],
  ["GeistM", "geist-mono-latin-wght-normal.woff2", "100 900"],
];

/** Script files in load order. Styles go between the engine and the page; Pop first, as the default. */
const BEFORE_STYLES = ["vendor/mediabunny.js", "rabbit.js", "engine.js"];
const AFTER_STYLES = ["export.js", "pdf.js", "sharelink.js", "sharebox.js", "deck.js", "page.js", "event-banner.js"];
/** Page stylesheets in order. event-banner.css is temporary (see event-banner.ts). */
const PAGE_CSS = ["page.css", "event-banner.css"];

export interface ClientAssets {
  /** @font-face rules + base card CSS + every style's card CSS: also copied into exported frames. */
  cardCss: string;
  pageCss: string;
  script: string;
  scriptHash: string;
  styles: string[];
  /** @font-face rules for fonts only one style uses, injected into the card CSS when that style is first used. */
  styleFonts: Record<string, string>;
}

const read = (file: string) => readFileSync(CLIENT + file, "utf8");

/** Style ids found in client/styles, Pop first, then by name. A style is a `<id>.js` with a `<id>.css` beside it. */
export function styleIds(): string[] {
  const files = readdirSync(CLIENT + "styles");
  const ids = files.filter((name) => /^[a-z0-9-]{1,24}\.js$/.test(name)).map((name) => name.slice(0, -3)).filter((id) => files.includes(`${id}.css`));
  return ids.sort((a, b) => (a === "pop" ? -1 : b === "pop" ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

let cached: ClientAssets | null = null;

export function clientAssets(): ClientAssets {
  if (cached) return cached;
  const styles = styleIds();
  const fontCss = FONTS.map(
    ([family, file, weight]) =>
      `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(CLIENT + "fonts/" + file).toString("base64")}) format("woff2");font-weight:${weight};font-display:block}`,
  ).join("\n");
  const cardCss = [
    "/* Fonts: Bricolage Grotesque, Geist and Geist Mono, SIL Open Font License 1.1 (texts ship with the ai-insights package). */",
    fontCss,
    read("card.css"),
    ...styles.map((id) => read(`styles/${id}.css`)),
  ].join("\n");
  // `</` cannot appear inside an inline <script>; none of our sources need it, and a check keeps it that way.
  const script = [...BEFORE_STYLES.map(read), ...styles.map((id) => read(`styles/${id}.js`)), ...AFTER_STYLES.map(read)].join("\n;\n");
  const pageCss = PAGE_CSS.map(read).join("\n");
  if (/<\/script/i.test(script) || /<\/style/i.test(cardCss + pageCss)) throw new Error("client assets must not contain a closing script or style tag");
  // A style's own fonts (styles/<id>.fonts.json: [{ family, file, weight }]) stay out of the card CSS until the
  // style is picked, so exported frames of other styles do not carry them.
  const styleFonts: Record<string, string> = {};
  for (const id of styles) {
    let list: Array<{ family: string; file: string; weight: string }>;
    try {
      list = JSON.parse(read(`styles/${id}.fonts.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    styleFonts[id] = list.map(({ family, file, weight }) => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${readFileSync(CLIENT + "fonts/" + file).toString("base64")}) format("woff2");font-weight:${weight};font-display:block}`).join("\n");
  }
  cached = {
    styleFonts,
    cardCss,
    pageCss,
    script,
    scriptHash: createHash("sha256").update(script).digest("base64"),
    styles,
  };
  return cached;
}
