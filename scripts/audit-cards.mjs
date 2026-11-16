#!/usr/bin/env node
// Headless checks of the report's cards, in a real browser. Not part of `pnpm test` because it needs Chromium,
// which is not a dependency. Run `pnpm build` first.
//
//   pnpm audit:cards                  every style x card x ratio, for the demo history and a long synthetic one
//
// It needs playwright-core and a Chromium. It looks for playwright-core in this repo, then PLAYWRIGHT_CORE (a path
// to its index.mjs); and for the browser in CHROME (a path), then Playwright's headless shell under
// ~/.cache/ms-playwright. Checks:
//   - CardKit.audit finds nothing at the final frame (text inside the card, no overflow, no overlaps)
//   - seeking is deterministic: the same card at the same time gives the same markup
//   - no private string from the report (project names, finding text, evidence) reaches a card or the caption
//   - the caption fits X (280, links count 23) and the X intent carries it
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => { console.error(message); process.exit(2); };

async function playwright() {
  try { return await import("playwright-core"); } catch {}
  if (process.env.PLAYWRIGHT_CORE) return import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href);
  fail("audit:cards needs playwright-core: install it somewhere and set PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs");
}
function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), ".cache/ms-playwright");
  const shells = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse() : [];
  for (const shell of shells) {
    const exe = join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell");
    if (existsSync(exe)) return exe;
  }
  fail("audit:cards needs Chromium: set CHROME=/path/to/chrome or install Playwright's headless shell");
}
if (!existsSync(join(root, "dist/render/client/engine.js"))) fail("run `pnpm build` first");

const { renderReport } = await import(pathToFileURL(join(root, "dist/render/index.js")).href);
const work = mkdtempSync(join(tmpdir(), "ai-insights-audit-"));
try {
  execFileSync(process.execPath, [join(root, "scripts/demo-report.mjs"), join(work, "demo.html"), "--json", join(work, "demo.json"), "--no-site"], { stdio: "ignore" });
  const report = JSON.parse(readFileSync(join(work, "demo.json"), "utf8"));
  // A long, busy history: 300 days of activity and counts past the caps, to catch layouts that only fit a month.
  const long = structuredClone(report.recap);
  const start = Date.parse("2026-01-17T12:00:00Z");
  long.daily = Array.from({ length: 300 }, (_, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), sessions: i % 3 ? 4 : 0, prompts: i % 3 ? 37 : 0, minutes: i % 3 ? 300 : 0 }));
  long.range = { from: long.daily[0].day, to: long.daily.at(-1).day, days: 300 };
  long.streak = { days: 117, start: long.daily[100].day, end: long.daily[216].day };
  long.totals = { ...long.totals, sessions: 4321, prompts: 98765, wallHours: 1234, agentHours: 5678, toolCalls: 456789, commits: 12345, toolCallsCapped: true };
  if (long.longestSession) long.longestSession = { ...long.longestSession, activeMinutes: 14000, toolCalls: 10000, toolCallsCapped: true };
  long.usage = { ...long.usage, tokens: 98_700_000_000, novels: 1234 };
  long.voice = { ...long.voice, polite: { please: 456, thanks: 123, sorry: 9 } };
  writeFileSync(join(work, "long.html"), renderReport({ ...report, recap: long }));

  const privateStrings = [
    ...report.activity.projects.map((p) => p.projectPath.split("/").pop()),
    ...report.findings.flatMap((f) => [f.detail, ...f.evidence.map((e) => e.note)]),
  ].filter((text) => typeof text === "string" && text.length >= 6);

  const { chromium } = await playwright();
  const browser = await chromium.launch({ executablePath: chrome(), args: ["--no-sandbox"] });
  let problems = 0;
  for (const name of ["demo", "long"]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on("pageerror", (error) => { problems++; console.log(`${name}: page error ${error.message}`); });
    await page.goto(pathToFileURL(join(work, `${name}.html`)).href);
    await page.waitForFunction(() => window.recap && window.recap.ready(), null, { timeout: 60_000 });
    const styles = await page.evaluate(() => (window.recap.styles().length ? window.recap.styles() : [{ id: "pop" }]).map((style) => style.id));
    const result = { audit: [], nondeterministic: [], leaks: [], cards: 0 };
    for (const style of styles) {
      // Switching waits for the style's own fonts, so layout is measured with the faces it will be drawn with.
      await page.evaluate((id) => window.recap.setStyle(id), style);
      const part = await page.evaluate(([secrets, style]) => {
        const out = { audit: [], nondeterministic: [], leaks: [], cards: 0 };
        for (const ratio of ["1:1", "9:16", "4:5", "16:9"]) {
          for (const [card, issues] of Object.entries(window.recap.audit(style, ratio))) out.audit.push(`${style} ${ratio} ${card}: ${issues.join("; ")}`);
          for (const card of window.recap.cards()) {
            out.cards++;
            const a = window.recap.frame(card, 1234, ratio, style), b = window.recap.frame(card, 1234, ratio, style);
            if (a !== b) out.nondeterministic.push(`${style} ${ratio} ${card}`);
            const end = window.recap.frame(card, 99999, ratio, style);
            for (const secret of secrets) if (end.includes(secret)) out.leaks.push(`${style} ${card}: ${secret.slice(0, 40)}`);
          }
        }
        return out;
      }, [privateStrings, style]);
      for (const key of ["audit", "nondeterministic", "leaks"]) result[key].push(...part[key]);
      result.cards += part.cards;
    }
    const cap = await page.evaluate((secrets) => {
      const out = { leaks: [] };
      const caption = window.recap.caption();
      for (const secret of secrets) if (caption.includes(secret)) out.leaks.push(`caption: ${secret.slice(0, 40)}`);
      out.captionLength = caption.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
      out.intentOk = decodeURIComponent(window.recap.intents().x.split("?text=")[1]) === caption && window.recap.intents().x.startsWith("https://x.com/intent/post?text=");
      return out;
    }, privateStrings);
    result.leaks.push(...cap.leaks);
    result.captionLength = cap.captionLength;
    result.intentOk = cap.intentOk;
    const bad = result.audit.length + result.nondeterministic.length + result.leaks.length + (result.captionLength > 280 ? 1 : 0) + (result.intentOk ? 0 : 1);
    problems += bad;
    console.log(`${name}: ${result.cards} card renders, ${result.audit.length} layout issues, ${result.nondeterministic.length} non-deterministic, ${result.leaks.length} leaks, caption ${result.captionLength}/280, X intent ${result.intentOk ? "ok" : "WRONG"}`);
    for (const line of [...result.audit, ...result.nondeterministic, ...result.leaks]) console.log(`  ${line}`);
    await page.close();
  }
  await browser.close();
  process.exitCode = problems ? 1 : 0;
} finally {
  rmSync(work, { recursive: true, force: true });
}
