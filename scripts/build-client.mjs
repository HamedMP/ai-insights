#!/usr/bin/env node
// The report page's client code is plain files in src/render/client/ (scripts, CSS, fonts, the vendored muxer).
// tsc does not copy non-TS files, so `pnpm build` runs this after tsc: it checks the client and copies it to
// dist/render/client/, where the compiled renderer reads it. `--check` only checks (used by `pnpm check`).
//
// Checks: every script parses as a classic script (they share one global scope, so no import/export), every
// card style is a <id>.js + <id>.css pair that registers itself and scopes its CSS, no source contains a
// closing </script> or </style>, and every font has its licence beside it.
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src/render/client");
const out = join(root, "dist/render/client");
const checkOnly = process.argv.includes("--check");
const problems = [];

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
const files = walk(src);
for (const file of files) {
  const rel = file.slice(src.length + 1);
  if (file.endsWith(".js")) {
    const code = readFileSync(file, "utf8");
    try {
      new Script(code, { filename: rel });
    } catch (error) {
      problems.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (/<\/script/i.test(code)) problems.push(`${rel}: contains a closing script tag`);
    if (/^\s*(import|export)\s/m.test(code)) problems.push(`${rel}: client files are classic scripts; no import/export`);
  }
  if (file.endsWith(".css") && /<\/style/i.test(readFileSync(file, "utf8"))) problems.push(`${rel}: contains a closing style tag`);
}

const styleFiles = readdirSync(join(src, "styles"));
const styles = styleFiles.filter((name) => name.endsWith(".js")).map((name) => name.slice(0, -3));
if (!styles.includes("pop")) problems.push("styles/pop.js: the default style is missing");
for (const id of styles) {
  if (!/^[a-z0-9-]{1,24}$/.test(id)) problems.push(`styles/${id}.js: style ids are lowercase letters, digits and dashes`);
  if (!styleFiles.includes(`${id}.css`)) problems.push(`styles/${id}.js: needs styles/${id}.css beside it`);
  const code = readFileSync(join(src, "styles", `${id}.js`), "utf8");
  if (!new RegExp(`registerCardStyle\\(\\s*\\{\\s*id:\\s*["']${id}["']`).test(code)) problems.push(`styles/${id}.js: must call registerCardStyle({ id: "${id}", ... })`);
  if (/\bBUNDLE\b|\bVIEW\b|localStorage|\bfetch\s*\(/.test(code)) problems.push(`styles/${id}.js: cards may read only the data passed to specs(D)`);
  if (styleFiles.includes(`${id}.css`)) {
    const css = readFileSync(join(src, "styles", `${id}.css`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.split("}")) {
      const selectors = rule.split("{")[0].trim();
      if (!selectors || selectors.startsWith("@")) continue;
      for (const selector of selectors.split(",")) if (!selector.trim().startsWith(`.card[data-style="${id}"]`)) problems.push(`styles/${id}.css: selector not scoped to .card[data-style="${id}"]: ${selector.trim().slice(0, 60)}`);
    }
  }
}
// Page rules must not restyle card internals: cards are also exported with the card CSS alone, so a page rule
// that reaches into a card makes the page and the exported frame disagree. Flag page selectors whose last
// compound is made only of classes a card stylesheet also uses.
{
  const cardCss = ["card.css", ...styleFiles.filter((name) => name.endsWith(".css")).map((name) => `styles/${name}`)].map((f) => readFileSync(join(src, f), "utf8")).join("\n");
  const cardClasses = new Set([...cardCss.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  const pageCss = readFileSync(join(src, "page.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of pageCss.split("}")) {
    const head = rule.split("{")[0].trim();
    if (!head || head.startsWith("@")) continue;
    for (const selector of head.split(",").map((x) => x.trim())) {
      const last = selector.split(/[\s>+~]+/).pop() ?? "";
      if (/^[a-z]/i.test(last)) continue;
      const classes = [...last.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => c !== "mono" && c !== "card");
      if (classes.length > 0 && classes.every((c) => cardClasses.has(c))) problems.push(`page.css: ${selector} also matches inside cards; scope it so it cannot restyle a card`);
    }
  }
}
// Every font ships with its licence: fonts/<family>-OFL.txt, where the font's file name starts with <family>.
const licences = readdirSync(join(src, "fonts")).filter((name) => name.endsWith("-OFL.txt")).map((name) => name.slice(0, -"-OFL.txt".length));
for (const font of readdirSync(join(src, "fonts")).filter((name) => name.endsWith(".woff2"))) {
  if (!licences.some((family) => font.startsWith(`${family}-`))) problems.push(`fonts/${font}: ship its licence as fonts/<family>-OFL.txt`);
}

if (problems.length > 0) {
  console.error(`client check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
if (checkOnly) {
  console.log(`client ok: ${files.length} files, styles: ${styles.join(", ")}`);
} else {
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
  console.log(`copied the report client to dist/render/client (${files.length} files, styles: ${styles.join(", ")})`);
}
