/* page.js: the report page. Hero + story player, card studio, the private analysis, what to change, over time.
   Reads one JSON block (#report-data), built by src/render/view.ts. Cards and exports read only VIEW.recap. */
(() => {
"use strict";
const VIEW = JSON.parse(document.getElementById("report-data").textContent);
const RC = VIEW.recap, RUNS = VIEW.runs || [], ACT = VIEW.activity, USE = VIEW.usage, TZ = VIEW.timeZone, HERO = VIEW.hero;
const reduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
const params = new URLSearchParams((location.search || "").replace(/^\?/, "") + "&" + (location.hash || "").replace(/^#/, ""));
const store = {
  get(k, d) { try { const v = localStorage.getItem("aii:" + k); return v == null ? d : JSON.parse(v); } catch (err) { console.warn("storage read failed", err); return d; } },
  set(k, v) { try { localStorage.setItem("aii:" + k, JSON.stringify(v)); } catch (err) { console.warn("storage write failed", err); } },
};
if (RC) CardStyles.setData(RC);
const STYLES = RC ? CardStyles.list().filter((st) => st.ok) : [];
const styleOk = (id) => STYLES.some((st) => st.id === id);
const avail = (id) => !!RC && RC.avail[id] !== false && (CARD_IDS.includes(id) || RC.avail[id] === true);
const ALL_IDS = [...CARD_IDS, ...OPTIONAL_CARD_IDS].filter(avail);
// Lead with what people brag or argue about, close with the summary and the maker's card; about 54 s, so it fits
// Stories, Reels and X without a warning. Cost stays off by default: people can add it.
const DEFAULT_SEL = ["persona", "parallel", "danger", "manners", "words", "clock", "summary", "outro"].filter(avail);
const DEFAULT_ORDER = [...DEFAULT_SEL.slice(0, -2), ...[...CARD_IDS, ...OPTIONAL_CARD_IDS].filter((id) => !DEFAULT_SEL.includes(id) && id !== "summary" && id !== "outro"), "summary", "outro"].filter(avail);
const S = {
  style: styleOk(params.get("style")) ? params.get("style") : styleOk(store.get("style", "pop")) ? store.get("style", "pop") : "pop",
  ratio: CardKit.RATIOS[params.get("ratio")] ? params.get("ratio") : CardKit.RATIOS[store.get("ratio", "1:1")] ? store.get("ratio", "1:1") : "1:1",
  pace: store.get("pace", "full") === "quick" ? "quick" : "full",
  preset: store.get("preset", "x"),
  mark: params.has("mark") ? params.get("mark") !== "0" : store.get("mark", true) !== false,
  order: DEFAULT_ORDER.slice(),
  sel: new Set(DEFAULT_SEL),
};
{ const o = store.get("order", null); if (Array.isArray(o)) { const known = o.filter((id) => ALL_IDS.includes(id)); S.order = [...known, ...DEFAULT_ORDER.filter((id) => !known.includes(id))]; } }
{ const sl = store.get("sel", null); if (Array.isArray(sl)) S.sel = new Set(sl.filter((id) => ALL_IDS.includes(id))); }
if (params.get("cards")) { const ids = params.get("cards").split(",").filter((id) => ALL_IDS.includes(id)); if (ids.length) { S.sel = new Set(ids); S.order = [...ids, ...S.order.filter((id) => !ids.includes(id))]; } }
const saveStudio = () => { store.set("order", S.order); store.set("sel", [...S.sel]); store.set("ratio", S.ratio); store.set("pace", S.pace); store.set("preset", S.preset); store.set("style", S.style); store.set("mark", S.mark); };
/** An optional card is offered only in styles that draw it; the 21 required ones are in every style. */
const hasCard = (id, style = S.style) => CARD_IDS.includes(id) || !!(CardStyles.specs(style) || {})[id];
const seqIds = () => S.order.filter((id) => S.sel.has(id) && hasCard(id));
const specOf = (id, style = S.style) => { const set = CardStyles.specs(style) || CardStyles.specs("pop"); return set[id] || CardStyles.specs("pop")[id]; };
const durOf = (id) => (S.pace === "quick" ? Math.min(specOf(id).dur, 4000) : specOf(id).dur);
const fmtSec = (ms) => { const sec = Math.round(ms / 1000); return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : `${sec} s`; };
const measure = document.getElementById("measure");
function makeInst(id, ratio = S.ratio, style = S.style, mark = S.mark) { const [W, H] = CardKit.RATIOS[ratio]; return CardKit.make(specOf(id, style), W, H, style, measure, { mark }); }

// ---------- capture mode: one card, full size, one frame. For headless screenshots (see the terminal recipe).
if (params.get("capture") && RC) {
  const id = params.get("capture");
  document.documentElement.classList.add("capture");
  fontsReady(S.style).then(() => {
    if (!avail(id)) { document.body.textContent = `No card "${id}" in this report.`; return; }
    const inst = makeInst(id);
    document.getElementById("root").append(inst.el);
    render(inst, Math.max(0, +params.get("t") || 0));
    document.documentElement.dataset.ready = "1";
  });
  return;
}

// ---------- small ui helpers
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  img: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 5 5 3-3 5 5"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
};
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Report text: escaped first, then `code` spans. Never put report text into innerHTML any other way. */
const md = (x) => esc(x == null ? "" : x).replace(/`([^`]{1,200})`/g, "<code>$1</code>");
const toast = h("div", { class: "toast", role: "status", "aria-live": "polite" });
function say(msg) { toast.textContent = msg; toast.classList.add("on"); clearTimeout(say.t); say.t = setTimeout(() => toast.classList.remove("on"), 1900); }
async function copy(text, what = "Copied") {
  try { await navigator.clipboard.writeText(text); say(what); }
  catch (err) {
    console.warn("clipboard API unavailable, using fallback", err);
    const ta = h("textarea", { style: { position: "fixed", left: "-9999px" } }); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand("copy"); say(what); } catch (e2) { console.error("copy failed", e2); say("Copy failed"); }
    ta.remove();
  }
}
const tip = h("div", { class: "tip", role: "tooltip" });
function bindTip(el, html) {
  el.addEventListener("pointerenter", () => { tip.innerHTML = typeof html === "function" ? html() : html; tip.classList.add("on"); });
  el.addEventListener("pointermove", (e) => { tip.style.left = Math.min(innerWidth - 150, Math.max(150, e.clientX)) + "px"; tip.style.top = e.clientY + "px"; });
  el.addEventListener("pointerleave", () => tip.classList.remove("on"));
}
const usd = (x) => (x == null ? "n/a" : x >= 100 ? `$${int(x)}` : `$${x.toFixed(2)}`);
const prettyModel = (m) => m.replace(/^claude-/, "Claude ").replace(/(\d)-(\d)(?!\d)/g, "$1.$2").split(/[-\s]/).map((w) => (/^gpt$/i.test(w) ? "GPT" : w.charAt(0).toUpperCase() + w.slice(1))).join(" ").replace(/^GPT (\d)/, "GPT-$1");
const plural = (n, one_, many = one_ + "s") => `${int(n)} ${n === 1 ? one_ : many}`;
const listOf = (names) => (names.length <= 1 ? names[0] || "" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const snip = (label, text) => h("div", { class: "snippet" }, h("div", { class: "lbl" }, h("span", {}, label), h("button", { class: "btn small", type: "button", onclick: () => copy(text, "Copied") }, h("span", { html: ICON.copy }), "Copy")), text);
const ext = (url, label, cls = "btn small") => h("a", { class: cls, href: url, target: "_blank", rel: "noopener noreferrer" }, label);

// ================================================================== Player
class Player {
  constructor(o) {
    this.o = o; this.i = 0; this.t = 0; this.playing = false; this.inst = null;
    this.root = h("div", { class: "player" });
    this.segs = h("div", { class: "segs", "aria-hidden": "true" });
    this.vp = h("div", { class: "vp", tabindex: "0", role: "group", "aria-roledescription": "story", "aria-label": "Recap story. Space to pause, arrow keys to move between cards." });
    this.ttl = h("span", { class: "ttl", "aria-live": "polite" });
    const ib = (icon, label, fn) => { const b = h("button", { class: "ibtn", type: "button", "aria-label": label, title: label, html: ICON[icon] }); b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); return b; };
    this.bPlay = ib("play", "Play", () => this.toggle());
    this.root.append(this.segs, this.vp, h("div", { class: "pbar" }, ib("prev", "Previous card", () => this.prev()), this.bPlay, ib("next", "Next card", () => this.next()), this.ttl, o.extraBtn || null));
    this.vp.addEventListener("click", (e) => { const r = this.vp.getBoundingClientRect(); (e.clientX - r.left) < r.width * 0.3 ? this.prev() : this.next(); });
    this.vp.addEventListener("keydown", (e) => this.key(e));
    let sx = null;
    this.vp.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    this.vp.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) { e.preventDefault(); dx < 0 ? this.next() : this.prev(); } });
  }
  key(e) {
    if (e.key === "ArrowRight") { e.preventDefault(); this.next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); this.prev(); }
    else if (e.key === " " || e.key === "k") { e.preventDefault(); this.toggle(); }
  }
  ids() { return this.o.ids(); }
  reload(keep = false) {
    const n = this.ids().length;
    this.segs.replaceChildren(...Array.from({ length: n }, () => h("i", {}, h("b"))));
    this.mount(keep ? Math.min(this.i, n - 1) : 0, keep ? this.t : 0);
  }
  size() {
    if (!this.inst) return;
    const box = this.o.box(), sc = Math.min(box.w / this.inst.W, box.h / this.inst.H);
    this.vp.style.width = Math.round(this.inst.W * sc) + "px"; this.vp.style.height = Math.round(this.inst.H * sc) + "px";
    this.inst.el.style.transform = `scale(${sc})`;
    this.root.style.width = Math.round(this.inst.W * sc) + "px";
  }
  mount(i, t = 0) {
    const ids = this.ids();
    if (this.inst) this.inst.el.remove();
    if (!ids.length) { this.inst = null; this.vp.replaceChildren(); this.ttl.textContent = "No cards selected"; return; }
    this.i = clamp(i, 0, ids.length - 1);
    this.inst = makeInst(ids[this.i], this.o.ratio());
    this.vp.replaceChildren(this.inst.el);
    this.size();
    this.ttl.textContent = `${String(this.i + 1).padStart(2, "0")} / ${ids.length} · ${this.inst.title}`;
    [...this.segs.children].forEach((sg, j) => { sg.firstChild.style.transform = `scaleX(${j < this.i ? 1 : 0})`; });
    // With reduced motion a card is shown at rest (its last frame) unless the person presses play.
    this.t = reduced && !this.playing ? this.inst.dur : t; this.draw();
  }
  draw() {
    if (!this.inst) return;
    render(this.inst, this.t);
    const sg = this.segs.children[this.i];
    if (sg) sg.firstChild.style.transform = `scaleX(${clamp(this.t / this.durNow())})`;
  }
  durNow() { return this.o.dur ? this.o.dur(this.ids()[this.i]) : this.inst.dur; }
  tick(dt) {
    if (!this.playing || !this.inst) return;
    this.t += Math.min(64, dt);
    if (this.t >= this.durNow()) { if (this.i < this.ids().length - 1) this.mount(this.i + 1); else { this.t = this.inst.dur; this.draw(); this.setPlaying(false); if (this.onEnd) this.onEnd(); } }
    else this.draw();
  }
  setPlaying(p) { this.playing = p; this.bPlay.innerHTML = p ? ICON.pause : ICON.play; this.bPlay.setAttribute("aria-label", p ? "Pause" : "Play"); }
  toggle() { if (!this.inst) return; if (!this.playing && this.i === this.ids().length - 1 && this.t >= this.inst.dur) this.mount(0); this.setPlaying(!this.playing); }
  next() { if (this.i < this.ids().length - 1) this.mount(this.i + 1); else if (this.onEnd) this.onEnd(); }
  prev() { this.mount(this.t < 600 ? this.i - 1 : this.i); }
}
const players = new Set();
let lastNow = null;
function loop(now) { const dt = lastNow == null ? 16 : now - lastNow; lastNow = now; players.forEach((p) => p.tick(dt)); hoverTick(now); requestAnimationFrame(loop); }

// ================================================================== layout skeleton
const root = document.getElementById("root");
const NAV = [["recap", "Recap"], ...(RC ? [["studio", "Studio"]] : []), ["analysis", "Analysis"], ["change", "What to change"], ["time", "Over time"]];
function stylePicker(label) {
  if (STYLES.length < 2) return null;
  return h("div", { class: "seg style", role: "radiogroup", "aria-label": label },
    STYLES.map((st) => h("button", { type: "button", role: "radio", "data-style-btn": st.id, title: `${st.name} card style`, onclick: () => switchStyle(st.id) }, h("span", { class: "swatch", style: { background: st.swatch } }), h("span", { class: "lbl" }, st.name))));
}
root.append(h("header", { class: "topbar" }, h("div", { class: "wrap" },
  h("a", { class: "brand", href: "#recap" }, rabbitSvg("currentColor", "24px"), "AI Insights", h("small", {}, "by Matrix OS")),
  h("nav", { class: "nav", "aria-label": "Sections" }, NAV.map(([id, t]) => h("a", { href: "#" + id, "data-nav": id }, t))),
  h("span", { class: "spacer" }),
  stylePicker("Card style"))));

// ================================================================== HERO
const cur = RUNS[RUNS.length - 1], prevRun = RUNS.length > 1 ? RUNS[RUNS.length - 2] : null;
const rangeTxt = HERO.from && HERO.to ? `${dshort(HERO.from)} – ${dshort(HERO.to)}, ${HERO.to.slice(0, 4)}` : "";
const METRICS = {
  wallHours: { label: "hours with agents", fmt: (v) => int(v), better: null },
  agentHours: { label: "agent-hours", fmt: (v) => int(v), better: null },
  sessions: { label: "sessions", fmt: int, better: null },
  prompts: { label: "prompts you typed", fmt: int, better: null },
  usd: { label: "at API list prices", fmt: (v) => usd(v), better: null },
  failureRate: { label: "tool calls that failed", fmt: (v) => `${one(v * 100)}%`, better: "down", pct: true },
  testPass: { label: "test runs that passed", fmt: (v) => pct(v), better: "up", pct: true },
  cacheHitRate: { label: "input read from cache", fmt: (v) => `${one(v * 100)}%`, better: "up", pct: true },
  compactionsPerSession: { label: "compactions per session", fmt: (v) => one(v), better: "down" },
  maxParallel: { label: "most agents at once", fmt: int, better: null },
  medianResponseSec: { label: "median reply time", fmt: (v) => (v >= 60 ? `${one(v / 60)} min` : `${int(v)} s`), better: null },
  winRate: { label: "judged sessions that hit their goal", fmt: (v) => pct(v), better: "up", pct: true },
  streak: { label: "longest streak (days)", fmt: int, better: null },
};
const fmtM = (k, v) => (v == null ? "n/a" : METRICS[k].fmt(v));
function delta(key, now, then, short = false, base = prevRun) {
  const m = METRICS[key];
  if (now == null || then == null) return h("span", { class: "delta" }, now == null ? "n/a" : "new");
  const d = now - then;
  const txt = m.pct ? `${d >= 0 ? "+" : "−"}${one(Math.abs(d) * 100)} pts` : key === "usd" ? `${d >= 0 ? "+" : "−"}${usd(Math.abs(d))}` : `${d >= 0 ? "+" : "−"}${m.fmt(Math.abs(d))}`;
  const tiny = Math.abs(d) < (m.pct ? 0.002 : 0.5);
  const cls = tiny || !m.better ? "" : (d > 0) === (m.better === "up") ? "good" : "bad";
  const arrow = tiny ? "=" : d > 0 ? "↑" : "↓";
  return h("span", { class: "delta " + cls, title: m.better ? `${m.better === "up" ? "Higher" : "Lower"} is better` : "Neither better nor worse on its own" }, `${arrow} ${tiny ? "same" : txt}${short || !base ? "" : ` vs ${dshort(base.day)}`}`);
}
const heroKeys = [HERO.wallHours != null ? "wallHours" : "agentHours", "sessions", "prompts", ...(HERO.usd != null ? ["usd"] : [])];
const heroVal = { wallHours: HERO.wallHours, agentHours: HERO.agentHours, sessions: HERO.sessions, prompts: HERO.prompts, usd: HERO.usd };
const heroStats = h("div", { class: "stats" + (heroKeys.length === 3 ? " three" : "") }, heroKeys.map((k) => h("div", { class: "stat" },
  h("div", { class: "sv" }, fmtM(k, heroVal[k])), h("div", { class: "sl" }, METRICS[k].label), prevRun ? delta(k, heroVal[k], prevRun.metrics[k]) : null)));
const heroPlayerSlot = h("div", { class: "player-slot" });
const hours0 = HERO.wallHours != null ? HERO.wallHours : HERO.agentHours;
const h1 = h("h1", {}, `${int(hours0)} ${HERO.wallHours != null ? "hours with agents" : "agent-hours"}.`,
  HERO.maxParallel >= 2 ? [h("br"), h("em", {}, `${HERO.maxParallel} at once`), " at the peak."] : HERO.activeDays ? [h("br"), h("em", {}, plural(HERO.activeDays, "busy day")), "."] : null);
const hero = h("section", { class: "hero" + (RC ? "" : " solo"), id: "recap" }, h("div", { class: "wrap" },
  h("div", {},
    h("div", { class: "eyebrow" }, h("span", { class: "dot" }), `Your AI coding report${rangeTxt ? ` · ${rangeTxt}` : ""}`),
    h1,
    h("p", { class: "lede", html: md(HERO.lede) }),
    RC ? h("div", { class: "cta" }, h("button", { class: "btn primary big", type: "button", onclick: () => openTheater(0) }, h("span", { class: "pl", html: ICON.play }), "Play your recap"), h("a", { class: "btn", href: "#studio" }, h("span", { html: ICON.film }), "Make a video")) : null,
    heroStats,
    VIEW.notes.recap ? h("p", { class: "note" }, VIEW.notes.recap) : null),
  RC ? heroPlayerSlot : null));
root.append(hero);
const heroPlayer = new Player({
  ids: seqIds, ratio: () => S.ratio, dur: durOf,
  box: () => { const narrow = innerWidth < 1020; const maxW = narrow ? Math.min(innerWidth - 32, 560) : 520; const maxH = narrow ? innerHeight * 0.72 : Math.min(innerHeight - 140, 680); return { w: maxW, h: maxH }; },
  extraBtn: (() => { const b = h("button", { class: "ibtn", type: "button", "aria-label": "Full screen", title: "Full screen", html: ICON.full }); b.addEventListener("click", () => openTheater(heroPlayer.i)); return b; })(),
});
heroPlayerSlot.append(heroPlayer.root);
if (RC) players.add(heroPlayer);

const theater = h("div", { class: "theater", role: "dialog", "aria-modal": "true", "aria-label": "Recap" });
const thShare = h("div", { class: "th-share" });
const thPlayer = new Player({ ids: seqIds, ratio: () => S.ratio, dur: durOf, box: () => ({ w: innerWidth - 40, h: innerHeight - 110 - (thShare.childElementCount ? thShare.offsetHeight + 12 : 0) }) });
const thClose = h("button", { class: "ibtn close", type: "button", "aria-label": "Close", html: ICON.close, onclick: () => closeTheater() });
theater.append(thClose, thPlayer.root, thShare);
let thShared = false;
thPlayer.onEnd = async () => {
  if (thShared) return;
  thShared = true;
  const inst = thPlayer.inst;
  const card = await Exporter.png(makeInst(seqIds()[thPlayer.i]));
  if (!theater.classList.contains("on") || !inst) { thShared = false; return; }
  thShare.append(h("div", { class: "row-between" }, h("strong", {}, "Like it? Share it."), h("button", { class: "btn small", type: "button", onclick: () => { closeTheater(); document.getElementById("studio").scrollIntoView(); bVideo.focus(); } }, "Make the video")));
  shareSheet(thShare, [{ name: `ai-insights-${seqIds()[thPlayer.i]}-${S.ratio.replace(":", "x")}.png`, blob: card }], "image");
  thPlayer.size();
};
let theaterReturn = null;
function openTheater(i) {
  if (!seqIds().length) { say("Select at least one card"); return; }
  theaterReturn = document.activeElement;
  heroPlayer.setPlaying(false);
  theater.classList.add("on"); document.body.style.overflow = "hidden";
  thShare.replaceChildren(); thShared = false; thPlayer.size();
  thPlayer.reload(); thPlayer.mount(i); thPlayer.setPlaying(!reduced); players.add(thPlayer);
  thPlayer.vp.focus();
}
function closeTheater() { theater.classList.remove("on"); document.body.style.overflow = ""; thPlayer.setPlaying(false); players.delete(thPlayer); if (thPlayer.inst) { thPlayer.inst.el.remove(); thPlayer.inst = null; } theaterReturn && theaterReturn.focus(); }
theater.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTheater();
  else if (e.key === "Tab") { e.preventDefault(); (document.activeElement === thClose ? thPlayer.vp : thClose).focus(); }
  else if (e.target === theater || e.target === thClose) thPlayer.key(e);
});

// ================================================================== STUDIO
// Platform limits as each platform documents them. No links: the report links only to Matrix OS and suggestion docs.
const PRESETS = {
  x: { label: "X post", max: 140, approx: true, best: ["1:1", "16:9"], ok: ["1:1", "16:9", "4:5", "9:16"], note: "About 2:20 for most accounts; X recommends 1:1 or 16:9." },
  igfeed: { label: "Instagram feed", max: 900, soft: 180, best: ["4:5", "1:1"], ok: ["1:1", "4:5", "9:16", "16:9"], note: "Feed videos post as Reels: up to 15 min." },
  reels: { label: "Instagram Reels", max: 900, soft: 180, best: ["9:16"], ok: ["9:16", "4:5", "1:1"], note: "3 s to 15 min, 9:16 recommended." },
  stories: { label: "Instagram Stories", max: 60, min: 3, best: ["9:16"], ok: ["9:16"], note: "3 to 60 s per story, 9:16." },
  tiktok: { label: "TikTok", max: 180, best: ["9:16"], ok: ["9:16", "1:1"], note: "Every creator can post 3 min; some accounts get longer." },
  linkedin: { label: "LinkedIn", max: 900, min: 3, best: ["1:1", "4:5", "16:9"], ok: ["1:1", "4:5", "16:9", "9:16"], note: "3 s to 15 min." },
  shorts: { label: "YouTube Shorts", max: 180, best: ["9:16", "1:1"], ok: ["9:16", "1:1", "4:5"], note: "Up to 3 min, square or vertical only." },
};
if (!PRESETS[S.preset]) S.preset = "x";
const RATIO_INFO = { "1:1": [16, 16, "Square"], "9:16": [11, 18, "Story"], "4:5": [14, 17, "Portrait"], "16:9": [20, 12, "Wide"] };
const ratioSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Shape" }, Object.entries(RATIO_INFO).map(([r, [w, hh2, name]]) => h("button", { type: "button", role: "radio", "data-ratio": r, onclick: () => setRatio(r), title: `${name} ${r}` }, h("i", { class: "ratio-ico", style: { width: w + "px", height: hh2 + "px" } }), r)));
const paceSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Pace" }, [["full", "Full"], ["quick", "Quick 4 s"]].map(([k, t]) => h("button", { type: "button", role: "radio", "data-pace": k, onclick: () => { S.pace = k; saveStudio(); refreshStudio(); } }, t)));
const presetSel = h("select", { class: "sel", "aria-label": "Where you will post" }, Object.entries(PRESETS).map(([k, p]) => h("option", { value: k }, p.label)));
presetSel.value = S.preset;
presetSel.addEventListener("change", () => { S.preset = presetSel.value; saveStudio(); refreshStudio(); });
const markBox = h("input", { type: "checkbox", id: "mark-toggle" });
markBox.checked = S.mark;
markBox.addEventListener("change", () => { S.mark = markBox.checked; saveStudio(); buildWall(); refreshStudio(); });
const timeTxt = h("div", { class: "timeline-txt" }), meter = h("div", { class: "meter" }, h("b"));
const warn = h("div", { class: "warn", role: "status" });
const wall = h("div", { class: "wall", role: "list", "aria-label": "Cards. Space selects, Alt with arrow keys reorders." });
const countTxt = h("span", { class: "count" });
const bVideo = h("button", { class: "btn primary", type: "button" }, h("span", { html: ICON.film }), "Download video");
const bPngs = h("button", { class: "btn", type: "button" }, h("span", { html: ICON.img }), "Download images");
const bText = h("button", { class: "btn", type: "button" }, h("span", { html: ICON.copy }), "Copy caption");
const bPreview = h("button", { class: "btn", type: "button", onclick: () => openTheater(0) }, h("span", { html: ICON.play }), "Preview");
const bAll = h("button", { class: "btn small", type: "button", onclick: () => { S.sel = new Set(S.order); saveStudio(); refreshStudio(); } }, "Select all");
const bReset = h("button", { class: "btn small", type: "button", onclick: () => { S.sel = new Set(DEFAULT_SEL); S.order = DEFAULT_ORDER.slice(); saveStudio(); buildWall(); refreshStudio(); } }, "Reset");
const exportPanel = h("div", { class: "export-panel", "aria-live": "polite" });
const cliBox = h("div", { class: "cli" });
if (RC) {
  const hidden = CARD_IDS.filter((id) => !avail(id));
  root.append(h("section", { class: "block", id: "studio" }, h("div", { class: "wrap" },
    h("div", { class: "sh" }, h("div", {}, h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "Card studio"), h("h2", {}, "Pick the cards, pick the shape."),
      h("p", {}, "Every card is laid out again for each shape, so nothing is cropped. Cards hold counts only: no prompts, names or project names.", hidden.length ? ` ${plural(hidden.length, "card")} ${hidden.length === 1 ? "is" : "are"} left out because this history has no data for ${hidden.length === 1 ? "it" : "them"}.` : "")),
      h("div", { class: "private", html: `${ICON.check} Share-safe` })),
    h("div", { class: "studio-bar" },
      h("div", { class: "field" }, h("span", {}, "Shape"), ratioSeg),
      STYLES.length > 1 ? h("div", { class: "field" }, h("span", {}, "Style"), stylePicker("Card style")) : null,
      h("label", { class: "field" }, h("span", {}, "Posting to"), presetSel),
      h("div", { class: "field" }, h("span", {}, "Pace"), paceSeg),
      h("div", { class: "field" }, h("span", {}, "Mark"), h("label", { class: "toggle", for: "mark-toggle" }, markBox, h("span", {}, "AI Insights mark"))),
      h("div", { class: "field timebox" }, h("span", {}, "Length"), timeTxt, meter)),
    warn,
    h("div", { class: "studio-actions" }, bVideo, bPngs, bText, bPreview, bAll, bReset, countTxt),
    exportPanel, cliBox, wall)));
}
function setRatio(r) { if (!CardKit.RATIOS[r]) return; S.ratio = r; saveStudio(); buildWall(); refreshStudio(); heroPlayer.reload(); }
let tiles = new Map();
const MV = (dir) => h("button", { class: "mv", type: "button", "aria-label": dir < 0 ? "Move earlier" : "Move later", title: dir < 0 ? "Move earlier" : "Move later", html: dir < 0 ? ICON.left : ICON.right });
function buildWall() {
  if (!RC) return;
  const [W, H] = CardKit.RATIOS[S.ratio];
  wall.style.setProperty("--tw", (S.ratio === "16:9" ? 270 : S.ratio === "9:16" ? 150 : 190) + "px");
  wall.classList.toggle("wide", S.ratio === "16:9");
  for (const t of tiles.values()) t.inst.el.remove();
  wall.replaceChildren(); tiles = new Map();
  for (const id of S.order.filter((cid) => hasCard(cid))) {
    const inst = makeInst(id);
    render(inst, inst.dur);
    const thumb = h("div", { class: "thumb", style: { aspectRatio: `${W} / ${H}` } }, inst.el);
    const tile = h("div", { class: "tile", role: "listitem", draggable: "true", "data-id": id });
    const toggle = h("div", { role: "checkbox", tabindex: "0", "aria-label": `${inst.title} card`, class: "tgl" }, thumb);
    const left = MV(-1), right = MV(1);
    tile.append(toggle, ...(specOf(id).outro ? [h("span", { class: "tag" }, "outro")] : []),
      h("div", { class: "meta" }, h("span", { class: "num" }), h("span", { class: "nm" }, inst.title), h("span", { class: "dur" }), left, right));
    const flip = () => { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); saveStudio(); refreshStudio(); };
    toggle.addEventListener("click", flip);
    toggle.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); move(id, e.key === "ArrowLeft" ? -1 : 1); tiles.get(id).toggle.focus(); } });
    left.addEventListener("click", () => { move(id, -1); left.focus(); });
    right.addEventListener("click", () => { move(id, 1); right.focus(); });
    const hov = () => { if (!reduced) hoverStart(id); };
    toggle.addEventListener("pointerenter", hov); toggle.addEventListener("focus", hov);
    toggle.addEventListener("pointerleave", () => hoverStop(id)); toggle.addEventListener("blur", () => hoverStop(id));
    tile.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; tile.classList.add("dragging"); });
    tile.addEventListener("dragend", () => { tile.classList.remove("dragging"); wall.querySelectorAll(".drop-before,.drop-after").forEach((x) => x.classList.remove("drop-before", "drop-after")); });
    tile.addEventListener("dragover", (e) => { e.preventDefault(); const r = tile.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2; tile.classList.toggle("drop-after", after); tile.classList.toggle("drop-before", !after); });
    tile.addEventListener("dragleave", () => tile.classList.remove("drop-before", "drop-after"));
    tile.addEventListener("drop", (e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/plain"); const after = tile.classList.contains("drop-after"); tile.classList.remove("drop-before", "drop-after"); if (from && from !== id && tiles.has(from)) placeNear(from, id, after); });
    wall.append(tile);
    tiles.set(id, { tile, thumb, inst, toggle, left, right });
  }
  sizeThumbs();
}
function sizeThumbs() { for (const t of tiles.values()) { const sc = t.thumb.clientWidth / t.inst.W; t.inst.el.style.transform = `scale(${sc})`; } }
if (RC && window.ResizeObserver) new ResizeObserver(() => sizeThumbs()).observe(wall);
function move(id, dir) {
  const i = S.order.indexOf(id), j = clamp(i + dir, 0, S.order.length - 1);
  if (i < 0 || i === j) return;
  S.order.splice(i, 1); S.order.splice(j, 0, id);
  reorderDom(); saveStudio(); refreshStudio();
}
function placeNear(from, to, after) {
  S.order.splice(S.order.indexOf(from), 1);
  S.order.splice(S.order.indexOf(to) + (after ? 1 : 0), 0, from);
  reorderDom(); saveStudio(); refreshStudio();
}
function reorderDom() { for (const id of S.order) if (tiles.has(id)) wall.append(tiles.get(id).tile); }
let hovering = null;
function hoverStart(id) { hovering = { id, t0: null }; }
function hoverStop(id) { if (hovering && hovering.id === id) { const t = tiles.get(id); t && render(t.inst, t.inst.dur); hovering = null; } }
function hoverTick(now) {
  if (!hovering) return;
  const t = tiles.get(hovering.id); if (!t) return;
  if (hovering.t0 == null) hovering.t0 = now;
  const el = (now - hovering.t0) % (t.inst.dur + 900);
  render(t.inst, Math.min(el, t.inst.dur));
}
function refreshStudio() {
  if (!RC) return;
  document.querySelectorAll("[data-ratio]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.ratio === S.ratio)));
  document.querySelectorAll("[data-pace]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pace === S.pace)));
  document.querySelectorAll("[data-style-btn]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.styleBtn === S.style)));
  const ids = seqIds();
  let n = 0;
  for (const id of S.order) {
    const t = tiles.get(id); if (!t) continue;
    const on = S.sel.has(id);
    t.tile.classList.toggle("sel", on);
    t.toggle.setAttribute("aria-checked", String(on));
    t.tile.querySelector(".num").textContent = on ? String(++n) : "–";
    t.tile.querySelector(".dur").textContent = fmtSec(durOf(id));
    t.left.disabled = S.order[0] === id; t.right.disabled = S.order[S.order.length - 1] === id;
  }
  const total = ids.reduce((a, id) => a + durOf(id), 0), P = PRESETS[S.preset], lim = P.max * 1000;
  timeTxt.replaceChildren(h("span", {}, `${fmtSec(total)} · ${ids.length} card${ids.length === 1 ? "" : "s"}`), h("span", { class: "lim" }, `${P.approx ? "about " : ""}${fmtSec(lim)} max on ${P.label}`));
  meter.firstChild.style.width = Math.min(100, (total / lim) * 100) + "%";
  meter.classList.toggle("over", total > lim);
  const msgs = [];
  if (!ids.length) msgs.push(["bad", "Select at least one card."]);
  if (total > lim) msgs.push(["bad", `${fmtSec(total)} is longer than ${P.label} allows (${P.approx ? "about " : ""}${fmtSec(lim)}). Deselect ${Math.ceil((total - lim) / 6500)} card${total - lim > 6500 ? "s" : ""} or switch to Quick pace.`]);
  else if (P.soft && total > P.soft * 1000) msgs.push(["info", `Over ${fmtSec(P.soft * 1000)}: reported to reach fewer non-followers on ${P.label}.`]);
  if (P.min && total < P.min * 1000 && ids.length) msgs.push(["bad", `${P.label} needs at least ${P.min} s.`]);
  if (!P.ok.includes(S.ratio)) msgs.push(["bad", `${P.label} does not take ${S.ratio}. Use ${P.best.join(" or ")}.`]);
  else if (!P.best.includes(S.ratio)) msgs.push(["info", `${P.label} works best with ${P.best.join(" or ")}.`]);
  const worst = msgs.find((m) => m[0] === "bad") || msgs[0];
  warn.className = "warn" + (worst ? " on" + (worst[0] === "info" ? " info" : "") : "");
  warn.replaceChildren(...(msgs.length ? [h("div", {}, msgs.map((m) => h("div", {}, m[1])), h("div", { class: "small" }, P.note))] : []));
  countTxt.textContent = `${ids.length} of ${S.order.length} selected`;
  [bVideo, bPngs, bPreview].forEach((b) => (b.disabled = !ids.length));
  if (heroPlayer.root.isConnected) heroPlayer.reload(true);
  updateCli();
}

// ---------- the terminal path: headless Chrome screenshots of capture mode, stitched by ffmpeg
function cliScript() {
  const [W, H] = CardKit.RATIOS[S.ratio];
  const plan = seqIds().map((id) => `${id}:${durOf(id)}`).join(" ");
  const qs = `ratio=${S.ratio}&style=${S.style}&mark=${S.mark ? 1 : 0}`;
  return [
    `# The selected cards as the in-page exporter makes them: 30 fps, ${W}x${H}, H.264, limited-range BT.709.`,
    `# Needs Chrome or Chromium and ffmpeg. Run it in the folder that holds report.html.`,
    `CHROME=\${CHROME:-google-chrome}; REPORT="file://$PWD/report.html"; mkdir -p frames; i=0`,
    `for card in ${plan}; do id=\${card%%:*}; ms=\${card##*:}`,
    `  for ((t = 0; t < ms; t += 33)); do`,
    `    "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=4000 \\`,
    `      --window-size=${W},${H} --screenshot="frames/$(printf %06d $i).png" "$REPORT?capture=$id&t=$t&${qs}" 2>/dev/null`,
    `    i=$((i + 1)); done; done`,
    `ffmpeg -framerate 30 -i frames/%06d.png -vf "scale=out_range=tv:out_color_matrix=bt709,format=yuv420p" \\`,
    `  -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:v libx264 -crf 18 -movflags +faststart ai-insights-${S.ratio.replace(":", "x")}.mp4`,
  ].join("\n");
}
function updateCli() { const c = cliBox.querySelector("code"); if (c) c.textContent = cliScript(); }
function showCli(why) {
  cliBox.classList.add("on");
  cliBox.replaceChildren(h("div", {}, why || "Prefer the terminal? The same cards render headless, frame by frame:"), h("code", {}, cliScript()),
    h("button", { class: "btn small", type: "button", style: { borderColor: "currentColor", color: "inherit" }, onclick: () => copy(cliScript(), "Script copied") }, h("span", { html: ICON.copy }), "Copy script"),
    h("div", { class: "small", style: { opacity: 0.85, marginTop: "8px" } }, "Each frame is this page in capture mode (report.html?capture=<card>&t=<ms>), so the video matches what you see here. It takes a few minutes."));
}
let exporting = null;
bVideo.addEventListener("click", async () => {
  if (exporting) return;
  const sup = await Exporter.support();
  if (!sup.ok) { showCli(sup.why + " Run this instead:"); exportPanel.classList.remove("on"); return; }
  const ids = seqIds(), [W, H] = CardKit.RATIOS[S.ratio];
  const ac = new AbortController();
  const bar = h("div", { class: "progress" }, h("b")), info = h("div", { class: "mono small" }, "Starting…");
  const cancel = h("button", { class: "btn small", type: "button", onclick: () => ac.abort() }, "Cancel");
  exportPanel.classList.add("on");
  exportPanel.replaceChildren(h("strong", {}, `Rendering ${ids.length} cards at ${W}×${H}, 30 fps`), bar, h("div", { class: "row-between" }, info, cancel));
  const t0 = performance.now();
  exporting = ac;
  bVideo.disabled = true;
  const style = S.style, mark = S.mark, ratio = S.ratio;
  try {
    const seq = ids.map((id) => ({ ms: durOf(id), make: () => makeInst(id, ratio, style, mark), done: (inst) => inst.el.remove() }));
    const blob = await Exporter.video(seq, W, H, { signal: ac.signal, onProgress: ({ frame, frames, card, cards }) => {
      bar.firstChild.style.width = (frame / frames) * 100 + "%";
      const el = (performance.now() - t0) / 1000, eta = (el / frame) * (frames - frame);
      info.textContent = `Card ${card} of ${cards} · frame ${frame} of ${frames} · about ${Math.ceil(eta)} s left`;
    } });
    if (!blob) { exportPanel.replaceChildren(h("strong", {}, "Cancelled."), h("div", { class: "muted" }, "Nothing was saved.")); return; }
    const name = `ai-insights-${ratio.replace(":", "x")}-${ids.length}cards.mp4`;
    const url = Exporter.download(blob, name);
    window.__lastVideo = blob;
    exportPanel.replaceChildren(h("strong", {}, `Saved ${name}`), h("div", { class: "muted mono small" }, `${(blob.size / 1e6).toFixed(1)} MB · ${fmtSec(ids.reduce((a, id) => a + durOf(id), 0))} · rendered in ${Math.round((performance.now() - t0) / 1000)} s`),
      h("div", { class: "done-video" }, h("video", { src: url, controls: true, muted: true, playsinline: true }), h("div", {}, h("p", { style: { marginTop: 0 } }, "Silent MP4, H.264. Add music in the app you post from."))));
    shareSheet(exportPanel, [{ name, blob }], "video");
  } catch (err) {
    console.error("video export failed", err);
    exportPanel.replaceChildren(h("strong", {}, "The video could not be made in this browser."));
    showCli("Run this instead:");
  } finally { exporting = null; bVideo.disabled = !seqIds().length; }
});
bPngs.addEventListener("click", async () => {
  const ids = seqIds(); if (!ids.length) return;
  say(`Rendering ${ids.length} image${ids.length > 1 ? "s" : ""}…`);
  try {
    const files = [];
    for (const [i, id] of ids.entries()) { const inst = makeInst(id); const blob = await Exporter.png(inst); inst.el.remove(); files.push({ name: `${String(i + 1).padStart(2, "0")}-${id}-${S.ratio.replace(":", "x")}.png`, blob }); }
    window.__lastPngs = files;
    if (files.length === 1) Exporter.download(files[0].blob, files[0].name);
    else Exporter.download(await Exporter.zip(files), `ai-insights-cards-${S.ratio.replace(":", "x")}.zip`);
    say(files.length === 1 ? "Saved" : `Saved ${files.length} images as a zip`);
    exportPanel.classList.add("on");
    exportPanel.replaceChildren(h("strong", {}, files.length === 1 ? `Saved ${files[0].name}` : `Saved ${files.length} images as a zip`));
    shareSheet(exportPanel, files, files.length === 1 ? "image" : "images");
  } catch (err) { console.error("image export failed", err); say("Could not export images"); }
});
/**
 * The caption: built from the recap only, like the cards. Two or three of the most brag-worthy numbers, the
 * persona, how to make your own and the tag, kept under X's 280 characters (X counts any link as 23).
 */
function caption() {
  if (!RC) return "";
  const T = RC.totals;
  const brag = [];
  if (RC.parallel.max >= 3) brag.push(`${RC.parallel.max} agents running at once`);
  if (T.wallHours >= 1) brag.push(`${int(T.wallHours)} hours with AI agents in ${RC.range.days} days`);
  if (RC.usage.tokens >= 1e6) brag.push(`${compact(RC.usage.tokens)} tokens`);
  if (RC.streak.days >= 5) brag.push(`a ${RC.streak.days}-day streak`);
  if (RC.shell.rmrf + RC.shell.forcePush >= 5) brag.push(`${int(RC.shell.rmrf)} rm -rf`);
  if (brag.length < 2) brag.push(`${int(T.sessions)} sessions`, `${int(T.prompts)} prompts`);
  const head = RC.persona ? `I'm ${RC.persona.title}.` : `My last ${RC.range.days} days with AI coding agents.`;
  const make = `Make yours: ${SHARE.command} or ${SHARE.skill}`;
  const xLen = (t) => t.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  for (let n = Math.min(3, brag.length); n >= 1; n--) {
    const text = [head, brag.slice(0, n).join(" · "), make, SHARE.siteUrl, SHARE.hashtag].join("\n");
    if (xLen(text) <= 280) return text;
  }
  return [head, make, SHARE.siteUrl, SHARE.hashtag].join("\n");
}
bText.addEventListener("click", () => copy(caption(), "Caption copied"));

// ---------- sharing: links the person clicks. The page itself still fetches nothing.
// X's web intent prefills text only; Instagram and TikTok have no web composer; LinkedIn's feed composer takes
// text. So: the system share sheet with the file where the browser can share files (phones, some desktops),
// otherwise save the file first and open the composer with the caption, saying plainly to attach it.
const INTENT = {
  x: (text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  linkedin: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
};
function canShareFiles(files) {
  try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files })); }
  catch (err) { console.warn("share probe failed", err); return false; }
}
async function copyImage(blob) {
  if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write || blob.type !== "image/png") return false;
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return true; }
  catch (err) { console.warn("image copy failed", err); return false; }
}
/** files: [{ name, blob }]. Shows the share row and a status line under `host`. */
function shareSheet(host, files, what) {
  const fileObjs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  const status = h("p", { class: "share-status small", role: "status" });
  const single = files.length === 1, img = single && files[0].blob.type === "image/png";
  const saveAll = async () => { if (single) Exporter.download(files[0].blob, files[0].name); else Exporter.download(await Exporter.zip(files), `ai-insights-cards-${S.ratio.replace(":", "x")}.zip`); };
  const open = (url) => { const w = window.open(url, "_blank", "noopener,noreferrer"); if (!w) status.textContent = "Your browser blocked the new tab. Allow pop-ups for this page, or paste the caption yourself."; };
  const btn = (label, fn, cls = "btn small") => h("button", { class: cls, type: "button", onclick: fn }, label);
  const native = canShareFiles(fileObjs);
  const row = h("div", { class: "share-row" },
    native ? btn("Share…", async () => {
      try { await navigator.share({ files: fileObjs, text: caption() }); status.textContent = "Shared."; }
      catch (err) { if (err && err.name === "AbortError") return; console.warn("share failed", err); status.textContent = "Sharing did not work here; use Download instead."; }
    }, "btn small primary") : null,
    btn("X", async () => {
      const copied = img && (await copyImage(files[0].blob));
      if (!copied) await saveAll();
      open(INTENT.x(caption()));
      status.textContent = copied ? "The post opened with your caption. Paste the image into it (Ctrl or Cmd + V)." : `The post opened with your caption. Attach the ${what} you just downloaded.`;
    }),
    btn("Instagram", async () => { await saveAll(); copy(caption(), "Caption copied"); status.textContent = `Saved, and the caption is copied. Instagram posts from the app: send the ${what} to your phone, or use Share… on your phone.`; }),
    btn("TikTok / Shorts", async () => { await saveAll(); copy(caption(), "Caption copied"); status.textContent = `Saved, and the caption is copied. Upload the ${what} in TikTok or YouTube (9:16 works best).`; }),
    btn("LinkedIn", async () => { await saveAll(); open(INTENT.linkedin(caption())); status.textContent = `LinkedIn opened with your caption. Attach the ${what} you just downloaded.`; }),
    btn("Download", async () => { await saveAll(); status.textContent = "Saved."; }),
    btn("Copy caption", () => copy(caption(), "Caption copied")));
  host.append(h("div", { class: "share" }, h("div", { class: "share-h" }, "Share it"), row, status,
    h("p", { class: "muted small" }, `Posted it? Tag ${SHARE.hashtag} so others can find theirs. Nothing here is tracked.`)));
}

// ================================================================== ANALYSIS
const analysis = h("section", { class: "block", id: "analysis" }, h("div", { class: "wrap" }));
const AW = analysis.firstChild;
AW.append(h("div", { class: "sh" }, h("div", {}, h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "The full analysis"), h("h2", {}, "How it actually went."), h("p", {}, "The main numbers first; open “More detail” under each part for the rest. Hover a bar for its numbers, open a finding for its evidence.")),
  h("div", { class: "private", html: `${ICON.lock} Only on this machine. Never on a card.` })));
root.append(analysis);
let subN = 0;
const sub = (title, say_) => { const el = h("div", { class: "sub", id: "a-" + title.toLowerCase().replace(/[^a-z]+/g, "-") }, h("h3", {}, h("span", { class: "sn" }, String(++subN).padStart(2, "0")), title), say_ ? h("p", { class: "say", html: say_ }) : null); AW.append(el); return el; };
const panel = (title, right, ...kids) => h("div", { class: "panel" }, h("h4", {}, h("span", {}, title), right ? h("span", { class: "r" }, right) : null), ...kids);
const more = (label, ...kids) => h("details", { class: "more" }, h("summary", {}, label || "More detail"), h("div", { class: "more-body" }, ...kids));
const svgEl = (w, hgt) => s("svg", { class: "chart", viewBox: `0 0 ${w} ${hgt}`, role: "img" });
const txt = (x, y, str, anchor = "middle") => s("text", { x, y, "text-anchor": anchor }, document.createTextNode(str));
function hbars(rows, o = {}) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  if (!rows.length) return h("p", { class: "muted small" }, o.empty || "Nothing recorded.");
  return h("div", {}, rows.map((r) => { const el = h("div", { class: "hbar" }, h("span", { class: "nm", title: r.title || r.key }, r.label ?? r.key, r.note ? h("small", {}, ` · ${r.note}`) : null), h("span", { class: "t" }, h("b", { style: { width: (r.count / max) * 100 + "%", background: r.color || "var(--ink)" } })), h("span", { class: "hv" }, o.fmt ? o.fmt(r) : int(r.count))); if (r.tip) bindTip(el, r.tip); return el; }));
}
const KEYL = { git_and_prs: "Git and PRs", devops: "DevOps", mcp: "MCP", ask_user: "Asking you", user_rejected: "Rejected by you", command_failed: "Commands exited non-zero", file_not_found: "Files that weren't there", file_changed: "Files changed underneath", edit_mismatch: "Edits that didn't match", permission_denied: "Permission denied", timeout: "Timed out", too_large: "Too big to read", other: "Everything else" };
const keyLabel = (k) => KEYL[k] || (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");
const HCOL = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
const HORDER = VIEW.coverage.filter((c) => c.found).sort((a, b) => b.sessions - a.sessions).map((c) => c.harness);
const harnessColor = (key) => HCOL[Math.max(0, HORDER.indexOf(key)) % HCOL.length];

// ---- rhythm
{
  const hours = ACT.hours, hp = ACT.harnessHours.length > 1 ? ACT.harnessHours : [{ key: ACT.harnessHours[0] ? ACT.harnessHours[0].key : "all", hours }];
  const total = hours.reduce((a, b) => a + b, 0), peak = hours.indexOf(Math.max(...hours));
  const night = [22, 23, 0, 1, 2, 3, 4].reduce((a, x) => a + hours[x], 0) / Math.max(1, total);
  const quiet = RC && RC.rhythm.quiet.len >= 3 ? ` Nothing between ${hh(RC.rhythm.quiet.start)} and ${hh((RC.rhythm.quiet.start + RC.rhythm.quiet.len) % 24)}.` : "";
  const say0 = total >= 10 ? `${RC ? `<b>${esc(RC.rhythm.verdict.label)}.</b> ` : ""}${pct(night)} of your messages came after 22:00 and the busiest hour was ${hh(peak)}.${quiet} Longest streak: ${plural(ACT.streak, "day")} in a row.` : `Too few messages (${int(total)}) to call an hour a habit yet.`;
  const el = sub("Rhythm", say0);
  const W = 720, H = 200, max = Math.max(...hours, 1), bw = W / 24;
  const hs = svgEl(W, H + 22); hs.setAttribute("aria-label", `Messages by hour of day, busiest ${hh(peak)}`);
  // Quiet hours can wrap past midnight (23:00 to 05:00): draw both pieces.
  if (RC && RC.rhythm.quiet.len >= 3) {
    const q0 = RC.rhythm.quiet.start, q1 = q0 + RC.rhythm.quiet.len;
    hs.append(s("rect", { x: q0 * bw, y: 0, width: (Math.min(24, q1) - q0) * bw, height: H, fill: "var(--surface-2)" }));
    if (q1 > 24) hs.append(s("rect", { x: 0, y: 0, width: (q1 - 24) * bw, height: H, fill: "var(--surface-2)" }));
  }
  for (let i = 0; i < 24; i++) {
    let y = H;
    hp.forEach((p) => { const v = p.hours[i], bh = (v / max) * (H - 14); y -= bh; hs.append(s("rect", { x: i * bw + 3, y, width: bw - 6, height: Math.max(0, bh), rx: 2, fill: harnessColor(p.key) })); });
    if (i % 3 === 0) hs.append(txt(i * bw + bw / 2, H + 16, String(i).padStart(2, "0")));
    const hit = s("rect", { class: "hit", x: i * bw, y: 0, width: bw, height: H });
    bindTip(hit, `<b>${hh(i)}</b> · ${int(hours[i])} messages${hp.length > 1 ? "<br>" + hp.map((p) => `${esc(harnessName(p.key))} ${int(p.hours[i])}`).join(" · ") : ""}`);
    hs.append(hit);
  }
  const daily = ACT.daily, calMetric = { k: "prompts" };
  const cal = h("div", {});
  const drawCal = () => {
    const vals = daily.map((d) => (calMetric.k === "prompts" ? d.prompts : calMetric.k === "minutes" ? d.minutes : d.usd || 0));
    const max2 = Math.max(...vals, 1), firstDow = daily.length ? (new Date(daily[0].day + "T12:00:00Z").getUTCDay() + 6) % 7 : 0;
    const weeks = Math.ceil((daily.length + firstDow) / 7);
    // Up to ten weeks read top to bottom like a month; longer histories run left to right like a contribution graph.
    const vertical = weeks <= 10, cs = vertical ? 34 : Math.max(9, Math.min(16, 760 / weeks - 3)), g = vertical ? 5 : 3;
    const cols = vertical ? 7 : weeks, rows = vertical ? weeks : 7;
    const sv = s("svg", { class: "chart", viewBox: `0 0 ${cols * (cs + g) + 22} ${rows * (cs + g) + 22}`, style: vertical ? "max-width:300px" : "", role: "img", "aria-label": "Daily activity calendar" });
    "MTWTFSS".split("").forEach((l, i) => sv.append(vertical ? txt(i * (cs + g) + cs / 2 + 2, 12, l) : txt(8, 20 + i * (cs + g) + cs * 0.75, l)));
    daily.forEach((d, i) => {
      const j = i + firstDow, wk = Math.floor(j / 7), dw = j % 7;
      const x = vertical ? dw * (cs + g) + 2 : 20 + wk * (cs + g), y = vertical ? wk * (cs + g) + 20 : dw * (cs + g) + 20, v = vals[i];
      const r = s("rect", { x, y, width: cs, height: cs, rx: Math.min(6, cs / 4), fill: v ? "var(--accent)" : "var(--surface-2)", "fill-opacity": v ? 0.18 + 0.82 * Math.sqrt(v / max2) : 1 });
      sv.append(r);
      bindTip(r, `<b>${dshort(d.day)}</b><br>${int(d.prompts)} messages · ${plural(d.sessions, "session")} started<br>${int(d.minutes)} min with agents${d.usd != null ? ` · ${usd(d.usd)}` : ""}`);
    });
    cal.replaceChildren(sv);
  };
  const calChips = h("div", { class: "chips", role: "group", "aria-label": "Calendar metric" }, [["prompts", "Messages"], ["minutes", "Agent time"], ...(USE.usd != null ? [["usd", "Cost"]] : [])].map(([k, t]) => { const b = h("button", { class: "pchip", type: "button", "aria-pressed": String(k === calMetric.k) }, t); b.addEventListener("click", () => { calMetric.k = k; calChips.querySelectorAll(".pchip").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); drawCal(); }); return b; }));
  drawCal();
  const legend = hp.length > 1 ? h("div", { class: "plegend" }, hp.map((p) => h("span", {}, h("i", { style: { background: harnessColor(p.key) } }), `${harnessName(p.key)} peaks ${hh(p.hours.indexOf(Math.max(...p.hours)))}`))) : null;
  el.append(h("div", { class: "grid g21" },
    panel("Messages by hour", TZ, hs, legend),
    panel("Calendar", plural(ACT.activeDays, "active day"), calChips, h("div", { style: { marginTop: "12px" } }, cal))));
  const wd = ACT.weekdays, wdMax = Math.max(1, ...wd.map((d) => d.count));
  const wds = svgEl(300, 222); wds.setAttribute("aria-label", "Prompts by weekday");
  wd.forEach((d, i) => { const bh = (d.count / wdMax) * 180, x = i * (300 / 7); const r = s("rect", { x: x + 6, y: 200 - bh, width: 300 / 7 - 12, height: bh, rx: 4, fill: d.count === wdMax ? "var(--ink)" : "var(--line-strong)" }); wds.append(r, txt(x + 300 / 14, 216, d.key)); bindTip(r, `<b>${d.key}</b> · ${int(d.count)} prompts`); });
  const rb = ACT.responseBuckets, rbTotal = rb.reduce((a, b) => a + b.count, 0);
  el.append(more("More detail: weekdays and reply times", h("div", { class: "grid g12" },
    wd.length ? panel("Weekdays", null, wds) : panel("Weekdays", null, h("p", { class: "muted small" }, "Appears with the recap.")),
    panel("How fast you reply", ACT.medianResponseSec != null ? `median ${METRICS.medianResponseSec.fmt(ACT.medianResponseSec)}` : null, h("p", { class: "muted small" }, "Time between an agent finishing and your next message. Long gaps usually mean you were running other agents."), hbars(rb.map((b) => ({ key: b.key, count: b.count, tip: `${int(b.count)} replies (${pct(b.count / Math.max(1, rbTotal))})` })))))));
}

// ---- how you work
{
  const A2 = ACT;
  const style = VIEW.narrative && VIEW.narrative.interactionStyle ? md(VIEW.narrative.interactionStyle) + " " : "";
  const el = sub("How you work", `${style}You typed ${int(HERO.prompts)} prompts; your agents made ${int(A2.toolCalls)} tool calls${A2.toolsPerPrompt != null ? `, <b>${int(A2.toolsPerPrompt)} for every message you typed</b>` : ""}.`);
  const TL = VIEW.timeline;
  if (TL) {
    const box = h("div", { class: "lanes-wrap" }), sayEl = h("p", { class: "muted small", style: { margin: "10px 0 0" } });
    const drawDay = (d) => {
      const W = 1000, lh = d.lanes <= 6 ? 20 : d.lanes <= 12 ? 14 : 10, gap = d.lanes <= 12 ? 5 : 3, top0 = 30, H = top0 + d.lanes * (lh + gap) + 26;
      const sv = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, style: "min-width:600px", role: "img", "aria-label": d.summary });
      for (const t of d.ticks) sv.append(s("line", { x1: t.x * W, x2: t.x * W, y1: top0 - 4, y2: H - 22, stroke: t.major ? "var(--muted)" : "var(--line)" }), txt(t.x * W, H - 6, t.label, t.x < 0.04 ? "start" : t.x > 0.96 ? "end" : "middle"));
      const px = d.peak.x * W;
      sv.append(s("line", { x1: px, x2: px, y1: 14, y2: H - 22, stroke: "var(--ink)", "stroke-dasharray": "4 3" }), txt(Math.min(W - 4, Math.max(4, px)), 10, `${d.peak.count} open · ${d.peak.label}`, d.peak.x > 0.7 ? "end" : d.peak.x < 0.15 ? "start" : "middle"));
      for (const b of d.bars) {
        // With active stretches: a thin line for the session left open, solid blocks where it was working.
        const y = top0 + b.lane * (lh + gap), g = s("g"), col = harnessColor(b.harness);
        const block = (x0, w0) => s("rect", { x: x0 * W, y, width: Math.max(2.5, w0 * W), height: lh, rx: Math.min(4, lh / 3), fill: col, "fill-opacity": b.agent ? 0.45 : 1, stroke: b.agent ? "var(--ink)" : "none", "stroke-dasharray": "3 2" });
        if (b.active.length) { g.append(s("rect", { x: b.x * W, y: y + lh / 2 - 1.5, width: Math.max(2, b.w * W), height: 3, rx: 1.5, fill: col, "fill-opacity": 0.4 })); b.active.forEach(([x0, w0]) => g.append(block(x0, w0))); }
        else g.append(block(b.x, b.w));
        g.append(s("rect", { class: "hit", x: b.x * W, y, width: Math.max(4, b.w * W), height: lh }));
        bindTip(g, () => `<b>${esc(b.project)}</b> · ${esc(harnessName(b.harness))}${b.agent ? " · driven by another agent" : ""}<br>${esc(spanTxt(b.start, b.end))}`);
        sv.append(g);
      }
      box.replaceChildren(sv);
      sayEl.textContent = `${d.summary}${TL.sessions > TL.total ? ` Drawn from the newest ${int(TL.total)} sessions.` : ""}`;
    };
    const chips = TL.days.length > 1 ? h("div", { class: "chips", role: "group", "aria-label": "Day" }, TL.days.map((d, i) => { const b = h("button", { class: "pchip", type: "button", "aria-pressed": String(i === TL.busiest), title: `up to ${d.peak.count} open at once` }, `${d.label} · ${d.peak.count}`); b.addEventListener("click", () => { chips.querySelectorAll(".pchip").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); drawDay(d); }); return b; })) : null;
    const dd = TL.days[TL.busiest];
    drawDay(dd);
    const hs = [...new Set(TL.days.flatMap((d) => d.harnesses))];
    el.append(panel("Side by side", `busiest: ${dd.label}`, chips, h("div", { style: { marginTop: "14px" } }, box),
      h("div", { class: "plegend" }, hs.map((k) => h("span", {}, h("i", { style: { background: harnessColor(k) } }), harnessName(k))), h("span", {}, h("i", { style: { background: "transparent", boxShadow: "inset 0 0 0 1.5px var(--ink)" } }), "driven by another agent"), TL.days.some((d) => d.bars.some((b) => b.active.length)) ? h("span", {}, h("i", { style: { height: "3px", opacity: 0.5, background: "var(--muted)" } }), "open but idle (gaps over 10 min)") : null), sayEl));
  } else {
    el.append(panel("Side by side", null, h("p", { class: "muted small" }, A2.maxParallel >= 2 ? `Up to ${A2.maxParallel} sessions worked at the same moment (${plural(A2.overlapEvents, "overlap")}).` : "Your sessions ran one at a time: no two overlapped.")));
  }
  const F = VIEW.facets;
  const OUTL = { fully_achieved: "Fully achieved", mostly_achieved: "Mostly", partially_achieved: "Partly", not_achieved: "Not achieved", unclear: "Unclear", in_progress: "In progress" };
  const OUTC = { fully_achieved: "var(--good)", mostly_achieved: "var(--good-mid)", partially_achieved: "var(--c3)", not_achieved: "var(--bad)", unclear: "var(--line)", in_progress: "var(--line)" };
  const out = F ? F.outcomes : [], outTot = out.reduce((a, b) => a + b.count, 0);
  const win = RC && RC.winRate != null ? RC.winRate : F && outTot ? (out.filter((o) => o.key === "fully_achieved" || o.key === "mostly_achieved").reduce((a, b) => a + b.count, 0) / F.sessions) : null;
  const didItWork = F && outTot
    ? panel("Did it work?", `${plural(F.sessions, "session")} judged by your agent`,
      h("div", { class: "kpi" }, win != null ? pct(win) : "n/a", h("small", {}, "fully or mostly achieved")),
      h("div", { class: "stackbar" }, out.map((o) => { const sg = h("span", { style: { width: (o.count / outTot) * 100 + "%", background: OUTC[o.key] || "var(--line)" } }); bindTip(sg, `<b>${OUTL[o.key] || esc(o.key)}</b> · ${plural(o.count, "session")}`); return sg; })),
      h("div", { class: "plegend" }, out.map((o) => h("span", {}, h("i", { style: { background: OUTC[o.key] || "var(--line)" } }), `${OUTL[o.key] || o.key} ${o.count}`))))
    : panel("Did it work?", null, h("p", { class: "small" }, "No win rate yet: it comes from your agent judging each session. Run this in your own agent (it uses your existing account; nothing is uploaded):"), snip("Prompt for your agent", VIEW.review.prompt));
  el.append(h("div", { class: "grid g2", style: { marginTop: "16px" } },
    panel("Delegation", null,
      h("div", { class: "kpi" }, A2.toolsPerPrompt != null ? int(A2.toolsPerPrompt) : "n/a", h("small", {}, "tool calls per message")),
      h("div", { class: "facts" },
        RC ? h("div", {}, h("b", {}, int(RC.parallel.subagents)), " subagents launched in ", h("b", {}, int(A2.subagentSessions)), " sessions") : h("div", {}, h("b", {}, int(A2.subagentSessions)), " sessions used subagents"),
        h("div", {}, h("b", {}, int(A2.agentDriven)), ` of ${int(A2.sessions)} sessions were steered by another agent`),
        h("div", {}, h("b", {}, int(A2.planModeSessions)), " sessions used plan mode"),
        h("div", {}, h("b", {}, int(A2.compactions)), " context compactions"),
        h("div", {}, h("b", {}, `+${compact(A2.linesAdded)} / −${compact(A2.linesRemoved)}`), ` lines, ${plural(A2.commits, "commit")}`))),
    didItWork));
  const N = VIEW.narrative;
  const extra = [];
  if (N && N.workAreas.length) extra.push(h("div", { class: "cards3" }, N.workAreas.map((w) => h("div", { class: "mini" }, h("span", { class: "k" }, plural(w.sessions, "session")), h("b", { html: md(w.name) }), h("span", { html: md(w.description) })))));
  extra.push(h("div", { class: "grid g2" },
    panel("What the agents did", `${int(A2.toolCalls)} tool calls`, hbars(A2.toolCategories.slice(0, 8).map((c) => ({ key: c.key, label: keyLabel(c.key), count: c.count })), { fmt: (r) => compact(r.count) })),
    panel("Projects", "by agent time · home folder shown as ~", hbars(A2.projects.map((p) => ({ key: p.label, title: p.title, note: p.note, count: p.minutes || p.sessions, tip: `${esc(p.title)}<br>${plural(p.sessions, "session")}${p.note ? ` · ${esc(p.note)}` : ""}` })), { fmt: (r) => `${one(r.count / 60)} h`, empty: "No project folders recorded." }))));
  if (RC && (RC.connectors.length || RC.skills.length)) extra.push(h("div", { class: "grid g2" },
    panel("Connectors", "MCP servers · by sessions using them", hbars(RC.connectors.map((c) => ({ key: c.key, count: c.count })), { fmt: (r) => plural(r.count, "session"), empty: "No MCP servers used." })),
    panel("Skills", "by times used", hbars(RC.skills.map((c) => ({ key: c.key, count: c.count })), { fmt: (r) => int(r.count), empty: "No skills used." }))));
  if (RC) {
    const TH = RC.thinking, AP = RC.approvals, RP = RC.replies, hrs = (ms) => (ms >= 3_600_000 ? `${one(ms / 3_600_000)} h` : ms >= 60_000 ? `${int(ms / 60_000)} min` : `${int(ms / 1000)} s`);
    const facts = [
      TH ? h("div", {}, h("b", {}, compact(TH.blocks)), ` thinking blocks in ${plural(TH.sessions, "session")}`, TH.totalMs != null ? [", ", h("b", {}, hrs(TH.totalMs)), " of thinking"] : "", TH.longestMs != null ? [", the longest ", h("b", {}, hrs(TH.longestMs))] : "") : null,
      AP && AP.auto != null ? h("div", {}, h("b", {}, int(AP.auto)), " actions let through by your settings or mode") : null,
      AP && AP.byPerson != null ? h("div", {}, h("b", {}, int(AP.byPerson)), " approved by you") : null,
      AP && AP.denied != null ? h("div", {}, h("b", {}, int(AP.denied)), " declined by you") : null,
      AP && AP.autoBlocked != null ? h("div", {}, h("b", {}, int(AP.autoBlocked)), " blocked or timed out in Codex's automatic review (not you)") : null,
      AP && AP.guardianReviews != null ? h("div", {}, h("b", {}, int(AP.guardianReviews)), " automatic reviews in Codex") : null,
      RP ? h("div", {}, "You replied in ", h("b", {}, RP.medianSec >= 60 ? `${one(RP.medianSec / 60)} min` : `${int(RP.medianSec)} s`), ` (median of ${plural(RP.count, "reply", "replies")}), ${pct(RP.fastShare)} within a minute`) : null,
      RC.voice.excludedWrapped ? h("div", {}, h("b", {}, int(RC.voice.excludedWrapped)), " script-filled prompts left out of your voice stats") : null,
    ].filter(Boolean);
    if (facts.length) extra.push(panel("Thinking, approvals and replies", AP ? `approvals from ${plural(AP.sessions, "session")} that record them` : null, h("div", { class: "facts" }, facts)));
  }
  if (N && N.wins.length) extra.push(panel("Wins your agent noticed", null, h("div", { class: "facts" }, N.wins.map((w) => h("div", {}, h("b", { html: md(w.title) }), " ", h("span", { class: "muted", html: md(w.description) }))))));
  if (F && F.goals.length) extra.push(panel("What you worked on", `${plural(F.sessions, "session")} judged`, hbars(F.goals.slice(0, 8).map((g) => ({ key: g.key, label: keyLabel(g.key), count: g.count })))));
  el.append(more("More detail: tools, projects and work areas", ...extra));
}

// ---- cost
{
  const U = USE;
  const covered = U.noTokens.length ? ` Covers only tools that record token counts: ${listOf(U.noTokens.map(esc))} ${U.noTokens.length === 1 ? "does" : "do"} not, so ${U.noTokens.length === 1 ? "it has" : "they have"} no cost here.` : "";
  const sayCost = U.tokens > 0
    ? U.usd != null ? `About <b>${usd(U.usd)}</b> at API list prices for ${compact(U.tokens)} tokens.${U.cacheHitRate != null ? ` ${pct(U.cacheHitRate)} of input came from cache, which is what keeps that number down.` : ""} If you pay a subscription your bill is different: this is what the same work would cost through the API.${covered}`
      : `${compact(U.tokens)} tokens, none of them at a known price, so there is no cost estimate.${covered}`
    : `No token counts were recorded, so there is no cost to show.${covered}`;
  const el = sub("What it cost", sayCost);
  if (U.tokens > 0) {
    const parts = [["cachedInput", "Read from cache", "var(--c4)"], ["cacheWrite", "Written to cache", "var(--c3)"], ["input", "Fresh input", "var(--c1)"], ["output", "Output", "var(--ink)"]];
    const totalTok = parts.reduce((a, [k]) => a + U[k], 0) || 1;
    const stack = h("div", { class: "stackbar tall" }, parts.map(([k, l, c]) => { const sg = h("span", { style: { width: Math.max(0.4, (U[k] / totalTok) * 100) + "%", background: c } }); bindTip(sg, `<b>${l}</b> · ${compact(U[k])} tokens (${one((U[k] / totalTok) * 100)}%)`); return sg; }));
    el.append(h("div", { class: "grid g3" },
      panel("At list prices", U.recorded ? "an estimate" : null, h("div", { class: "kpi" }, U.usdText),
        U.recorded ? h("div", { class: "recorded" }, h("b", {}, "Recorded by the tools: "), U.recorded.harnesses.length > 1 || !U.recorded.harnesses.length ? U.recorded.text : `${U.recorded.harnesses[0].label} ${U.recorded.text}`,
          U.recorded.harnesses.length > 1 ? h("ul", { class: "small" }, U.recorded.harnesses.map((x) => h("li", {}, `${x.label}: ${x.text}`))) : null,
          h("div", { class: "muted small" }, "What OpenCode and Pi log at their own prices. Not added to the estimate above.")) : null, h("div", { class: "muted small" }, [U.perCommit != null ? `$${one(U.perCommit)} per commit` : null, U.unpriced ? `${int(U.unpriced)} requests had no known price and are left out` : null].filter(Boolean).join(" · ") || `pricing table ${U.pricingVersion}`)),
      panel("Tokens", null, h("div", { class: "kpi" }, compact(U.tokens)), stack, h("div", { class: "plegend" }, parts.map(([, l, c]) => h("span", {}, h("i", { style: { background: c } }), l)))),
      panel("Cache", null, h("div", { class: "kpi" }, U.cacheHitRate != null ? `${one(U.cacheHitRate * 100)}%` : "n/a", h("small", {}, "of input from cache")), h("div", { class: "muted small" }, "Cached input is billed at a fraction of fresh input. Long sessions that keep their prefix stable get the most from it."))));
    if (U.gap) el.append(h("p", { class: "note" }, U.gap));
    const W = 1100, H = 150, days = ACT.daily, dmax = Math.max(...days.map((d) => d.usd || 0), 1), bw = W / Math.max(1, days.length);
    const dsv = svgEl(W, H + 20); dsv.setAttribute("aria-label", "Cost per day");
    const every = Math.max(1, Math.ceil(days.length / 10));
    days.forEach((d, i) => { const u = d.usd || 0, bh = (u / dmax) * (H - 10); dsv.append(s("rect", { x: i * bw + Math.min(2, bw * 0.15), y: H - bh, width: Math.max(1, bw - Math.min(4, bw * 0.3)), height: Math.max(u ? 2 : 0, bh), rx: Math.min(2, bw / 4), fill: "var(--accent)" })); if (i % every === 0) dsv.append(txt(i * bw + bw / 2, H + 15, dshort(d.day))); const hit = s("rect", { class: "hit", x: i * bw, y: 0, width: bw, height: H }); bindTip(hit, `<b>${dshort(d.day)}</b> · ${usd(d.usd)}`); dsv.append(hit); });
    const models = U.models.map((m) => ({ ...m, name: prettyModel(m.model) }));
    const tbl = h("table", { class: "tbl" });
    const cols = [["name", "Model", false], ["harness", "Tool", false], ["requests", "Requests", true], ["tokens", "Tokens", true], ["output", "Output", true], ["usd", "Cost", true]];
    let sortK = "usd", sortD = -1;
    const drawTbl = () => {
      models.sort((a, b) => (typeof a[sortK] === "string" ? a[sortK].localeCompare(b[sortK]) : (a[sortK] ?? -1) - (b[sortK] ?? -1)) * sortD);
      tbl.replaceChildren(h("thead", {}, h("tr", {}, cols.map(([k, l, num]) => h("th", { class: num ? "r" : "", "aria-sort": sortK === k ? (sortD > 0 ? "ascending" : "descending") : "none" }, h("button", { type: "button", onclick: () => { sortD = sortK === k ? -sortD : -1; sortK = k; drawTbl(); } }, l + (sortK === k ? (sortD > 0 ? " ↑" : " ↓") : "")))))),
        h("tbody", {}, models.map((m) => h("tr", { class: m.unpriced ? "unpriced" : "" }, h("td", {}, m.name, m.model === "codex-auto-review" ? h("span", { class: "muted small" }, " · automatic reviewer") : null), h("td", { style: { whiteSpace: "nowrap" } }, harnessName(m.harness)), h("td", { class: "r" }, int(m.requests)), h("td", { class: "r" }, compact(m.tokens)), h("td", { class: "r" }, compact(m.output)), h("td", { class: "r" }, m.usd == null ? "unpriced" : m.unpriced ? `${usd(m.usd)} + unpriced` : usd(m.usd))))));
    };
    drawTbl();
    el.append(more("More detail: cost per day and by model", panel("Cost per day", `pricing table ${U.pricingVersion}`, dsv), panel("By model", "click a column to sort", h("div", { class: "scroll-x" }, tbl))));
  }
}

// ---- what went wrong
const prevIds = new Map(((prevRun && prevRun.findings) || []).map((f) => [f.id, f]));
// Snapshots store a repeated instruction under a hashed id (its words are private), so match that kind by kind.
const prevOf = (f) => prevIds.get(f.id) || (f.kind === "repeated_instruction" ? ((prevRun && prevRun.findings) || []).find((x) => x.kind === "repeated_instruction") : undefined);
const sinceTag = (f) => { if (!prevRun) return null; const p = prevOf(f); if (!p) return h("span", { class: "since new" }, "new since last run"); const a = p.value, b = f.metricValue; return h("span", { class: "since", title: `Flagged at your ${dshort(prevRun.day)} run too` }, a != null && b != null && a !== b ? `still open · ${one(a)} → ${one(b)}` : "still open"); };
{
  const F = VIEW.failures, FD = VIEW.findings;
  const prevRate = prevRun && prevRun.metrics.failureRate;
  const rate = F.calls ? F.total / F.calls : 0;
  const el = sub("What went wrong", F.calls ? `${int(F.total)} of ${int(F.calls)} tool calls failed (${one(rate * 100)}%)${prevRate != null ? `, ${rate <= prevRate ? "down" : "up"} from ${one(prevRate * 100)}% at your ${dshort(prevRun.day)} run` : ""}. ${FD.length ? `AI Insights found ${plural(FD.length, "pattern")} worth fixing, each with evidence you can check.` : "No recurring problems detected. That is a good sign."}` : "No tool calls recorded.");
  const SEVS = ["all", "high", "medium", "low", "info"];
  let sevF = "all", showAll = false;
  const list = h("div", {});
  const counts = Object.fromEntries(SEVS.map((sv) => [sv, sv === "all" ? FD.length : FD.filter((f) => f.severity === sv).length]));
  const showBtn = h("button", { class: "btn small", type: "button", onclick: () => { showAll = true; draw(); } });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "Filter findings by severity" }, SEVS.filter((sv) => counts[sv]).map((sv) => { const b = h("button", { class: "pchip", type: "button", "aria-pressed": String(sv === sevF) }, `${sv} ${counts[sv]}`); b.addEventListener("click", () => { sevF = sv; chips.querySelectorAll(".pchip").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); draw(); }); return b; }));
  function draw() {
    const shown = FD.filter((f) => sevF === "all" || f.severity === sevF);
    const cut = showAll ? shown : shown.slice(0, 5);
    list.replaceChildren(...cut.map((f) => {
      const box = h("div", { class: "finding", id: f.anchor });
      const body = h("div", { class: "body", id: "fb-" + f.anchor }, h("p", { class: "det", html: md(f.detail) }),
        f.evidence.length ? h("ul", { class: "ev", "aria-label": "Evidence" }, f.evidence.map((e) => h("li", {}, h("span", { class: "when" }, [e.when, e.harness].filter(Boolean).join(" · ")), h("span", { html: md(e.note) })))) : null,
        f.moreEvidence ? h("p", { class: "muted small" }, `and ${int(f.moreEvidence)} more`) : null,
        f.action ? h("a", { class: "small see", href: "#" + f.action }, "What to do about it →") : null);
      const btn = h("button", { type: "button", "aria-expanded": "false", "aria-controls": body.id }, h("span", { class: `sev ${f.severity}` }, f.severity), h("span", {}, h("span", { class: "ft", html: md(f.title) }), " ", sinceTag(f)), h("span", { class: "fm" }, f.metric ? `${f.metric.value} ${f.metric.label}` : "", h("span", { class: "chev", "aria-hidden": "true" }, "›")));
      btn.addEventListener("click", () => { const o = !box.classList.contains("open"); box.classList.toggle("open", o); btn.setAttribute("aria-expanded", String(o)); });
      box.append(btn, body);
      return box;
    }), ...(cut.length < shown.length ? [h("div", { class: "show-more" }, showBtn)] : []));
    showBtn.textContent = `Show all ${shown.length}`;
  }
  draw();
  el.append(h("div", { class: "grid g2" },
    panel("Why calls failed", plural(F.total, "failure"), hbars(F.categories.map((c) => ({ key: c.key, label: keyLabel(c.key), count: c.count, tip: `${pct(c.count / Math.max(1, F.total))} of failures` })), { empty: "No failed tool calls." })),
    RC && RC.failures.nemesis.length ? panel("Programs that failed most", "failures · share of runs", hbars(RC.failures.nemesis.map((n) => ({ key: n.key, count: n.count, runs: n.runs, tip: `${int(n.count)} of ${int(n.runs)} runs failed` })), { fmt: (r) => `${int(r.count)} · ${one((r.count / Math.max(1, r.runs)) * 100)}%` }))
      : VIEW.facets && VIEW.facets.frictions.length ? panel("Friction your agent saw", null, hbars(VIEW.facets.frictions.map((c) => ({ key: c.key, label: keyLabel(c.key), count: c.count })))) : panel("Programs that failed most", null, h("p", { class: "muted small" }, "Appears with the recap."))));
  if (FD.length) el.append(h("div", { style: { marginTop: "16px" } }, h("div", { class: "row-between" }, h("strong", {}, `${plural(FD.length, "finding")}, each with evidence you can check`), chips), list));
  const N = VIEW.narrative;
  if (N && N.frictions.length) el.append(more("More detail: friction your agent saw", h("div", { class: "cards3" }, N.frictions.map((fr) => h("div", { class: "mini" }, h("span", { class: "k" }, "friction your agent saw"), h("b", { html: md(fr.title) }), h("span", { html: md(fr.description) }), fr.examples.length ? h("ul", { class: "examples" }, fr.examples.map((x) => h("li", { html: md(x) }))) : null)))));
}

// ---- where: every harness AI Insights reads
{
  const C = VIEW.coverage, found = C.filter((c) => c.found);
  const el = sub("Where your history lives", found.length ? `AI Insights read ${listOf(found.map((c) => esc(c.label)))}${C.length > found.length ? ` and looked for ${listOf(C.filter((c) => !c.found).map((c) => esc(c.label)))}` : ""}.` : "No coding-agent history was found on this machine.");
  el.append(h("div", { class: "sources" }, C.map((c) => h("div", { class: "src" + (c.found ? "" : " off") },
    h("b", {}, c.label),
    c.found ? h("span", {}, plural(c.sessions, "session")) : h("span", { class: "muted" }, "not found"),
    c.found && c.days != null ? h("span", { class: "muted" }, `${plural(c.days, "day")} of history${c.since ? `, since ${c.since}` : ""}`) : null,
    c.disk ? h("span", { class: "muted" }, `on disk ${c.disk}`) : null,
    c.found && !c.tokens ? h("span", { class: "muted" }, "no token counts, so no cost") : null,
    c.skipped ? h("span", { class: "muted" }, `${plural(c.skipped, "unreadable line")} skipped`) : null,
    c.skippedUsage ? h("span", { class: "muted" }, `${plural(c.skippedUsage, "usage counter")} not counted (a counter reset)`) : null,
    c.note ? h("span", { class: "muted", html: md(c.note) }) : null))));
}
if (!VIEW.narrative) {
  AW.append(h("div", { class: "sub", id: "add-review" }, panel("Add your agent's read", VIEW.review.facets ? `${plural(VIEW.review.facets, "session")} judged so far` : null,
    h("p", { class: "small" }, VIEW.notes.review, " Run the analyze-ai-usage skill in your own agent: it reads redacted excerpts of recent sessions and writes back what you work on, what went well and where things go wrong. It uses your existing account; AI Insights uploads nothing."),
    snip("Prompt for your agent", VIEW.review.prompt))));
}

// ---- what to change
{
  const AC = VIEW.actions, all = [...AC.top, ...AC.rest];
  const change = h("section", { class: "block", id: "change" }, h("div", { class: "wrap" },
    h("div", { class: "sh" }, h("div", {}, h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "What to change"),
      h("h2", {}, all.length ? (all.length > 3 ? "Start with these three." : `${all.length === 1 ? "One thing" : `${all.length} things`} worth doing next.`) : "Nothing urgent to fix."),
      h("p", {}, all.length ? `${plural(all.length, "change")}, ranked from ${all.some((a) => !a.finding) ? "the findings above and your agent's review" : "the findings above"}. Copy the text straight into CLAUDE.md, AGENTS.md or your settings.` : "No suggestions this time.")),
      h("div", { class: "private", html: `${ICON.lock} Private` }))));
  root.append(change);
  const W0 = change.firstChild;
  const item = (a, i) => h("div", { class: "sugg", id: a.anchor }, h("div", { class: "rk" }, i + 1), h("div", {},
    h("h4", {}, h("span", { html: md(a.title) }), h("span", { class: "typ" }, a.typeLabel), a.findingId ? sinceTag({ id: a.findingId, kind: (VIEW.findings.find((x) => x.id === a.findingId) || {}).kind, metricValue: null }) : null),
    a.finding ? h("p", { class: "why" }, "Because: ", h("a", { href: "#" + a.finding, onclick: () => { const box = document.getElementById(a.finding); box && !box.classList.contains("open") && box.querySelector("button").click(); } }, h("span", { html: md(a.why) })), a.metric ? ` (${a.metric.value} ${a.metric.label})` : "")
      : h("p", { class: "why", html: md(a.why) }),
    h("p", { html: md(a.action) }),
    a.also.map((x) => h("p", { class: "also small", html: md(x) })),
    a.agreed ? h("p", { class: "agreed small" }, "Your agent's review suggested this too") : null,
    a.instructionText ? snip("Add to CLAUDE.md or AGENTS.md", a.instructionText) : null,
    a.snippet ? snip(a.snippet.file ? `Merge into ${a.snippet.file}` : "Settings to merge", a.snippet.text) : null,
    a.url ? h("p", { class: "learn small" }, "Learn more: ", ext(a.url, a.urlLabel, "")) : null,
    a.steps.length ? stepCards(a.steps) : null));
  W0.append(h("div", {}, AC.top.map(item)));
  if (AC.rest.length) W0.append(more(`${plural(AC.rest.length, "more idea")}`, h("div", {}, AC.rest.map((a, i) => item(a, i + AC.top.length)))));
  const hz = VIEW.narrative ? VIEW.narrative.horizon : [];
  if (hz.length) W0.append(h("h3", { class: "ph3" }, "Bigger moves"), h("div", { class: "cards3" }, hz.map((z) => h("div", { class: "mini" }, h("b", { html: md(z.title) }), h("span", { html: md(z.description) }), z.starterPrompt ? h("div", { style: { marginTop: "10px" } }, h("button", { class: "btn small", type: "button", onclick: () => copy(z.starterPrompt, "Starter prompt copied") }, h("span", { html: ICON.copy }), "Copy starter prompt")) : null))));
  // the closing pair: disk space, then long-term memory with Matrix OS
  const CL = VIEW.closing;
  const metric = (m, extra = "") => (m ? h("div", { class: "metric" }, h("b", {}, m.value), h("span", {}, m.label + extra)) : null);
  if (CL.show) W0.append(h("div", { class: "closing" + (CL.disk ? "" : " single") },
    CL.disk ? h("article", { class: "closing-card", id: "packmem" }, h("span", { class: "k" }, "Your history on disk"), metric(CL.disk.metric), h("h3", { html: md(CL.disk.title) }), h("p", { html: md(CL.disk.action) }), CL.disk.url ? ext(CL.disk.url, CL.disk.urlLabel, "btn small") : null) : null,
    h("article", { class: "closing-card matrix", id: "matrix" }, h("span", { class: "k" }, "Long-term memory"), metric(CL.matrix.metric, CL.matrix.since ? `, back to ${CL.matrix.since}` : ""),
      h("h3", {}, "Store your conversations long term"),
      h("p", {}, "Your agents only remember about 30 days: local tools like Claude Code delete old transcripts after that by default, so the oldest part of this story disappears every month. Matrix OS keeps all of it and builds memory on top, so your agents recall past decisions and your next look back covers years, not weeks."),
      h("a", { class: "btn primary small", href: CL.matrix.url, rel: "noopener noreferrer" }, "Keep your history with Matrix OS ", h("span", { "aria-hidden": "true" }, "→")))));
}

// ================================================================== keep your history
function stepCards(steps) {
  return h("div", { class: "steps" }, steps.map((st, i) => h("div", { class: "step" },
    h("span", { class: "k" }, `Option ${i + 1}`), h("b", { html: md(st.title) }), st.body ? h("p", { class: "small", html: md(st.body) }) : null,
    st.copy ? snip(st.copyLabel || "Copy", st.copy) : null,
    st.undo ? h("p", { class: "muted small" }, "To undo: ", h("span", { html: md(st.undo) })) : null,
    st.url ? ext(st.url, st.urlLabel, "btn small") : null)));
}
if (VIEW.retention) {
  const R0 = VIEW.retention;
  const eyebrow = R0.urgent ? "Keep your history · this week" : "Keep your history";
  const cell = (v, cls) => h("td", cls ? { class: cls } : {}, v == null || v === "" ? "–" : v);
  const table = R0.rows.length ? h("div", { class: "keep-tbl" }, h("table", { class: "tbl" },
    h("thead", {}, h("tr", {}, ["Tool", "Keeps transcripts", "Set by", "On disk", "Oldest on disk", "Can go soon", "Only in AI Insights"].map((t) => h("th", {}, t)))),
    h("tbody", {}, R0.rows.map((r) => h("tr", { class: r.atRisk ? "risk" : "" },
      cell(h("b", {}, r.label)), cell(r.keeps), cell(r.source), cell(r.disk ? `${r.disk} · ${plural(r.transcripts, "transcript")}` : plural(r.transcripts, "transcript")), cell(r.oldest),
      cell(r.atRisk ? h("span", { class: "risk-t" }, r.atRisk) : null), cell(r.cacheOnly ? plural(r.cacheOnly, "session") : null)))))) : null;
  const notes = R0.rows.filter((r) => r.exempt).map((r) => h("p", { class: "muted small" }, `${r.label}: ${r.exempt}`));
  const how = R0.rows.length ? more("How each tool decides", h("div", { class: "cards3" }, R0.rows.map((r) => h("div", { class: "mini" }, h("b", {}, r.label), h("span", { html: md(r.basis) }),
    r.setting ? h("p", { class: "muted small mono" }, r.setting) : null, r.url ? h("p", { class: "small" }, ext(r.url, r.urlLabel, "")) : null)))) : null;
  const cache = R0.cache && (R0.cache.keeps.length || R0.cache.drops.length) ? h("div", { class: "keep-cache" },
    h("div", {}, h("span", { class: "k" }, "AI Insights' cache keeps"), h("ul", {}, R0.cache.keeps.map((x) => h("li", {}, x)))),
    h("div", {}, h("span", { class: "k" }, "It does not keep"), h("ul", {}, R0.cache.drops.map((x) => h("li", {}, x))))) : null;
  const block = h("div", { class: "keep" + (R0.urgent ? " urgent" : ""), id: "keep-history" },
    h("div", { class: "eyebrow" }, h("span", { class: "dot" }), eyebrow),
    h("h3", { class: "ph3" }, R0.title),
    h("p", { html: md(R0.sentence) }),
    R0.disk ? h("p", { class: "small" }, h("b", {}, R0.disk.value), ` ${R0.disk.label}.`) : null,
    table, ...notes, cache,
    R0.steps.length ? stepCards(R0.steps) : null,
    how);
  const change = document.getElementById("change").firstChild;
  // Can go this week: first thing under "What to change". Otherwise after the ranked changes.
  if (R0.urgent) change.insertBefore(block, change.children[1]); else change.append(block);
}

// ================================================================== OVER TIME
{
  const sec = h("section", { class: "block", id: "time" }, h("div", { class: "wrap" }));
  root.append(sec);
  const W0 = sec.firstChild;
  W0.append(h("div", { class: "sh" }, h("div", {}, h("div", { class: "eyebrow" }, h("span", { class: "dot" }), "Over time"), h("h2", {}, RUNS.length > 1 ? "Since your last run." : "Your first run."), h("p", {}, RUNS.length > 1 ? "Each run saves a small snapshot of its numbers and findings. Pick an earlier run to compare with today." : VIEW.notes.runs)), h("div", { class: "private", html: `${ICON.lock} Private` })));
  if (VIEW.retention && VIEW.retention.limit) W0.append(h("p", { class: "note" }, VIEW.retention.limit, " ", h("a", { href: "#keep-history" }, "Keep your history →")));
  if (RUNS.length > 1) {
    let base = RUNS.length - 2;
    const runsEl = h("div", { class: "runs", role: "radiogroup", "aria-label": "Compare with run" });
    const body = h("div", {});
    W0.append(runsEl, body);
    const metricKeys = ["wallHours", "sessions", "prompts", "usd", "failureRate", "testPass", "cacheHitRate", "compactionsPerSession", "maxParallel", "winRate"];
    const FRAME = {
      failureRate: "Lower is better: fewer wasted tool calls.",
      testPass: "Higher is better, though a failing test that catches a bug is doing its job.",
      cacheHitRate: "Higher keeps cost down.",
      compactionsPerSession: "Lower usually means tasks fit their context.",
      winRate: "From your agent's judgement of each session; small samples swing.",
      usd: "More spend is not worse on its own; compare with what shipped.",
      wallHours: "More is not better or worse: it is how much you used agents.",
      sessions: "Neutral: more, shorter sessions are often healthier.",
      prompts: "Neutral.",
      maxParallel: "Neutral: a measure of style, not quality.",
    };
    const draw = () => {
      runsEl.replaceChildren(...RUNS.map((r, i) => { const isCur = i === RUNS.length - 1; const b = h("button", { class: "run" + (isCur ? " cur" : "") + (i === base ? " base" : ""), type: "button", role: "radio", "aria-checked": String(i === base), "aria-disabled": String(isCur), title: isCur ? "This run" : "Compare with this run" }, h("span", { class: "pt" }), h("span", { class: "d" }, dshort(r.day)), h("span", { class: "s" }, isCur ? "today" : r.days ? `${plural(r.days, "day")} of history` : "")); if (!isCur) b.addEventListener("click", () => { base = i; draw(); }); return b; }));
      const B = RUNS[base], C = cur;
      const keys = metricKeys.filter((k) => B.metrics[k] != null || C.metrics[k] != null);
      const tbl = h("table", { class: "tbl dtable" }, h("thead", {}, h("tr", {}, h("th", {}, "Metric"), h("th", { class: "r" }, dshort(B.day)), h("th", { class: "r" }, "Today"), h("th", {}, "Change"), h("th", {}, "How to read it"))),
        h("tbody", {}, keys.map((k) => h("tr", {}, h("td", {}, METRICS[k].label), h("td", { class: "r" }, fmtM(k, B.metrics[k])), h("td", { class: "r" }, fmtM(k, C.metrics[k])), h("td", {}, delta(k, C.metrics[k], B.metrics[k], true)), h("td", { class: "frame" }, FRAME[k] || "")))));
      const sparkKeys = ["failureRate", "testPass", "compactionsPerSession", "cacheHitRate", "usd", "prompts"].filter((k) => RUNS.filter((r) => r.metrics[k] != null).length >= 2);
      const sparks = h("div", { class: "spark" }, sparkKeys.map((k) => {
        const vals = RUNS.map((r) => (r.metrics[k] == null ? null : r.metrics[k])), ok = vals.filter((v) => v != null), mn = Math.min(...ok), mx = Math.max(...ok);
        const W = 220, H = 64, x = (i) => 8 + (i / Math.max(1, RUNS.length - 1)) * (W - 16), y = (v) => H - 8 - ((v - mn) / (mx - mn || 1)) * (H - 20);
        const sv = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${METRICS[k].label} across runs` });
        sv.append(s("path", { d: vals.map((v, i) => (v == null ? "" : `${i && vals[i - 1] != null ? "L" : "M"}${x(i)},${y(v)}`)).join(""), fill: "none", stroke: "var(--ink)", "stroke-width": 2 }));
        vals.forEach((v, i) => { if (v == null) return; const c = s("circle", { cx: x(i), cy: y(v), r: i === base || i === RUNS.length - 1 ? 5 : 3.5, fill: i === RUNS.length - 1 ? "var(--ink)" : i === base ? "var(--hl)" : "var(--surface)", stroke: "var(--ink)", "stroke-width": 1.5 }); bindTip(c, `<b>${dshort(RUNS[i].day)}</b> · ${fmtM(k, v)}`); sv.append(c); });
        return h("div", { class: "panel" }, h("h4", {}, h("span", {}, METRICS[k].label)), h("div", { class: "kpi" }, fmtM(k, C.metrics[k])), delta(k, C.metrics[k], B.metrics[k], true), sv);
      }));
      const bIds = new Map(B.findings.map((f) => [f.id, f])), cIds = new Map(C.findings.map((f) => [f.id, f]));
      const resolved = B.findings.filter((f) => !cIds.has(f.id)), open = C.findings.filter((f) => bIds.has(f.id)), fresh = C.findings.filter((f) => !bIds.has(f.id));
      const it = (f, other) => h("div", { class: "it" }, h("span", { html: md(f.title) }), h("span", { class: "m" }, f.value != null ? (other && other.value != null ? `${one(other.value)} → ${one(f.value)} ${f.unit}` : `${one(f.value)} ${f.unit}`) : ""));
      const col = (title, sub2, arr, fn) => h("div", { class: "col" }, h("h4", { class: "panel-h" }, `${title} · ${arr.length}`), h("div", { class: "muted small" }, sub2), arr.length ? arr.map(fn) : h("div", { class: "it muted" }, "None"));
      body.replaceChildren(
        h("div", { class: "panel scroll-x" }, tbl),
        sparkKeys.length ? h("h3", { class: "ph3" }, "Trends across runs") : null, sparkKeys.length ? sparks : null,
        h("h3", { class: "ph3" }, `Findings since ${dshort(B.day)}`),
        h("div", { class: "diff" },
          col("Looks resolved", "Flagged then, not detected now. Not proof of a fix: check it stays gone.", resolved, (f) => it(f)),
          col("Still open", "Flagged both times, with the number then and now.", open, (f) => it(f, bIds.get(f.id))),
          col("New", "Not flagged then.", fresh, (f) => it(f))));
    };
    draw();
  }
}

root.append(h("footer", { class: "foot" }, h("div", { class: "wrap" },
  h("div", { class: "foot-brand" }, rabbitSvg("currentColor", "22px"), h("b", {}, "AI Insights"), h("span", { class: "muted" }, "by Matrix OS")),
  h("p", {}, `Made on this machine from ${plural(HERO.sessions, "session")}${HERO.harnesses.length ? ` in ${listOf(HERO.harnesses)}` : ""}${VIEW.generatedLabel ? `, ${VIEW.generatedLabel}` : ""}. Days and hours are in ${TZ}. Nothing here was uploaded, and the page loads nothing from the network.${USE.usd != null ? ` Costs use API list prices (${USE.pricingVersion}).` : ""}`))));
document.body.append(theater, tip, toast);

const navLinks = [...document.querySelectorAll("[data-nav]")];
if (window.IntersectionObserver) {
  const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) navLinks.forEach((a) => a.classList.toggle("on", a.dataset.nav === e.target.id)); }), { rootMargin: "-40% 0px -55% 0px" });
  NAV.forEach(([id]) => { const el = document.getElementById(id); el && io.observe(el); });
}

function switchStyle(id) {
  if (!styleOk(id) || id === S.style) { refreshStudio(); return Promise.resolve(); }
  return fontsReady(id).then(() => { S.style = id; saveStudio(); buildWall(); refreshStudio(); heroPlayer.reload(true); });
}
window.addEventListener("resize", () => { heroPlayer.size(); thPlayer.size(); });

function spanTxt(a, b) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${f.format(a)} to ${f.format(b)}`;
}

// ---------- boot
fontsReady(S.style).then(async () => {
  if (RC) {
    buildWall(); refreshStudio();
    heroPlayer.reload();
    if (!reduced) heroPlayer.setPlaying(true); else if (heroPlayer.inst) { heroPlayer.t = heroPlayer.inst.dur; heroPlayer.draw(); }
    requestAnimationFrame(loop);
    const sup = await Exporter.support();
    if (!sup.ok) { bVideo.title = sup.why; showCli(sup.why + " Run this instead:"); }
  }
  document.documentElement.dataset.ready = "1";
});

// ---------- automation API: deterministic hooks for tests and headless rendering
window.recap = {
  ready: () => document.documentElement.dataset.ready === "1",
  styles: () => STYLES.map(({ id, name }) => ({ id, name })),
  cards: () => ALL_IDS.filter((id) => hasCard(id)),
  state: () => ({ style: S.style, ratio: S.ratio, pace: S.pace, mark: S.mark, order: [...S.order], selected: seqIds(), totalMs: seqIds().reduce((a, id) => a + durOf(id), 0) }),
  setStyle: switchStyle, setRatio,
  setPace: (p) => { S.pace = p === "quick" ? "quick" : "full"; refreshStudio(); },
  setMark: (on) => { S.mark = !!on; markBox.checked = S.mark; buildWall(); refreshStudio(); },
  select: (ids) => { S.sel = new Set(ids.filter((id) => ALL_IDS.includes(id))); refreshStudio(); },
  toggle: (id) => tiles.get(id).toggle.click(),
  move, placeNear, durOf,
  /** The card's markup at time t: the same input always gives the same string. */
  frame: (id, t, ratio = S.ratio, style = S.style) => { const inst = makeInst(id, ratio, style); render(inst, t); const out = inst.el.outerHTML; inst.el.remove(); return out; },
  seek: (i, ms) => { heroPlayer.setPlaying(false); heroPlayer.mount(i, ms); },
  audit: (style = S.style, ratio = S.ratio) => { const out = {}; for (const id of ALL_IDS.filter((cid) => hasCard(cid, style))) { const inst = makeInst(id, ratio, style); render(inst, inst.dur); const iss = CardKit.audit(inst); if (iss.length) out[id] = iss; inst.el.remove(); } return out; },
  caption, share: SHARE, intents: (text = caption()) => ({ x: INTENT.x(text), linkedin: INTENT.linkedin(text) }),
  support: () => Exporter.support(),
  png: async (id, ms, ratio = S.ratio, style = S.style) => { const inst = makeInst(id, ratio, style); const b = await Exporter.png(inst, ms); inst.el.remove(); const u8 = new Uint8Array(await b.arrayBuffer()); let s2 = ""; for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s2); },
};
})();
