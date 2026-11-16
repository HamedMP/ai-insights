// Builds public/demo/cards.html: the sample report's own card engine, styles, fonts and data, with a small
// player instead of the report page, so the site can show live cards that cannot drift from the product.
//
// Everything card-related is copied byte for byte from public/demo/report.html (made by the root
// `scripts/demo-report.mjs`). The report's script runs in its capture mode, which renders one card and stops;
// the player below then drives the same globals the report's own player uses (CardKit, CardStyles, render,
// fontsReady). The parent page talks to it with postMessage:
//
//   parent -> embed  { aii: 1, set: { style?, ratio?, cards?, index?, playing? } }
//   embed -> parent  { aii: 1, ready, style, ratio, styles, index, count, card, title, playing }
//
// URL: cards.html?style=pop&ratio=1:1&cards=persona,parallel&play=1   (play=0 shows each card at rest)
// Runs before `next dev` and `next build`; the output is not committed.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const report = readFileSync(new URL("../public/demo/report.html", import.meta.url), "utf8")
const out = new URL("../public/demo/cards.html", import.meta.url)

const one = (re, what) => {
  const match = re.exec(report)
  if (!match) throw new Error(`build-embed: the sample report has no ${what}; did the report layout change?`)
  return match[0]
}
const cardCss = one(/<style id="card-css">[\s\S]*?<\/style>/, "card stylesheet")
const data = one(/<script id="report-data" type="application\/json">[\s\S]*?<\/script>/, "data block")
const fonts = [...report.matchAll(/<script id="style-fonts-[a-z0-9-]+" type="text\/plain">[\s\S]*?<\/script>/g)].map((match) => match[0])
const engine = /<script>([\s\S]*?)<\/script>\s*<\/body>/.exec(report)?.[1]
if (!engine) throw new Error("build-embed: the sample report has no main script")
for (const name of ["const CardKit", "const CardStyles", "function render(", "function fontsReady(", 'params.get("capture")'])
  if (!engine.includes(name)) throw new Error(`build-embed: the report script no longer has ${name}; update scripts/build-embed.mjs`)

// Runs first: keeps the embed's own options, then puts the report script into capture mode (one card, no page).
const before = `(() => {
  const q = new URLSearchParams(location.search);
  window.__aiiEmbed = { style: q.get("style") || "pop", ratio: q.get("ratio") || "1:1", cards: (q.get("cards") || "").split(",").filter(Boolean), play: q.get("play") !== "0", mark: q.get("mark") !== "0" };
  const e = window.__aiiEmbed;
  history.replaceState(null, "", location.pathname + "?capture=outro&style=" + encodeURIComponent(e.style) + "&ratio=" + encodeURIComponent(e.ratio) + "&t=0");
})();`

const player = `(() => {
  "use strict";
  const E0 = window.__aiiEmbed;
  const RC = JSON.parse(document.getElementById("report-data").textContent).recap;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stage = document.getElementById("root"), measure = document.getElementById("measure");
  const HOLD = 1400;
  const okStyles = () => CardStyles.list().filter((st) => st.ok).map((st) => st.id);
  const avail = (id) => !!RC && RC.avail[id] !== false && !!(CardStyles.specs("pop") || {})[id];
  const S = { style: E0.style, ratio: CardKit.RATIOS[E0.ratio] ? E0.ratio : "1:1", cards: [], i: 0, t: 0, playing: E0.play && !reduced, inst: null, ready: false, visible: true, gen: 0 };
  const send = () => { if (parent === window) return; const id = S.cards[S.i]; parent.postMessage({ aii: 1, ready: S.ready, style: S.style, ratio: S.ratio, styles: CardStyles.list().filter((st) => st.ok).map(({ id, name }) => ({ id, name })), index: S.i, count: S.cards.length, card: id, title: S.inst ? S.inst.title : "", playing: S.playing }, location.origin); };
  function fit() {
    const inst = S.inst; if (!inst) return;
    const sc = Math.min(innerWidth / inst.W, innerHeight / inst.H);
    inst.el.style.transformOrigin = "0 0";
    inst.el.style.transform = "translate(" + (innerWidth - inst.W * sc) / 2 + "px," + (innerHeight - inst.H * sc) / 2 + "px) scale(" + sc + ")";
  }
  async function mount(keepT) {
    const gen = ++S.gen, id = S.cards[S.i], style = S.style, ratio = S.ratio;
    await fontsReady(style);
    if (gen !== S.gen) return;
    const specs = CardStyles.specs(style) || CardStyles.specs("pop");
    const [W, H] = CardKit.RATIOS[ratio];
    const inst = CardKit.make(specs[id], W, H, style, measure, { mark: E0.mark });
    if (!inst) return;
    if (S.inst) S.inst.el.remove();
    S.inst = inst;
    stage.replaceChildren(inst.el);
    S.t = !S.playing ? inst.dur : keepT ? Math.min(S.t, inst.dur) : 0;
    fit(); render(inst, Math.min(S.t, inst.dur));
    S.ready = true; document.documentElement.dataset.embedReady = "1";
    send();
  }
  let last = null;
  function loop(now) {
    const dt = last == null ? 16 : Math.min(64, now - last); last = now;
    if (S.playing && S.visible && S.inst) {
      S.t += dt;
      if (S.t >= S.inst.dur + HOLD) { S.i = (S.i + 1) % S.cards.length; S.t = 0; mount(false); }
      else render(S.inst, Math.min(S.t, S.inst.dur));
    }
    requestAnimationFrame(loop);
  }
  function set(o) {
    let remount = false, keepT = true;
    if (o.style && o.style !== S.style && okStyles().includes(o.style)) { S.style = o.style; remount = true; }
    if (o.ratio && o.ratio !== S.ratio && CardKit.RATIOS[o.ratio]) { S.ratio = o.ratio; remount = true; }
    if (Array.isArray(o.cards)) { const ids = o.cards.filter(avail); if (ids.length && ids.join() !== S.cards.join()) { S.cards = ids; S.i = 0; remount = true; keepT = false; } }
    if (typeof o.index === "number" && S.cards.length) { S.i = ((o.index % S.cards.length) + S.cards.length) % S.cards.length; remount = true; keepT = false; }
    if (typeof o.visible === "boolean") S.visible = o.visible;
    if (typeof o.playing === "boolean" && o.playing !== S.playing) { S.playing = o.playing; if (S.playing && S.inst && S.t >= S.inst.dur) S.t = 0; if (!S.playing && S.inst) { S.t = S.inst.dur; render(S.inst, S.t); } send(); }
    if (remount) mount(keepT);
  }
  addEventListener("message", (event) => { if (event.origin !== location.origin || !event.data || event.data.aii !== 1 || !event.data.set) return; set(event.data.set); });
  addEventListener("resize", fit);
  function start() {
    if (!RC) { document.body.textContent = "This sample has no recap."; return; }
    if (!okStyles().includes(S.style)) S.style = "pop";
    S.cards = (E0.cards.length ? E0.cards : ["persona", "parallel", "manners", "words", "clock", "summary", "outro"]).filter(avail);
    if (!S.cards.length) S.cards = ["intro"];
    mount(false); requestAnimationFrame(loop);
  }
  // The report script's capture mode renders its card after the fonts load and then marks the page ready.
  if (document.documentElement.dataset.ready === "1") start();
  else new MutationObserver((_, obs) => { if (document.documentElement.dataset.ready === "1") { obs.disconnect(); start(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-ready"] });
})();`

const hash = (text) => createHash("sha256").update(text).digest("base64")
const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash(before)}' 'sha256-${hash(engine)}' 'sha256-${hash(player)}'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>AI Insights sample cards</title>
${cardCss}
<style>html,body{margin:0;height:100%;overflow:hidden;background:#141210}#root{position:fixed;inset:0;overflow:hidden}#measure{position:fixed;left:-30000px;top:0;width:4000px;height:2000px;overflow:hidden;pointer-events:none}</style>
</head>
<body>
<div id="root"></div>
<div id="measure" aria-hidden="true"></div>
${data}
${fonts.join("\n")}
<script>${before}</script>
<script>${engine}</script>
<script>${player}</script>
</body>
</html>
`
writeFileSync(out, html)
console.log(`build-embed: wrote public/demo/cards.html (${Math.round(html.length / 1024)} KB) from the sample report`)
