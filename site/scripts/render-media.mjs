#!/usr/bin/env node
// Renders the site's pictures and the sample video from the sample report, in a real browser, with the
// report's own exporters. Run it after the sample report changes; the outputs are committed.
//
//   node scripts/render-media.mjs            (from site/)
//
// Needs playwright-core (PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs, or installed here), a Chromium
// (CHROME, else Playwright's headless shell in ~/.cache/ms-playwright) and ffmpeg with libwebp and libx264.
// Writes:
//   public/media/card-<style>-<card>.webp   stills for the wall and the hero poster (the card's last frame)
//   public/media/sample-1x1.mp4 + .webp     the report's own "Download video" export of its default cards, made web-sized
//   public/media/rabbit.svg                 the Matrix OS rabbit, from the report's rabbit.js
//   public/og.png                           1200x630, real cards
//   lib/media.json                          card titles and durations, and the sample's own caption
//   ../assets/report.png, ../assets/recap.gif the README pictures: one card in each style, and the first cards playing
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const site = join(dirname(fileURLToPath(import.meta.url)), "..")
const media = join(site, "public/media")
const fail = (message) => { console.error(message); process.exit(2) }

async function playwright() {
  try { return await import("playwright-core") } catch {}
  if (process.env.PLAYWRIGHT_CORE) return import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href)
  fail("render-media needs playwright-core: set PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs")
}
function chrome() {
  if (process.env.CHROME) return process.env.CHROME
  const cache = join(homedir(), ".cache/ms-playwright")
  for (const shell of existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("chromium_headless_shell-")).sort().reverse() : []) {
    const exe = join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell")
    if (existsSync(exe)) return exe
  }
  fail("render-media needs Chromium: set CHROME=/path/to/chrome")
}
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args], { stdio: "inherit" })

/** Cards on the wall, per style: different cards in each row so the wall shows the range. */
const WALL = {
  pop: ["persona", "parallel", "manners", "tokens", "clock", "shell", "streak", "outro"],
  panel: ["hours", "summary", "nemesis", "model", "weekday", "failures", "marathon", "tests"],
  sticker: ["words", "intro", "parallel", "model", "tips", "nemesis", "tokens", "persona"],
}
/** The README picture and the OG image: the same moment of a person's recap in each style. */
const TRIO = [["pop", "persona"], ["panel", "summary"], ["sticker", "parallel"]]

mkdirSync(media, { recursive: true })
const work = mkdtempSync(join(tmpdir(), "ai-insights-media-"))
const { chromium } = await playwright()
const browser = await chromium.launch({ executablePath: chrome(), args: ["--no-sandbox"] })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on("pageerror", (error) => fail(`report error: ${error.message}`))
  await page.goto(pathToFileURL(join(site, "public/demo/report.html")).href)
  await page.waitForFunction(() => window.recap && window.recap.ready(), null, { timeout: 60_000 })

  // ---- stills: the exporter's PNG at the card's last frame, 1080 px, then webp for the web
  const png = async (style, card, ratio = "1:1") => {
    await page.evaluate((id) => window.recap.setStyle(id), style)
    const b64 = await page.evaluate(([card, ratio, style]) => window.recap.png(card, 99999, ratio, style), [card, ratio, style])
    const file = join(work, `${style}-${card}-${ratio.replace(":", "x")}.png`)
    writeFileSync(file, Buffer.from(b64, "base64"))
    return file
  }
  const stills = new Set([...Object.entries(WALL).flatMap(([style, cards]) => cards.map((card) => `${style}:${card}`)), ...TRIO.map(([s, c]) => `${s}:${c}`)])
  const pngs = {}
  for (const key of stills) {
    const [style, card] = key.split(":")
    pngs[key] = await png(style, card)
    ffmpeg("-i", pngs[key], "-vf", "scale=560:560:flags=lanczos", "-c:v", "libwebp", "-quality", "80", "-compression_level", "6", join(media, `card-${style}-${card}.webp`))
  }

  // ---- the card list, durations and the sample's caption, as the report gives them
  const info = await page.evaluate(() => {
    const titles = {}
    for (const st of window.recap.styles()) titles[st.id] = Object.fromEntries(window.recap.cards().map((id) => [id, CardStyles.specs(st.id)[id].title]))
    return { styles: CardStyles.list().filter((st) => st.ok).map(({ id, name, swatch }) => ({ id, name, swatch })), cards: window.recap.cards().map((id) => ({ id, dur: window.recap.durOf(id) })), titles, defaults: window.recap.state().selected, caption: window.recap.caption(), share: window.recap.share }
  })

  // ---- the report's other parts, as a person sees them (the report is light-only): top of each section
  const parts = [["studio", "#studio", 980], ["timeline", "#a-how-you-work", 900], ["cost", "#a-what-it-cost", 760], ["change", "#change", 900], ["time", "#time", 760]]
  {
    const shotPage = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1.5, reducedMotion: "reduce" })
    await shotPage.goto(pathToFileURL(join(site, "public/demo/report.html")).href)
    await shotPage.waitForFunction(() => window.recap && window.recap.ready(), null, { timeout: 60_000 })
    await shotPage.evaluate(() => { window.recap.setStyle("pop"); window.recap.setRatio("1:1") })
    await shotPage.addStyleTag({ content: ".topbar{display:none!important}" })
    for (const [name, selector, maxH] of parts) {
      const el = shotPage.locator(selector).first()
      await el.scrollIntoViewIfNeeded()
      await shotPage.waitForTimeout(600)
      const box = await el.boundingBox()
      if (!box) fail(`render-media: no ${selector} in the sample report`)
      const file = join(work, `part-${name}.png`)
      await shotPage.screenshot({ path: file, fullPage: true, clip: { x: Math.max(0, box.x - 28), y: box.y + (await shotPage.evaluate(() => scrollY)) - 20, width: Math.min(1280, box.width + 56), height: Math.min(box.height, maxH) + 20 } })
      ffmpeg("-i", file, "-vf", "scale=1400:-1:flags=lanczos", "-c:v", "libwebp", "-quality", "80", "-compression_level", "6", join(media, `report-${name}.webp`))
    }
    await shotPage.close()
  }

  // ---- the sample video: press the report's own "Download video" for its default cards, Pop, 1:1
  await page.evaluate(() => { window.recap.setStyle("pop"); window.recap.setRatio("1:1"); window.recap.setPace("full") })
  await page.getByRole("button", { name: "Download video" }).click()
  await page.waitForFunction(() => window.__lastVideo, null, { timeout: 600_000 })
  const video = await page.evaluate(async () => { const u8 = new Uint8Array(await window.__lastVideo.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) })
  const raw = join(work, "export.mp4")
  writeFileSync(raw, Buffer.from(video, "base64"))
  ffmpeg("-i", raw, "-vf", "scale=720:720:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", join(media, "sample-1x1.mp4"))
  ffmpeg("-i", pngs["pop:persona"], "-vf", "scale=720:720:flags=lanczos", "-c:v", "libwebp", "-quality", "78", join(media, "sample-1x1.webp"))
  // The README's moving picture: the first three cards of that same export.
  ffmpeg("-t", "21", "-i", raw, "-vf", "fps=12,scale=400:400:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", join(site, "../assets/recap.gif"))
  const exportMb =(Buffer.from(video, "base64").length / 1e6).toFixed(1)

  // ---- the rabbit, from the report's own mark
  const rabbit = readFileSync(join(site, "../src/render/client/rabbit.js"), "utf8")
  const paths = [...rabbit.matchAll(/"(M[^"]+)"/g)].map((match) => match[1])
  if (paths.length < 3) fail("render-media: could not read the rabbit paths from rabbit.js")
  writeFileSync(join(media, "rabbit.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 510 660">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>\n`)

  // ---- OG image and README picture: real card PNGs laid out on a plain page
  const uri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`
  const font = (file) => `data:font/woff2;base64,${readFileSync(join(site, "node_modules/geist/dist/fonts", file)).toString("base64")}`
  const faces = `@font-face{font-family:G;src:url(${font("geist-sans/Geist-Variable.woff2")}) format("woff2");font-weight:100 900}@font-face{font-family:GM;src:url(${font("geist-mono/GeistMono-Variable.woff2")}) format("woff2");font-weight:100 900}`
  const rabbitSvg = (fill) => `<svg viewBox="0 0 510 660" style="height:1em;width:auto" fill="${fill}">${paths.map((d) => `<path d="${d}"/>`).join("")}</svg>`
  const shot = async (html, w, h, file) => {
    const p = await browser.newPage({ viewport: { width: w, height: h } })
    await p.setContent(html)
    await p.evaluate(() => document.fonts.ready)
    await p.screenshot({ path: file })
    await p.close()
  }
  const trio = TRIO.map(([s, c]) => uri(pngs[`${s}:${c}`]))
  await shot(`<!doctype html><style>${faces}*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:#f3f0e8;font-family:G;color:#17140f;position:relative;overflow:hidden}
.t{position:absolute;left:64px;top:62px;width:470px}.k{font:600 15px GM;letter-spacing:.08em;text-transform:uppercase;color:#c2410c;display:flex;align-items:center;gap:10px}
h1{font-weight:700;font-size:64px;line-height:.98;letter-spacing:-.045em;margin-top:22px}h1 em{font-style:normal;color:#c2410c}
p{font-size:21px;line-height:1.4;color:#3b3a37;margin-top:22px}.c{position:absolute;left:64px;bottom:58px;font:600 22px GM;background:#17140f;color:#f3f0e8;border-radius:14px;padding:16px 22px}.c b{color:#ff7a2f}
.cards img{position:absolute;width:310px;height:310px;border-radius:22px;box-shadow:0 30px 60px -28px rgba(40,20,0,.55),0 2px 6px rgba(0,0,0,.12)}</style>
<div class="t"><div class="k">${rabbitSvg("#c2410c")} AI Insights · by Matrix OS</div><h1>Your AI coding, <em>recapped</em>.</h1><p>Animated cards from your local agent history. Post them. Nothing leaves your machine.</p></div>
<div class="c"><b>$</b> npx ai-insights</div>
<div class="cards"><img src="${trio[1]}" style="left:548px;top:200px;transform:rotate(-7deg)"><img src="${trio[2]}" style="left:878px;top:205px;transform:rotate(7deg)"><img src="${trio[0]}" style="left:712px;top:118px;z-index:2"></div></div>`, 1200, 630, join(work, "og.png"))
  ffmpeg("-i", join(work, "og.png"), "-pix_fmt", "rgb24", join(site, "public/og.png"))

  await shot(`<!doctype html><style>*{margin:0}body{width:1600px;height:560px;background:#f3f0e8;display:flex;gap:40px;align-items:center;justify-content:center}img{width:480px;height:480px;border-radius:26px;box-shadow:0 24px 50px -24px rgba(40,20,0,.5)}</style>${trio.map((src) => `<img src="${src}">`).join("")}`, 1600, 560, join(work, "recap.png"))
  ffmpeg("-i", join(work, "recap.png"), "-vf", "scale=1200:-1:flags=lanczos", "-pix_fmt", "rgb24", join(site, "../assets/report.png"))

  writeFileSync(join(site, "lib/media.json"), `${JSON.stringify({
    note: "Made by site/scripts/render-media.mjs from the sample report (invented sessions). Do not edit by hand.",
    styles: info.styles,
    cards: info.cards,
    titles: info.titles,
    defaults: info.defaults,
    wall: WALL,
    trio: TRIO,
    caption: info.caption,
    video: { file: "media/sample-1x1.mp4", poster: "media/sample-1x1.webp", cards: info.defaults, seconds: Math.round(info.defaults.reduce((a, id) => a + info.cards.find((c) => c.id === id).dur, 0) / 1000), exportMb: Number(exportMb) },
  }, null, 2)}\n`)
  console.log(`render-media: ${stills.size} stills, video (export ${exportMb} MB), og.png, recap.png, media.json`)
} finally {
  await browser.close()
  rmSync(work, { recursive: true, force: true })
}
