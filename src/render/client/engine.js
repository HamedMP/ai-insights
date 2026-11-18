/* engine.js: utilities, the deterministic timeline, CardKit (the layout kernel) and the card style registry.
   Contract with the page:  CardKit.make(spec, W, H, styleId, host, { mark }) -> { id, title, dur, el, tl }
   and render(inst, t) draws the frame at t ms. Every frame is a pure function of (data, spec, W, H, t).
   The style contract is docs/card-styles.md. */
"use strict";
const SVGNS = "http://www.w3.org/2000/svg";
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, p) => a + (b - a) * p;
const E = {
  lin: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  out5: (t) => 1 - Math.pow(1 - t, 5),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(t * 10.5)),
};
const int = (n) => Math.round(n).toLocaleString("en-US");
const one = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
const pct = (x) => `${Math.round(x * 100)}%`;
function compact(n) {
  if (n >= 1e9) return `${one(n / 1e9)}B`;
  if (n >= 1e6) return `${one(n / 1e6)}M`;
  if (n >= 1e4) return `${one(n / 1e3)}K`;
  return int(n);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dshort = (day) => { const [, m, d] = day.split("-"); return `${MON[+m - 1]} ${+d}`; };
const DAYNAME = { Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays" };
const hh = (x) => `${String(x).padStart(2, "0")}:00`;
/** Counts that can run into the hundreds of thousands: past `cap`, say "10,000+" instead of a wall of digits. */
const capped = (n, cap = 10000) => (n > cap ? `${int(cap)}+` : int(n));
const HARNESS_NAMES = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", pi: "Pi", opencode: "OpenCode", gemini: "Gemini CLI", "claude-chat": "Claude chat", chatgpt: "ChatGPT" };
const harnessName = (key) => HARNESS_NAMES[key] || String(key);
function rng(seed) { let q = seed >>> 0 || 1; return () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296); }

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "object") for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}
function smooth(pts, closed = false, tension = 1) {
  const n = pts.length;
  if (n < 2) return "";
  const P = (i) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return closed ? d + "Z" : d;
}
function rabbitSvg(fill = "currentColor", hgt = "1em") {
  const el = s("svg", { viewBox: "0 0 510 660", fill, "aria-hidden": "true", style: `height:${hgt};width:auto` });
  for (const d of RABBIT_PATHS) el.append(s("path", { d }));
  return el;
}

/** Best square-cell grid for n cells inside w x h. */
function cellGrid(n, w, hgt, g = 0.14, fixedCols) {
  let best = null;
  for (let cols = fixedCols || 1; cols <= (fixedCols || Math.max(1, n)); cols++) {
    const rows = Math.ceil(n / cols);
    const size = Math.min(w / (cols + (cols - 1) * g), hgt / (rows + (rows - 1) * g));
    if (!best || size > best.size) best = { cols, rows, size };
  }
  best.gap = best.size * g;
  return best;
}

// ------------------------------------------------------------------ timeline
function timeline() {
  const items = [], idles = [];
  const api = {
    items, idles,
    at(start, dur, ease, fn) { items.push({ start, dur, ease: E[ease] || ease || E.out, fn }); return api; },
    idle(fn) { idles.push(fn); return api; },
    in(el, start, o = {}) {
      const { dur = 700, y = 70, x = 0, sc = 1, rot = 0, ease = "out5" } = o;
      return api.at(start, dur, ease, (p) => {
        el.style.opacity = clamp(p * 1.6);
        el.style.transform = `translate(${(1 - p) * x}px, ${(1 - p) * y}px) scale(${lerp(sc, 1, p)}) rotate(${(1 - p) * rot}deg)`;
      });
    },
    pop(el, start, o = {}) { return api.in(el, start, { y: 0, sc: 0.4, dur: 800, ease: "spring", ...o }); },
    count(el, start, dur, to, fmt = int, from = 0) { el.textContent = fmt(to); return api.at(start, dur, "out", (p) => { el.textContent = fmt(lerp(from, to, p)); }); },
    draw(path, start, dur = 1200, ease = "inOut") {
      path.setAttribute("pathLength", "1");
      path.style.strokeDasharray = "1 1";
      return api.at(start, dur, ease, (p) => { path.style.strokeDashoffset = String(1 - p); });
    },
    grow(el, start, o = {}) {
      const { dur = 900, axis = "Y", origin = "50% 100%", ease = "out5" } = o;
      el.style.transformOrigin = origin;
      el.style.transformBox = "fill-box";
      return api.at(start, dur, ease, (p) => { el.style.transform = `scale${axis}(${Math.max(0.0001, p)})`; });
    },
    stagger(els, start, gap, fn) { els.forEach((el, i) => fn(el, start + i * gap, i)); return api; },
  };
  return api;
}
function render(inst, t) {
  for (const it of inst.tl.items) it.fn(it.ease(clamp((t - it.start) / it.dur)), t);
  for (const fn of inst.tl.idles) fn(t);
}

// single-line text that must fit its width: data-fit = max px, data-min = min px (absolute, already scaled)
function fitAll(root) {
  root.querySelectorAll("[data-fit]").forEach((el) => {
    const max = +el.dataset.fit, min = +(el.dataset.min || max * 0.4);
    let size = max;
    el.style.fontSize = size + "px";
    const box = el.clientWidth || el.parentElement.clientWidth;
    let guard = 60;
    while (el.scrollWidth > box + 1 && size > min && guard--) { size = Math.max(min, size * 0.94); el.style.fontSize = size + "px"; }
  });
}

/**
 * Layout measures text, so every face must be loaded first, not just "whatever is loading now". With a style id,
 * that style's own fonts too (they are added to the card CSS the first time the style is used).
 */
function fontsReady(style) {
  if (!document.fonts) return Promise.resolve();
  const extra = style ? CardStyles.fontsOf(style) : [];
  return Promise.all(["800 100px Brico", "700 100px Brico", "500 40px GeistR", "750 40px GeistR", "600 30px GeistM", "700 30px GeistM", ...extra].map((f) => document.fonts.load(f))).then(() => document.fonts.ready);
}

// ------------------------------------------------------------------ CardKit: the layout kernel
const RATIOS = { "1:1": [1080, 1080], "9:16": [1080, 1920], "4:5": [1080, 1350], "16:9": [1920, 1080] };
const KS = [1, 0.93, 0.86, 0.8, 0.74, 0.68, 0.62, 0.57, 0.52, 0.48];

const CardKit = (() => {
  // Hook for a future watermark/overlay on every exported frame. Returns nothing today.
  function frameOverlay(/* inst, t */) { return null; }

  /** opts.mark: draw the maker's mark footer (default true). The outro card is the mark itself and ignores it. */
  function make(spec, W, H, style, host, opts = {}) {
    for (let i = 0; i < KS.length; i++) {
      const res = attempt(spec, W, H, style, host, KS[i], i === KS.length - 1, opts.mark !== false);
      if (res.ok) return res.inst;
      res.inst.el.remove();
    }
  }

  function attempt(spec, W, H, style, host, k, final, mark) {
    const r = W / H, u = Math.min(W, H) / 1080;
    const wide = r > 1.2, square = !wide && r > 0.95, tall = r < 0.95;
    const mode = wide || (square && spec.squareSide) ? "side" : "stack";
    const noFoot = spec.noFoot || !mark;
    const el = h("div", { class: "card", "data-card": spec.id, "data-style": style, style: { width: W + "px", height: H + "px", "--bg": spec.bg, "--fg": spec.fg, "--k": k } });
    const art = s("svg", { class: "art", width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    el.append(art);
    host.append(el);
    const tl = timeline();
    const P = Math.round(84 * u);
    const ctx = { W, H, k, u, r, wide, square, tall, mode, tl, el, art, P, style, final };
    const ins = spec.insets ? spec.insets(ctx) : { top: 0, bottom: 0 };
    const footH = noFoot ? 0 : Math.round((spec.bigMark ? 70 : 46) * u);
    const G = Math.round(52 * u * Math.max(0.7, k));
    const box = { x: P, y: P + ins.top, w: W - 2 * P, h: H - 2 * P - ins.top - ins.bottom - (footH ? footH + G * 0.8 : 0) };
    ctx.box = box; ctx.G = G;
    const parts = spec.build(ctx);
    const place = (node, x, y, w, hgt) => { node.classList.add("blk"); Object.assign(node.style, { left: x + "px", top: y + "px", width: w + "px" }); if (hgt != null) node.style.height = hgt + "px"; el.append(node); return node; };

    let ok = true, abox = null;
    const head = h("div", {}, parts.head), extra = parts.extra ? h("div", {}, parts.extra) : null;
    if (mode === "stack") {
      place(head, box.x, 0, box.w);
      if (extra) place(extra, box.x, 0, box.w);
      fitAll(el);
      const hh_ = head.offsetHeight, eh = extra ? extra.offsetHeight : 0;
      const used = hh_ + (extra ? eh + G : 0);
      if (parts.art) {
        const ah = box.h - used - G;
        const need = (parts.artMin ?? 0.3) * box.h;
        if (ah < need) ok = false;
        const ay = parts.artFirst ? box.y : box.y + hh_ + G;
        head.style.top = (parts.artFirst ? box.y + ah + G : box.y) + "px";
        abox = { x: box.x, y: ay, w: box.w, h: Math.max(ah, 10) };
      } else {
        if (used > box.h) ok = false;
        head.style.top = box.y + (parts.center ? Math.max(0, (box.h - used) / 2) : 0) + "px";
      }
      if (extra) extra.style.top = box.y + box.h - eh + "px";
    } else {
      const split = parts.split ?? 0.5;
      const tw = Math.round(parts.art ? box.w * split - G / 2 : box.w);
      const aw = box.w - tw - G;
      const tx = parts.art && parts.artFirst ? box.x + aw + G : box.x;
      place(head, tx, 0, tw);
      if (extra) place(extra, tx, 0, tw);
      fitAll(el);
      const hh_ = head.offsetHeight, eh = extra ? extra.offsetHeight : 0;
      const used = hh_ + (extra ? eh + G : 0);
      if (used > box.h) ok = false;
      if (extra) { head.style.top = box.y + "px"; extra.style.top = box.y + box.h - eh + "px"; }
      else head.style.top = box.y + Math.max(0, (box.h - hh_) / 2) * (parts.center === false ? 0 : 1) + "px";
      if (parts.art) abox = { x: parts.artFirst ? box.x : box.x + tw + G, y: box.y, w: aw, h: box.h };
    }
    if (!ok && !final) return { ok, inst: { el } };
    if (abox) {
      const node = parts.art(abox.w, abox.h, abox.x, abox.y);
      if (node) {
        if (node instanceof SVGElement) { node.setAttribute("width", abox.w); node.setAttribute("height", abox.h); place(node, abox.x, abox.y, abox.w, abox.h); }
        else {
          const wrap = place(h("div", {}, node), abox.x, abox.y, abox.w, abox.h);
          fitAll(wrap);
          fitInto(node, abox.w, abox.h, parts.artAlign || "center", parts.artGrow || 1);
        }
      }
    }
    if (parts.post) parts.post((n) => rectIn(n, el));
    if (!noFoot) {
      const f = foot(ctx, spec, parts.legend, ins, footH);
      el.append(f);
      tl.in(f, 900, { y: 24, dur: 600 });
    }
    return { ok: true, inst: { id: spec.id, title: spec.title, dur: spec.dur, el, tl, k, W, H, spec } };
  }

  /** Scale a DOM block down (never up) so its natural size fits w x h. Wraps it so entrance transforms stay free. */
  function fitInto(node, w, hgt, align, grow = 1) {
    node.style.transformOrigin = align === "start" ? "0 0" : "50% 0";
    const nw = node.scrollWidth, nh = node.scrollHeight;
    const sc = Math.min(grow, w / Math.max(1, nw), hgt / Math.max(1, nh));
    const wrap = node.parentElement;
    wrap.style.display = "flex"; wrap.style.flexDirection = "column";
    wrap.style.alignItems = align === "start" ? "flex-start" : "center";
    wrap.style.justifyContent = align === "start" ? "flex-start" : "center";
    if (Math.abs(sc - 1) > 0.005) { node.style.zoom = String(sc); }
    node.dataset.fitScale = sc.toFixed(3);
  }
  function rectIn(n, root) {
    const a = n.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
  }
  function foot(ctx, spec, legend, ins, footH) {
    const { W, H, P, u } = ctx;
    const size = (spec.bigMark ? 50 : 34) * u;
    const f = h("div", { class: "foot", style: { left: P + "px", right: P + "px", bottom: Math.round(P * 0.82 + (ins.bottom || 0)) + "px", height: footH + "px", fontSize: Math.round(25 * u) + "px" } },
      h("span", { class: "mark", style: { fontSize: size + "px" } }, rabbitSvg("currentColor"), h("span", {}, "AI Insights"), h("span", { class: "by", style: { fontSize: "0.62em" } }, "by Matrix OS")),
      legend ? h("span", { class: "legend" }, legend) : null);
    return f;
  }
  /** Everything visible must sit inside the card and no single-line text may be cut. Run at the final frame. */
  function audit(inst) {
    const root = inst.el, rb = root.getBoundingClientRect(), sx = rb.width / inst.W, issues = [];
    root.querySelectorAll("*").forEach((n) => {
      if (n.closest("svg") && n.tagName.toLowerCase() !== "svg") return;
      if (n.tagName.toLowerCase() === "svg" && n.classList.contains("art")) return;
      const hasText = [...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
      if (!hasText && n.tagName.toLowerCase() !== "svg") return;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const out = (rb.left - r.left) / sx > 1.5 || (r.right - rb.right) / sx > 1.5 || (rb.top - r.top) / sx > 1.5 || (r.bottom - rb.bottom) / sx > 1.5;
      if (out) issues.push(`outside: <${n.tagName.toLowerCase()}> "${(n.textContent || "").trim().slice(0, 30)}"`);
      if (hasText && n.scrollWidth > n.clientWidth + 2 && getComputedStyle(n).display !== "inline") issues.push(`overflows its box: "${n.textContent.trim().slice(0, 30)}"`);
    });
    root.querySelectorAll("[data-fit]").forEach((n) => { if (n.scrollWidth > n.clientWidth + 2) issues.push(`unfit: "${n.textContent.trim().slice(0, 30)}"`); });
    root.querySelectorAll(":scope > .blk").forEach((b) => {
      const br = b.getBoundingClientRect();
      b.querySelectorAll("*").forEach((n) => {
        if (n.closest("svg")) return;
        if (![...n.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) return;
        const r = n.getBoundingClientRect();
        if ((r.right - br.right) / sx > 3 || (br.left - r.left) / sx > 3) issues.push(`spills column: "${n.textContent.trim().slice(0, 24)}"`);
      });
    });
    // text overlapping other text blocks
    const blocks = [...root.querySelectorAll(":scope > .blk, :scope > .foot")].map((b) => ({ b, r: b.getBoundingClientRect() }));
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i].r, c = blocks[j].r;
      const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left), oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
      if (ox > 4 && oy > 4) issues.push(`overlap: block ${i} x ${j} (${Math.round(oy / sx)}px)`);
    }
    return issues;
  }
  return { make, frameOverlay, audit, RATIOS };
})();

// ------------------------------------------------------------------ share config
/**
 * Everything a card or caption says to invite people to make their own, in one place: the launch hashtag and
 * pitch line can change here without touching a card. Cards read it as kit.share.
 */
const SHARE = Object.freeze({
  hashtag: "#MyAIInsights",
  pitch: "Made with AI Insights by Matrix OS",
  command: "npx ai-insights@latest",
  skill: "/analyze-ai-usage",
  site: "ai-insights.app",
  siteUrl: "https://ai-insights.app/",
});

// ------------------------------------------------------------------ style registry
const CARD_IDS = ["intro", "hours", "clock", "weekday", "streak", "words", "manners", "slash", "shell", "tests", "danger",
  "parallel", "marathon", "failures", "nemesis", "model", "tokens", "persona", "tips", "summary", "outro"];
/** Cards a style may leave out: the page offers them only in styles that have them. */
const OPTIONAL_CARD_IDS = ["thinking", "approvals", "history", "titles"];
const KIT = { h, s, clamp, lerp, E, int, one, pct, compact, capped, dshort, hh, DAYNAME, rng, smooth, rabbitSvg, cellGrid, harnessName, fitAll, share: SHARE };
/**
 * Styles register themselves from their own script. specs() runs lazily, once, with the recap data, so a style
 * that throws only loses itself: the page falls back to the default style and says so in the console.
 */
const CardStyles = (() => {
  const defs = [], built = new Map();
  let data = null;
  function register(def) {
    const ok = def && /^[a-z0-9-]{1,24}$/.test(def.id) && typeof def.name === "string" && typeof def.specs === "function";
    if (!ok) { console.error("registerCardStyle: ignored a style without id, name and specs()", def && def.id); return; }
    if (defs.some((d) => d.id === def.id)) { console.error(`registerCardStyle: duplicate style ${def.id}`); return; }
    defs.push({ id: def.id, name: def.name.slice(0, 20), swatch: def.swatch || "var(--ink)", specs: def.specs, fonts: Array.isArray(def.fonts) ? def.fonts.filter((f) => typeof f === "string").slice(0, 8) : [] });
  }
  function specs(id) {
    if (built.has(id)) return built.get(id);
    const def = defs.find((d) => d.id === id);
    let out = null;
    if (def && data) {
      try {
        const list = def.specs(data, KIT);
        const byId = new Map((Array.isArray(list) ? list : []).map((sp) => [sp && sp.id, sp]));
        const missing = CARD_IDS.filter((cid) => !byId.has(cid) || typeof byId.get(cid).build !== "function");
        if (missing.length) console.error(`card style ${id} is missing cards: ${missing.join(", ")}`);
        else out = Object.fromEntries([...CARD_IDS, ...OPTIONAL_CARD_IDS.filter((cid) => byId.has(cid) && typeof byId.get(cid).build === "function")].map((cid) => [cid, byId.get(cid)]));
      } catch (err) { console.error(`card style ${id} failed to build`, err); }
    }
    built.set(id, out);
    return out;
  }
  /** Add the style's own @font-face rules to the card CSS once, and say which faces to wait for. */
  const injected = new Set();
  function fontsOf(id) {
    const def = defs.find((d) => d.id === id);
    if (!def || !def.fonts.length) return [];
    if (!injected.has(id) && typeof document !== "undefined") {
      injected.add(id);
      const src = document.getElementById(`style-fonts-${id}`), css = document.getElementById("card-css");
      if (src && css) css.textContent += "\n" + src.textContent;
    }
    return def.fonts;
  }
  return {
    register, specs, fontsOf,
    setData(d) { data = d; built.clear(); },
    list: () => defs.map(({ id, name, swatch }) => ({ id, name, swatch, ok: !!specs(id) })),
    has: (id) => !!specs(id),
  };
})();
function registerCardStyle(def) { CardStyles.register(def); }
