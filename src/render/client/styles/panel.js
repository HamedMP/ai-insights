/* panel.js: the "Instrument panel" card style. An engineer's logbook: grid paper, ink, one accent colour per
   chapter, thin-line plotter graphics, registration marks, a title block on every sheet (CardKit's foot, restyled
   in panel.css), big numbers in a condensed face and small handwritten annotations.
   Text floor: nothing under 22 px on a 1080 px card; decoration is dropped before information shrinks. */
registerCardStyle({
  id: "panel",
  name: "Instrument panel",
  swatch: "linear-gradient(135deg,#f3f0e6 0 55%,#2848c8 55% 70%,#cc2f22 70% 85%,#1b1d22 85%)",
  fonts: ["800 100px PanelCond", "700 40px PanelHand"],
  specs(D, kit) {
    const { h, s, clamp, lerp, E, int, one, pct, compact, capped, dshort, hh, DAYNAME, rng, smooth, rabbitSvg, harnessName } = kit;
    const SHARE = kit.share;
    const T = D.totals, R = D.rhythm, V = D.voice, U = D.usage || {}, SH = D.shell || {};
    const YEAR = D.range.to.slice(0, 4);
    const rangeLabel = kit.dateRangeLabel(D.range.from, D.range.to);
    const activeDay = (d) => d.prompts > 0 || d.minutes > 0;
    const priced = U.priced !== false && U.usd != null;
    const MIN = 22; // px floor for any text at u = 1

    // ------------------------------------------------------------ type + measuring
    const F = { cond: "PanelCond, 'Arial Narrow', sans-serif", mono: "GeistM, ui-monospace, monospace", text: "GeistR, Helvetica, sans-serif", hand: "PanelHand, cursive" };
    const WT = { cond: 800, mono: 600, text: 500, hand: 700 };
    const MC = document.createElement("canvas").getContext("2d");
    const tw = (str, f, size, ls = 0, w) => { MC.font = `${w || WT[f]} ${size}px ${F[f]}`; return MC.measureText(String(str)).width + ls * size * String(str).length; };
    /** Largest size <= max at which str fits width. */
    const fitPx = (str, f, max, width, ls = 0, w) => Math.min(max, (max * width) / Math.max(1, tw(str, f, max, ls, w)));

    const CH = {
      rhythm: { n: 1, name: "Rhythm", col: "var(--c-rhythm)" },
      voice: { n: 2, name: "Voice", col: "var(--c-voice)" },
      work: { n: 3, name: "Work", col: "var(--c-work)" },
      friction: { n: 4, name: "Friction", col: "var(--c-friction)" },
      findings: { n: 5, name: "Findings", col: "var(--ink)" },
    };
    const ORDER = ["intro", "hours", "clock", "weekday", "streak", "words", "manners", "slash", "shell", "tests", "danger", "parallel", "marathon", "failures", "nemesis", "model", "tokens", "persona", "tips", "summary", "outro", "thinking", "approvals", "history"];

    // ------------------------------------------------------------ svg helpers
    function tx(c, x, y, str, o = {}) {
      const f = o.f || "mono", size = Math.max(MIN * c.u, o.size || 24 * c.u);
      return s("text", { x: +x.toFixed(1), y: +y.toFixed(1), "text-anchor": o.a || "start", "font-family": F[f], "font-weight": o.w || WT[f], "font-size": size.toFixed(1),
        "letter-spacing": o.ls ? `${o.ls}em` : null, fill: o.fill || "var(--ink)", opacity: o.op ?? null,
        ...(o.halo ? { stroke: "var(--paper)", "stroke-width": (7 * c.u).toFixed(1), "stroke-linejoin": "round", "paint-order": "stroke" } : {}) }, document.createTextNode(String(str)));
    }
    const ln = (x1, y1, x2, y2, o = {}) => s("line", { x1: +x1.toFixed(1), y1: +y1.toFixed(1), x2: +x2.toFixed(1), y2: +y2.toFixed(1), stroke: o.stroke || "var(--ink)", "stroke-width": o.w || 2, "stroke-dasharray": o.dash || null, "stroke-linecap": o.cap || "butt", opacity: o.op ?? null });
    const box = (w, hgt) => s("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, style: "overflow:visible" });
    const fade = (c, el, st, dur = 500) => { el.style.opacity = 0; c.tl.at(st, dur, "out", (p) => { el.style.opacity = p; }); return el; };
    /** One hatch pattern per colour (and angle): never one per card, so two zones keep two colours. */
    function hatch(c, col, ang = 45, gap = 11, sw = 2.2) {
      const key = `${col}|${ang}|${gap}`;
      if (c.pats[key]) return c.pats[key];
      const id = `pnl-${c.uid}-${Object.keys(c.pats).length}`, g = gap * c.u;
      const p = s("pattern", { id, width: g, height: g, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${ang})` });
      p.append(s("line", { x1: g / 2, y1: -1, x2: g / 2, y2: g + 1, stroke: col, "stroke-width": sw * c.u }));
      c.defs.append(p);
      return (c.pats[key] = `url(#${id})`);
    }
    /** Leader line + handwritten note. Text anchored at (x, y); the leader runs from (ax, ay) to the text. */
    function annot(c, g, ax, ay, x, y, str, o = {}) {
      const size = o.size || 40 * c.u, a = o.a || "start";
      const w = tw(str, "hand", size);
      const lx = a === "end" ? x + 10 * c.u : a === "middle" ? x : x - 10 * c.u;
      const ly = y - size * 0.3;
      if (o.leader !== false) g.append(s("path", { d: `M${ax.toFixed(1)},${ay.toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)}`, fill: "none", stroke: o.col || "var(--ink)", "stroke-width": 1.8 * c.u }));
      g.append(tx(c, x, y, str, { f: "hand", size, a, fill: o.col || "var(--ink)" }));
      return w;
    }
    function niceStep(max, n = 4) {
      const raw = max / n, p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
      const m = raw / p;
      return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
    }
    function wrap(str, f, size, width) {
      const lines = []; let cur = "";
      for (const wd of String(str).split(" ")) { const nx = cur ? cur + " " + wd : wd; if (tw(nx, f, size) > width && cur) { lines.push(cur); cur = wd; } else cur = nx; }
      if (cur) lines.push(cur);
      return lines;
    }
    const niceMax = (v, n = 4) => { const st = niceStep(v, n); return Math.max(st, Math.ceil((v * 1.02) / st) * st); };
    const tick = (v) => (v >= 10000 ? compact(v) : int(v));

    // ------------------------------------------------------------ html helpers
    const lab = (txt) => h("div", { class: "pn-lab" }, txt);
    const px = (c, n, min = MIN) => Math.max(min * c.u, n * c.k * c.u) + "px";
    function hero(c, kids, max, min = 100, o = {}) {
      return h("div", { class: "pn-hero" + (o.mono ? " pn-mono" : "") + (o.acc ? " pn-acc" : ""), "data-fit": Math.round(max * (c.tall ? 1.15 : 1) * c.k * c.u), "data-min": Math.round(Math.max(MIN, min) * c.u), style: { marginTop: px(c, o.mt ?? 16, 6) } }, kids);
    }
    function heroCount(c, to, fmt, unit, max, start = 250) {
      const num = h("span", {}, fmt(to));
      const el = hero(c, [num, unit ? h("span", { class: "pn-u" }, unit) : null], max, 110);
      c.tl.count(num, start, 1400, to, fmt);
      return el;
    }
    const note = (c, kids, size = 72) => h("div", { class: "pn-note pn-sp1", style: { fontSize: px(c, size, 36) } }, kids);
    const body = (...kids) => h("div", { class: "pn-body pn-sp1" }, ...kids);
    const b = (txt) => h("b", {}, txt);
    function readouts(c, items, o = {}) {
      const n = items.length;
      const wrap = h("div", { class: "pn-ros", style: { gridTemplateColumns: `repeat(${o.cols || n}, minmax(0, 1fr))` } });
      items.forEach(([label, value, unit, fmt], i) => {
        const num = h("span", {}, typeof value === "number" ? (fmt || int)(value) : value);
        const v = h("div", { class: "pn-ro-v", "data-fit": Math.round((o.size || 104) * c.k * c.u), "data-min": Math.round(40 * c.u) }, num, unit ? h("span", { class: "pn-u" }, unit) : null);
        wrap.append(h("div", { class: "pn-ro" }, h("div", { class: "pn-ro-l" }, label), v));
        if (typeof value === "number") c.tl.count(num, (o.at || 1100) + i * 140, 1200, value, fmt || int);
      });
      c.tl.stagger([...wrap.children], (o.at || 1100) - 150, 140, (el, st) => c.tl.in(el, st, { y: 30 * c.u, dur: 500 }));
      return wrap;
    }
    function enter(c, els, start = 120, gap = 140) { els.filter(Boolean).forEach((el, i) => c.tl.in(el, start + i * gap, { y: 36 * c.u, dur: 650 })); }

    // ------------------------------------------------------------ the sheet: border, zones, registration marks, header
    function sheet(c, id, chKey) {
      const { W, H, u } = c, m = 40 * u, ch = CH[chKey];
      c.uid = `${id}-${W}x${H}-${Math.round(c.k * 100)}`;
      c.pats = {};
      c.defs = s("defs");
      c.art.append(c.defs);
      c.el.style.setProperty("--acc", ch.col);
      const fr = s("g");
      fr.append(s("rect", { x: m, y: m, width: W - 2 * m, height: H - 2 * m, fill: "none", stroke: "var(--ink)", "stroke-width": 2.5 * u }));
      const cols = Math.max(4, Math.round(W / 270)), rows = Math.max(4, Math.round(H / 300));
      for (let i = 0; i <= cols * 2; i++) { const x = m + (i * (W - 2 * m)) / (cols * 2), L = (i % 2 ? 7 : 14) * u; fr.append(ln(x, m, x, m - L, { w: 1.8 * u }), ln(x, H - m, x, H - m + L, { w: 1.8 * u })); }
      for (let i = 0; i <= rows * 2; i++) { const y = m + (i * (H - 2 * m)) / (rows * 2), L = (i % 2 ? 7 : 14) * u; fr.append(ln(m, y, m - L, y, { w: 1.8 * u }), ln(W - m, y, W - m + L, y, { w: 1.8 * u })); }
      for (let i = 0; i < cols; i++) { const x = m + ((i + 0.5) * (W - 2 * m)) / cols; fr.append(tx(c, x, 25 * u, String(i + 1), { a: "middle", size: 22 * u, fill: "var(--ink-2)" })); }
      for (let i = 0; i < rows; i++) { const y = m + ((i + 0.5) * (H - 2 * m)) / rows + 8 * u, L = "ABCDEFGHJK"[i]; fr.append(tx(c, 20 * u, y, L, { a: "middle", size: 22 * u, fill: "var(--ink-2)" }), tx(c, W - 20 * u, y, L, { a: "middle", size: 22 * u, fill: "var(--ink-2)" })); }
      const reg = (x, y, r) => { const g = s("g", { stroke: "var(--ink)", "stroke-width": 1.8 * u, fill: "none" }); g.append(s("circle", { cx: x, cy: y, r }), ln(x - r * 1.8, y, x + r * 1.8, y, { w: 1.8 * u }), ln(x, y - r * 1.8, x, y + r * 1.8, { w: 1.8 * u })); return g; };
      const hy = m + 42 * u;
      fr.append(reg(m + 40 * u, hy, 13 * u), reg(W - m - 40 * u, hy, 13 * u));
      // header: chapter tag left, period + sheet number right
      const tag = s("g");
      const tx0 = m + 82 * u;
      tag.append(s("rect", { x: tx0, y: hy - 11 * u, width: 22 * u, height: 22 * u, fill: ch.col }));
      const tagTxt = chKey === "findings" ? "FINDINGS" : `CH.${ch.n}  ${ch.name.toUpperCase()}`;
      tag.append(tx(c, tx0 + 34 * u, hy + 8.5 * u, tagTxt, { size: 24 * u, w: 700, ls: 0.14, fill: ch.col }));
      let tagEnd = tx0 + 34 * u + tw(tagTxt, "mono", 24 * u, 0.14, 700);
      if (chKey === "findings") ["rhythm", "voice", "work", "friction"].forEach((k, i) => tag.append(s("rect", { x: tagEnd + 14 * u + i * 30 * u, y: hy - 11 * u, width: 22 * u, height: 22 * u, fill: CH[k].col })));
      if (chKey === "findings") tagEnd += 14 * u + 4 * 30 * u;
      const no = String(ORDER.indexOf(id) + 1).padStart(2, "0");
      const right = W - m - 82 * u, room = right - tagEnd - 30 * u;
      const full = `${rangeLabel.toUpperCase()}  ·  SHEET ${no}`, short = rangeLabel.toUpperCase();
      const hdr = tw(full, "mono", 24 * u, 0.1) <= room ? full : tw(short, "mono", 24 * u, 0.1) <= room ? short : `SHEET ${no}`;
      fr.append(tx(c, right, hy + 8.5 * u, hdr, { a: "end", size: 24 * u, ls: 0.1, fill: "var(--ink-2)" }));
      c.art.append(fr, tag);
      c.tl.at(0, 600, "out", (p) => { fr.style.opacity = p; tag.style.opacity = p; });
    }
    /** Content starts below the header; the title block (CardKit's foot, pinned by CSS) gets a little extra room. */
    const insets = (meta) => (c) => ({ top: Math.round(56 * c.u), bottom: Math.round((meta.noFoot ? 92 : meta.bigMark ? 14 : 20) * c.u) });

    const SPECS = [];
    function card(meta, build) {
      SPECS.push({ id: meta.id, title: meta.title, dur: meta.dur || 6500, bg: meta.bg || "var(--paper)", fg: meta.fg || "var(--ink)", dark: !!meta.dark,
        squareSide: !!meta.squareSide, noFoot: !!meta.noFoot, bigMark: !!meta.bigMark, insets: insets(meta),
        build(c) { sheet(c, meta.id, meta.ch); return build(c); } });
    }

    // ------------------------------------------------------------ instruments
    /** Daily (or weekly, for long ranges) values as stems on a ruled plot. Returns {svg, X, base, top, bins}. */
    function binned(values) {
      const n = values.length, size = n > 150 ? 7 : 1, out = [];
      for (let i = 0; i < n; i += size) out.push({ i0: i, i1: Math.min(n, i + size) - 1, v: values.slice(i, i + size).reduce((a, x) => a + x, 0) });
      return { size, bins: out };
    }
    function axisX(c, g, X, base, n, binSize) {
      // weekly labels for short ranges, month starts for long ones; skip labels that would collide
      const marks = [];
      D.daily.forEach((d, i) => {
        const day = +d.day.slice(8, 10);
        if (D.daily.length <= 62 ? i % 7 === 0 : day === 1) marks.push({ i, str: D.daily.length <= 62 ? dshort(d.day).toUpperCase() : dshort(d.day).slice(0, 3).toUpperCase() });
      });
      let last = -1e9;
      marks.forEach(({ i, str }) => {
        const x = X(Math.floor(i / binSize));
        g.append(ln(x, base, x, base + 16 * c.u, { w: 1.8 * c.u }));
        const wdt = tw(str, "mono", 22 * c.u);
        if (x - wdt / 2 > last + 18 * c.u && x + wdt / 2 <= X.right + 30 * c.u && x - wdt / 2 >= X.left - 40 * c.u) { g.append(tx(c, x, base + 44 * c.u, str, { a: "middle", size: 22 * c.u, fill: "var(--ink-2)" })); last = x + wdt / 2; }
      });
    }
    function stemPlot(c, w, hgt, o = {}) {
      const svg = box(w, hgt), u = c.u;
      const vals = D.daily.map((d) => (o.minutes ? d.minutes / 60 : d.prompts));
      const { size, bins } = binned(vals);
      const nT = hgt > 380 * u ? 4 : 3, max = Math.max(...bins.map((x) => x.v), 1), st = niceStep(max, nT), top = Math.max(st, Math.ceil((max * 1.02) / st) * st);
      const padL = tw(tick(top), "mono", 22 * u) + 22 * u, padB = 56 * u, padT = (o.padT ?? 70) * u, padR = 12 * u;
      const x0 = padL, x1 = w - padR, base = hgt - padB, yTop = padT;
      const pitch = (x1 - x0) / bins.length;
      const X = (i) => x0 + (i + 0.5) * pitch; X.left = x0; X.right = x1;
      const Y = (v) => base - (base - yTop) * (v / top);
      const ax = s("g");
      ax.append(ln(x0 - 14 * u, base, x1, base, { w: 2.4 * u }), ln(x0 - 14 * u, yTop - 16 * u, x0 - 14 * u, base, { w: 2.4 * u }));
      for (let v = 0; v <= top + 1e-9; v += st) {
        ax.append(ln(x0 - 24 * u, Y(v), x0 - 14 * u, Y(v), { w: 2 * u }), tx(c, x0 - 30 * u, Y(v) + 8 * u, tick(v), { a: "end", size: 22 * u, fill: "var(--ink-2)" }));
        if (v) ax.append(ln(x0 - 14 * u, Y(v), x1, Y(v), { w: 1.2 * u, dash: `${3 * u} ${7 * u}`, op: 0.55 }));
      }
      const unit = o.minutes ? (size > 1 ? "HOURS / WEEK" : "HOURS / DAY") : size > 1 ? "PROMPTS / WEEK" : "PROMPTS / DAY";
      ax.append(tx(c, x0 - 14 * u, yTop - 30 * u, unit, { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
      axisX(c, ax, X, base, D.daily.length, size);
      svg.append(ax);
      fade(c, ax, 600, 500);
      const sw = clamp(pitch * 0.42, 2 * u, 7 * u), dot = pitch >= 9 * u ? Math.min(9 * u, pitch * 0.34) : 0;
      const stems = bins.map((bn, i) => {
        const g = s("g");
        if (bn.v > 0) {
          const y = Math.min(base - 3 * u, Y(bn.v));
          g.append(ln(X(i), base, X(i), y, { w: sw, stroke: o.stemCol || "var(--ink)" }));
          if (dot) g.append(s("circle", { cx: X(i), cy: y, r: dot, fill: "var(--acc)" }));
        } else if (pitch >= 12 * u) g.append(s("circle", { cx: X(i), cy: base, r: Math.min(5 * u, pitch * 0.22), fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": 1.8 * u }));
        svg.append(g);
        return g;
      });
      // the pen sweeps left to right; each stem rises as the pen passes it
      const pen = ln(x0, yTop - 10 * u, x0, base, { stroke: "var(--acc)", w: 2.2 * u });
      svg.append(pen);
      const t0 = o.at ?? 800;
      c.tl.at(t0, 1800, "inOut", (p) => {
        const xx = lerp(x0 - 10 * u, x1 + 10 * u, p);
        pen.setAttribute("x1", xx); pen.setAttribute("x2", xx); pen.style.opacity = p > 0 && p < 1 ? 0.85 : 0;
        stems.forEach((g, i) => { const q = clamp((xx - X(i) + 4 * u) / (30 * u)); g.style.opacity = q; g.style.transformOrigin = `${X(i)}px ${base}px`; g.style.transform = `scaleY(${Math.max(0.0001, E.out(q))})`; });
      });
      return { svg, X, Y, base, yTop, bins, size, x0, x1, pitch };
    }
    /** Analog gauge, 240 degree sweep. Zone [z0, z1] is hatched in its own colour. */
    function gauge(c, g, cx, cy, r, max, o = {}) {
      const u = c.u, a0 = (-210 * Math.PI) / 180, a1 = (30 * Math.PI) / 180;
      const ang = (v) => a0 + (a1 - a0) * clamp(v / max);
      const P = (v, rad) => [cx + Math.cos(ang(v)) * rad, cy + Math.sin(ang(v)) * rad];
      const arc = (v0, v1, rad) => { const [x0, y0] = P(v0, rad), [x1, y1] = P(v1, rad); return `M${x0.toFixed(1)},${y0.toFixed(1)}A${rad},${rad} 0 ${ang(v1) - ang(v0) > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
      const bw = r * 0.15;
      if (o.zone) {
        const [z0, z1] = o.zone, [ox0, oy0] = P(z0, r), [ox1, oy1] = P(z1, r), [ix1, iy1] = P(z1, r - bw), [ix0, iy0] = P(z0, r - bw);
        const lg = ang(z1) - ang(z0) > Math.PI ? 1 : 0;
        g.append(s("path", { d: `M${ox0},${oy0}A${r},${r} 0 ${lg} 1 ${ox1},${oy1}L${ix1},${iy1}A${r - bw},${r - bw} 0 ${lg} 0 ${ix0},${iy0}Z`, fill: hatch(c, o.zoneCol || "var(--c-friction)", 45, 10, 2.4), stroke: o.zoneCol || "var(--c-friction)", "stroke-width": 1.4 * u }));
      }
      g.append(s("path", { d: arc(0, max, r), fill: "none", stroke: "var(--ink)", "stroke-width": 2.6 * u }));
      g.append(s("path", { d: arc(0, max, r - bw), fill: "none", stroke: "var(--ink)", "stroke-width": 1.2 * u, opacity: 0.5 }));
      const st = o.step || niceStep(max, 4), minor = st / 5;
      for (let v = 0; v <= max + 1e-9; v += minor) {
        const major = Math.abs(v / st - Math.round(v / st)) < 1e-6, mid = !major && Math.abs((v / st) * 2 - Math.round((v / st) * 2)) < 1e-6;
        const [x1, y1] = P(v, r), [x2, y2] = P(v, r - (major ? bw : mid ? bw * 0.6 : bw * 0.35));
        g.append(ln(x1, y1, x2, y2, { w: (major ? 3 : 1.4) * u }));
        if (major && o.labels !== false) { const [lx, ly] = P(v, r + (o.labGap || 30) * u); g.append(tx(c, lx, ly + 8 * u, o.fmt ? o.fmt(v) : tick(v), { a: "middle", size: (o.labSize || 22) * u, fill: "var(--ink-2)" })); }
      }
      const nw = (o.nw || 6) * u, needle = s("g");
      needle.append(ln(cx, cy, cx + r * 0.84, cy, { stroke: o.needleCol || "var(--acc)", w: nw, cap: "round" }), ln(cx, cy, cx - r * 0.12, cy, { stroke: o.needleCol || "var(--acc)", w: nw * 1.6, cap: "round" }));
      needle.append(s("circle", { cx, cy, r: nw * 2.3, fill: "var(--ink)" }), s("circle", { cx, cy, r: nw * 0.8, fill: "var(--paper)" }));
      g.append(needle);
      const set = (v) => needle.setAttribute("transform", `rotate(${((ang(v) * 180) / Math.PI).toFixed(2)} ${cx} ${cy})`);
      set(0);
      return { set, needle };
    }
    /** Space a gauge with outside labels needs: width 2r + 2*lab, height 1.5r + lab + below. */
    const gaugeR = (w, hgt, lab, below) => Math.max(10, Math.min((w - 2 * lab) / 2, (hgt - lab - below) / 1.5));
    /** Harness traces, busiest first: the accent trace is the harness that did most of the prompting. */
    function byWeight(hps) {
      if (!hps || !hps.length) return [{ key: "all", hours: R.hours }];
      const wt = (x) => (x.prompts != null ? x.prompts : x.hours.reduce((a, v) => a + v, 0));
      return hps.slice().sort((a, x) => wt(x) - wt(a));
    }
    /** 24 h polar plot: one trace per harness, quiet hours hatched, labels outside. */
    function polarPlot(c, g, cx, cy, Rr, r0, o = {}) {
      const u = c.u, P = (rad, hr) => { const a = (hr / 24) * Math.PI * 2 - Math.PI / 2; return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; };
      const series = byWeight(R.harnessPeaks);
      const max = Math.max(...series.flatMap((x) => x.hours), 1);
      const rr = (v) => r0 + (Rr - r0) * Math.sqrt(v / max);
      const Q = R.quiet;
      if (Q && Q.len >= 3) {
        const [ax, ay] = P(Rr, Q.start), [bx, by] = P(Rr, Q.start + Q.len), [ix, iy] = P(r0, Q.start), [jx, jy] = P(r0, Q.start + Q.len);
        g.append(s("path", { d: `M${ix},${iy}L${ax},${ay}A${Rr},${Rr} 0 0 1 ${bx},${by}L${jx},${jy}A${r0},${r0} 0 0 0 ${ix},${iy}Z`, fill: hatch(c, "var(--ink)", 45, 13, 1.4), opacity: 0.5 }));
      }
      [0.25, 0.5, 0.75, 1].forEach((q) => g.append(s("circle", { cx, cy, r: r0 + (Rr - r0) * q, fill: "none", stroke: "var(--ink)", "stroke-width": (q === 1 ? 2.4 : 1.2) * u, "stroke-dasharray": q === 1 ? null : `${4 * u} ${6 * u}`, opacity: q === 1 ? 1 : 0.45 })));
      g.append(s("circle", { cx, cy, r: r0, fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": 1.5 * u }));
      const minorLabels = o.labels !== false && Rr >= 200 * u;
      for (let hr = 0; hr < 24; hr++) {
        const major = hr % 6 === 0;
        const [x1, y1] = P(r0, hr), [x2, y2] = P(Rr + (major ? 16 : 8) * u, hr);
        g.append(ln(x1, y1, x2, y2, { w: (major ? 1.8 : 1) * u, op: major ? 0.75 : 0.3 }));
        if (o.labels !== false && (major || (minorLabels && hr % 3 === 0))) {
          const [lx, ly] = P(Rr + (major ? 42 : 34) * u, hr);
          g.append(tx(c, lx, ly + 8 * u, String(hr).padStart(2, "0"), { a: "middle", size: (major ? 26 : 22) * u, w: major ? 700 : 500, fill: major ? "var(--ink)" : "var(--ink-2)" }));
        }
      }
      const traces = series.map((hp, i) => {
        const pts = hp.hours.map((v, hr) => P(rr(v), hr));
        const p = s("path", { d: smooth(pts, true, 0.9), fill: i === 0 ? hatch(c, "var(--acc)", 45, 12, 2.2) : "none", stroke: i === 0 ? "var(--acc)" : "var(--ink)", "stroke-width": (i === 0 ? o.sw || 5 : (o.sw || 5) * 0.6) * u, "stroke-dasharray": i === 0 ? null : `${10 * u} ${8 * u}`, "stroke-linejoin": "round" });
        g.append(p);
        return p;
      });
      return { traces, P, series };
    }
    /** Ranked rows on measured tracks: label | scale with ticks | value. */
    function tracks(c, w, hgt, rows, o = {}) {
      const u = c.u, svg = box(w, hgt);
      const head = o.scale === false ? 0 : 40 * u;
      // tall boxes: label and value above a full-width track (a bank of meters); otherwise label | track | value
      const stacked = hgt / Math.max(1, rows.length) > 170 * u && w < 1100 * u;
      const minPitch = (stacked ? 120 : 58) * u, n = Math.max(1, Math.min(rows.length, Math.floor((hgt - head) / minPitch)));
      const pitch = Math.min((o.maxPitch || (stacked ? 230 : 118)) * u, (hgt - head) / n);
      const off = stacked ? Math.max(0, (hgt - head - n * pitch) / 2) : 0;
      const shown = rows.slice(0, n);
      const f = o.mono ? "mono" : "cond";
      let ls = stacked ? clamp(pitch * (o.mono ? 0.28 : 0.36), 30 * u, (o.mono ? 54 : 72) * u) : clamp(pitch * (o.mono ? 0.4 : 0.56), 26 * u, (o.mono ? 46 : 66) * u);
      const vs = stacked ? clamp(pitch * 0.2, 26 * u, 40 * u) : clamp(pitch * 0.3, 24 * u, 32 * u);
      const valW = Math.max(...shown.map((r) => tw(r.text, "mono", vs, 0, 700))) + 22 * u;
      const widest = Math.max(...shown.map((r) => tw(r.label, f, ls, 0, o.mono ? 700 : 800)));
      const labW = stacked ? w - valW : Math.min(w * 0.42, widest + 26 * u);
      if (widest + 26 * u > labW) ls = Math.max(26 * u, (ls * (labW - 26 * u)) / widest);
      const a = stacked ? 0 : labW, bx = stacked ? w - 2 * u : w - valW;
      const max = o.max || niceMax(Math.max(...rows.map((r) => r.value)), 2);
      const ax = s("g");
      if (head) {
        [0, 0.5, 1].forEach((q) => ax.append(tx(c, lerp(a, bx, q), off + 24 * u, (o.scaleFmt || tick)(max * q), { a: q === 0 ? "start" : q === 1 ? "end" : "middle", size: 22 * u, fill: "var(--ink-2)" })));
        if (o.unit && tw(o.unit, "mono", 22 * u, 0.1, 700) < a - 20 * u) ax.append(tx(c, 0, off + 24 * u, o.unit, { size: 22 * u, w: 700, ls: 0.1, fill: "var(--ink-2)" }));
      }
      svg.append(ax); fade(c, ax, (o.at || 900) - 200);
      shown.forEach((r, i) => {
        const ly = off + head + pitch * i + pitch * 0.18 + ls * 0.8, y = stacked ? ly + ls * 0.25 + 30 * u : off + head + pitch * (i + 0.55);
        const g = s("g");
        g.append(tx(c, 0, stacked ? ly : y + ls * 0.34, r.label, { f, size: ls, w: o.mono ? 700 : 800, fill: i === 0 && !o.noTop ? "var(--acc)" : "var(--ink)" }));
        g.append(ln(a, y, bx, y, { w: 1.6 * u }));
        for (let k = 0; k <= 10; k++) { const xx = lerp(a, bx, k / 10), L = (k % 5 === 0 ? 13 : 7) * u; g.append(ln(xx, y - L, xx, y + L, { w: 1.4 * u })); }
        const end = lerp(a, bx, clamp(r.value / max));
        let bar, dot;
        if (o.bars) {
          const bh = Math.min(pitch * (stacked ? 0.2 : 0.42), (stacked ? 40 : 34) * u);
          bar = s("rect", { x: a, y: y - bh / 2, width: Math.max(1, end - a), height: bh, fill: i === 0 && !o.noTop ? "var(--acc)" : hatch(c, "var(--acc)", 45, 10, 2.2), stroke: "var(--acc)", "stroke-width": 2 * u });
          g.append(bar);
          c.tl.grow(bar, (o.at || 900) + i * 140, { axis: "X", origin: "0% 50%", dur: 1000 });
        } else {
          bar = ln(a, y, a, y, { stroke: "var(--acc)", w: 6 * u, cap: "round" });
          dot = s("circle", { cx: a, cy: y, r: 11 * u, fill: i === 0 && !o.noTop ? "var(--acc)" : "var(--paper)", stroke: "var(--acc)", "stroke-width": 4 * u });
          g.append(bar, dot);
        }
        const val = tx(c, w, stacked ? ly : y + vs * 0.36, r.text, { a: "end", size: vs, w: 700 });
        g.append(val);
        svg.append(g);
        const st = (o.at || 900) + i * 140;
        fade(c, g, st, 350);
        if (!o.bars) c.tl.at(st, 1100, "out5", (p) => { const xx = lerp(a, end, p); bar.setAttribute("x2", xx); dot.setAttribute("cx", xx); });
      });
      return svg;
    }
    /** A bar split by share, with dimension lines over the wide segments. */
    function propBar(c, g, segs, x0, x1, y, bh, o = {}) {
      const u = c.u;
      let acc = 0;
      const parts = segs.map((sg) => { const a = lerp(x0, x1, acc), bb = lerp(x0, x1, acc + sg.share); acc += sg.share; return { ...sg, a, b: bb }; });
      const rects = parts.map((p) => { const rc = s("rect", { x: p.a, y, width: Math.max(1.5 * u, p.b - p.a), height: bh, fill: p.fill, stroke: "var(--ink)", "stroke-width": 2 * u }); g.append(rc); return rc; });
      c.tl.at(o.at || 900, 1300, "inOut", (q) => { const lim = lerp(x0, x1, q); rects.forEach((rc, i) => { const p = parts[i]; rc.setAttribute("width", Math.max(0, Math.min(p.b, lim) - p.a)); rc.style.opacity = lim > p.a ? 1 : 0; }); });
      const dims = s("g");
      parts.forEach((p, i) => {
        const label = p.share < 0.01 ? "<1%" : pct(p.share), size = Math.min(44 * u, bh * 0.6);
        if (p.b - p.a < tw(label, "cond", size) + 50 * u) return;
        const dy = y - 34 * u;
        dims.append(ln(p.a, y - 6 * u, p.a, dy - 16 * u, { w: 1.4 * u }), ln(p.b, y - 6 * u, p.b, dy - 16 * u, { w: 1.4 * u }), ln(p.a + 3 * u, dy, p.b - 3 * u, dy, { w: 1.6 * u }));
        dims.append(s("path", { d: `M${p.a + 2 * u},${dy} l${14 * u},${-6 * u} l0,${12 * u}Z M${p.b - 2 * u},${dy} l${-14 * u},${-6 * u} l0,${12 * u}Z`, fill: "var(--ink)" }));
        const lw = tw(label, "cond", size) + 24 * u;
        dims.append(s("rect", { x: (p.a + p.b) / 2 - lw / 2, y: dy - size * 0.62, width: lw, height: size * 1.1, fill: "var(--paper)" }));
        dims.append(tx(c, (p.a + p.b) / 2, dy + size * 0.36, label, { a: "middle", f: "cond", size, fill: i === 0 ? "var(--acc)" : "var(--ink)" }));
      });
      g.append(dims); fade(c, dims, (o.at || 900) + 1200, 500);
      return parts;
    }
    const swatch = (c, fill, sz = 30) => { const sv = s("svg", { width: sz * c.u, height: sz * c.u, viewBox: `0 0 ${sz * c.u} ${sz * c.u}` }); sv.append(s("rect", { x: c.u, y: c.u, width: sz * c.u - 2 * c.u, height: sz * c.u - 2 * c.u, fill, stroke: "var(--ink)", "stroke-width": 2 * c.u })); return sv; };

    // ================================================================ the 21 sheets
    // 1. intro ------------------------------------------------------------
    card({ id: "intro", title: "Intro", ch: "rhythm", dur: 6200 }, (c) => {
      const names = (T.harnesses || []).map((x) => harnessName(x.key));
      const who = names.length ? (names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`) : "Your agents";
      const k = lab("Your logbook");
      const t1 = hero(c, `${D.range.days} ${D.range.days === 1 ? "day" : "days"}`, c.mode === "side" ? 240 : 270, 120);
      const t2 = note(c, "with AI, logged.", 92);
      const p = body(`${who}, looked back on. `, b(`${int(T.activeDays)} busy days`), ` out of ${int(D.range.days)}.`);
      enter(c, [k, t1, t2, p], 150, 140);
      const showRo = c.mode === "side" || c.tall;
      const ro = showRo ? readouts(c, [["Sessions", T.sessions], ["Prompts", T.prompts], ["Active days", T.activeDays, `/${int(D.range.days)}`]], { size: c.mode === "side" ? 84 : 104, at: 1300 }) : null;
      return { head: h("div", {}, k, t1, t2, p), extra: ro, artMin: 0.3, split: 0.44, legend: binned(D.daily).size > 1 ? "one stem = one week" : "one stem = one day",
        art(w, hgt) {
          const sp = stemPlot(c, w, hgt, { at: 800 });
          const ann = s("g");
          let bigBox = null;
          if (D.bigDay) {
            const di = D.daily.findIndex((d) => d.day === D.bigDay.day);
            if (di >= 0) {
              const bi = Math.floor(di / sp.size), bin = sp.bins[bi], x = sp.X(bi), y = sp.Y(bin.v);
              const str = `${int(D.bigDay.prompts)} prompts, a ${DAYNAME[D.bigDay.weekday].slice(0, -1)}${sp.size > 1 ? " (biggest day)" : ""}`;
              const size = 40 * c.u, wdt = tw(str, "hand", size);
              // the note sits in the band above the plot, away from the axis title
              const right = x + 40 * c.u + wdt < w, ty = sp.yTop - 22 * c.u;
              const tx_ = right ? x + 40 * c.u : x - 40 * c.u;
              const unitEnd = sp.x0 + tw("PROMPTS / WEEK", "mono", 22 * c.u, 0.12, 700);
              const left0 = right ? tx_ : tx_ - wdt;
              const fy = left0 > unitEnd + 20 * c.u ? ty : Math.max(size, y - 4 * c.u);
              if (right || x - 40 * c.u - wdt > 0) { annot(c, ann, x + (right ? 6 : -6) * c.u, y - 10 * c.u, tx_, fy, str, { a: right ? "start" : "end", size }); bigBox = { x0: left0, x1: left0 + wdt, y0: fy - size, y1: fy + 8 * c.u }; }
            }
          }
          // longest quiet run, bracketed
          let best = { len: 0, start: 0 }, cur = 0;
          D.daily.forEach((d, i) => { if (!activeDay(d)) { cur++; if (cur > best.len) best = { len: cur, start: i - cur + 1 }; } else cur = 0; });
          if (best.len >= Math.max(4, D.daily.length * 0.12)) {
            const qa = sp.X(Math.floor(best.start / sp.size)), qb = sp.X(Math.floor((best.start + best.len - 1) / sp.size)), qy = sp.base - 64 * c.u;
            const str = `${best.len} quiet days`, wdt = tw(str, "hand", 38 * c.u);
            if (qb - qa > 40 * c.u) {
              ann.append(ln(qa, qy, qb, qy, { w: 1.8 * c.u }), ln(qa, qy - 13 * c.u, qa, qy + 13 * c.u, { w: 1.8 * c.u }), ln(qb, qy - 13 * c.u, qb, qy + 13 * c.u, { w: 1.8 * c.u }));
              const mx = clamp((qa + qb) / 2, wdt / 2, w - wdt / 2);
              const hit = bigBox && mx + wdt / 2 > bigBox.x0 && mx - wdt / 2 < bigBox.x1 && qy - 20 * c.u > bigBox.y0 && qy - 50 * c.u < bigBox.y1;
              ann.append(tx(c, mx, hit ? qy + 42 * c.u : qy - 20 * c.u, str, { f: "hand", size: 38 * c.u, a: "middle" })); // below the bracket when the big-day note sits above it
            }
          }
          sp.svg.append(ann); fade(c, ann, 2500, 600);
          return sp.svg;
        } };
    });

    // 2. hours ------------------------------------------------------------
    card({ id: "hours", title: "Time", ch: "rhythm", dur: 6500 }, (c) => {
      const k = lab("Time with your agents");
      const big = heroCount(c, T.wallHours, int, "hrs", 300);
      const p = body("with at least one agent at work. Side by side, they logged ", b(`${int(T.agentHours)} agent-hours`), ".");
      enter(c, [k, big, p], 120, 180);
      return { head: h("div", {}, k, big, p), artMin: 0.34, split: 0.46, legend: "hatched = agents in parallel",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          // comparison scale: wall-clock hours vs agent-hours
          const cmpH = 290 * u;
          const showDaily = hgt - cmpH > 300 * u;
          const y0 = showDaily ? hgt - cmpH : Math.max(0, (hgt - cmpH) / 2);
          if (showDaily) { const sp = stemPlot(c, w, hgt - cmpH - 30 * u, { minutes: true, at: 600, padT: 50 }); svg.append(sp.svg); }
          const max = niceMax(Math.max(T.agentHours, T.wallHours), 4), st = niceStep(max, 4);
          const x0 = 0, x1 = w - 10 * u, X = (v) => lerp(x0, x1, v / max), bh = 52 * u;
          const g = s("g");
          const ya = y0 + 64 * u, yb = ya + bh + 46 * u, ys = yb + bh + 18 * u;
          g.append(tx(c, 0, ya - 16 * u, "WALL CLOCK", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
          g.append(tx(c, 0, yb - 16 * u, "AGENT-HOURS", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
          const ra = s("rect", { x: x0, y: ya, width: X(T.wallHours) - x0, height: bh, fill: "var(--acc)", stroke: "var(--ink)", "stroke-width": 2 * u });
          const rb = s("rect", { x: x0, y: yb, width: X(T.agentHours) - x0, height: bh, fill: hatch(c, "var(--acc)", 45, 11, 2.4), stroke: "var(--acc)", "stroke-width": 2.4 * u });
          g.append(ra, rb);
          const va = tx(c, X(T.wallHours) + 14 * u, ya + bh * 0.72, `${int(T.wallHours)} h`, { f: "cond", size: 44 * u });
          const vb = tx(c, Math.min(X(T.agentHours) + 14 * u, w - tw(`${int(T.agentHours)} h`, "cond", 44 * u)), yb + bh * 0.72, `${int(T.agentHours)} h`, { f: "cond", size: 44 * u });
          g.append(va, vb);
          g.append(ln(x0, ys, x1, ys, { w: 2 * u }));
          for (let v = 0; v <= max + 1e-9; v += st / 5) { const maj = Math.abs(v / st - Math.round(v / st)) < 1e-6; g.append(ln(X(v), ys, X(v), ys + (maj ? 16 : 8) * u, { w: 1.6 * u })); if (maj) g.append(tx(c, X(v), ys + 42 * u, int(v), { a: v === 0 ? "start" : v >= max ? "end" : "middle", size: 22 * u, fill: "var(--ink-2)" })); }
          svg.append(g);
          c.tl.grow(ra, 900, { axis: "X", origin: "0% 50%", dur: 1100 }).grow(rb, 1100, { axis: "X", origin: "0% 50%", dur: 1300 });
          fade(c, va, 1800); fade(c, vb, 2200);
          const ratio = T.agentHours / Math.max(1, T.wallHours);
          if (ratio >= 1.1) {
            const str = `about ${one(ratio)} agents at a time`, size = 38 * u, wdt = tw(str, "hand", size);
            const ann = s("g"), ax = X(T.wallHours), ay = yb + bh / 2;
            const tx_ = Math.min(w - wdt, X(T.agentHours) - wdt);
            if (tx_ > ax + 10 * u || true) { ann.append(tx(c, Math.max(0, w - wdt), ya - 18 * u, str, { f: "hand", size })); }
            svg.append(ann); fade(c, ann, 2600);
          }
          return svg;
        } };
    });

    // 3. clock ------------------------------------------------------------
    card({ id: "clock", title: "Clock", ch: "rhythm", dur: 7000, squareSide: true }, (c) => {
      const kk = lab("When you prompt");
      const colW = c.mode === "side" ? c.box.w * 0.47 - c.G / 2 : c.box.w, vtxt = `${R.verdict.label}.`;
      let v;
      if (tw(vtxt, "cond", 92 * c.u) <= colW) v = hero(c, vtxt, c.mode === "side" ? 150 : 190, 92);
      else { // a long verdict wraps onto two lines rather than shrinking to a whisper
        const longest = Math.max(...vtxt.split(" ").map((wd) => tw(wd, "cond", 100)));
        v = h("div", { class: "pn-hero", style: { whiteSpace: "normal", lineHeight: 0.92, marginTop: px(c, 16, 6), fontSize: Math.max(56 * c.u, Math.min(150 * c.k * c.u, (100 * (colW - 8)) / longest)) + "px" } }, vtxt);
      }
      const quiet = R.quiet && R.quiet.len >= 3 ? [" Never between ", b(`${hh(R.quiet.start)}–${hh((R.quiet.start + R.quiet.len) % 24)}`), "."] : "";
      const p = body(b(pct(R.nightShare)), " of your prompts came after 22:00. Peak hour ", b(hh(R.peakHour)), ".", quiet);
      enter(c, [kk, v, p], 120, 160);
      const hp = byWeight(R.harnessPeaks).filter((x) => x.key !== "all");
      const key = hp.length > 1 ? h("div", { class: "pn-key" }, hp.slice(0, 3).map((x, i) => {
        const sv = s("svg", { width: 54 * c.u, height: 20 * c.u, viewBox: `0 0 ${54 * c.u} ${20 * c.u}` });
        sv.append(ln(0, 10 * c.u, 54 * c.u, 10 * c.u, { stroke: i === 0 ? "var(--acc)" : "var(--ink)", w: (i === 0 ? 5 : 3) * c.u, dash: i === 0 ? null : `${10 * c.u} ${7 * c.u}` }));
        return h("div", {}, sv, h("span", {}, `${harnessName(x.key)} · peaks ${hh(x.peak)}`));
      })) : null;
      if (key) c.tl.in(key, 2000, { y: 20 * c.u });
      return { head: h("div", {}, kk, v, p), extra: key, artMin: 0.42, split: 0.47, legend: "radius = prompts per hour",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt), lm = 54 * u;
          const Rr = Math.min(w, hgt) / 2 - lm, cx = w / 2, cy = hgt / 2;
          const g = s("g");
          const pp = polarPlot(c, g, cx, cy, Rr, Math.max(18 * u, Rr * 0.18), { labels: Rr > 90 * u, sw: Rr > 200 * u ? 5 : 3.5 });
          svg.append(g);
          fade(c, g, 500, 600);
          pp.traces.forEach((tr, i) => { c.tl.draw(tr, 900 + i * 450, 1600); c.tl.at(900 + i * 450, 1600, "inOut", (q) => { tr.style.fillOpacity = q; }); });
          const pa = (R.peakHour / 24) * 360, needle = s("g");
          const [nx, ny] = pp.P(Rr + 2 * u, 0);
          needle.append(ln(cx, cy, nx, ny, { w: 4 * u, cap: "round" }), s("circle", { cx: nx, cy: ny, r: 8 * u, fill: "var(--ink)" }));
          svg.append(needle, s("circle", { cx, cy, r: 15 * u, fill: "var(--ink)" }), s("circle", { cx, cy, r: 5 * u, fill: "var(--paper)" }));
          c.tl.at(1200, 1600, "spring", (q) => { needle.setAttribute("transform", `rotate(${lerp(pa - 150, pa, q).toFixed(2)} ${cx} ${cy})`); needle.style.opacity = clamp(q * 4); });
          const [ex, ey] = pp.P(Rr + 2 * u, R.peakHour);
          const str = `peak ${hh(R.peakHour)}`, size = 40 * u, wdt = tw(str, "hand", size);
          const left = ex < cx, txX = left ? Math.max(wdt, ex - 30 * u) : Math.min(w - wdt, ex + 30 * u), txY = clamp(ey + (ey < cy ? -34 : 52) * u, size, hgt - 6 * u);
          if (Rr > 120 * u) { const ann = s("g"); annot(c, ann, ex, ey, txX, txY, str, { a: left ? "end" : "start", size }); svg.append(ann); fade(c, ann, 2600); }
          if (R.quiet && R.quiet.len >= 3 && Rr > 170 * u) {
            const [qx, qy] = pp.P((Rr + Rr * 0.18) / 2 + 26 * u, R.quiet.start + R.quiet.len / 2);
            const ql = s("g");
            ql.append(s("rect", { x: qx - 64 * u, y: qy - 34 * u, width: 128 * u, height: 50 * u, fill: "var(--paper)" }), tx(c, qx, qy + 4 * u, "silent", { f: "hand", size: 38 * u, a: "middle" }));
            svg.append(ql); fade(c, ql, 2300);
          }
          return svg;
        } };
    });

    // 4. weekday ----------------------------------------------------------
    card({ id: "weekday", title: "Weekdays", ch: "rhythm", dur: 6500 }, (c) => {
      const wds = R.weekdays, top = wds.slice().sort((a, x) => x.count - a.count)[0];
      const total = Math.max(1, wds.reduce((a, x) => a + x.count, 0)), fri = (wds.find((d) => d.key === "Fri")?.count ?? 0) / total;
      const k = lab("Favourite day");
      const big = hero(c, `${DAYNAME[top.key]}.`, 230, 100);
      const p = body(b(pct(top.count / total)), " of your prompts. ", fri < 0.08 ? ["Fridays? Just ", b(pct(fri)), ". TGIF, apparently."] : "");
      enter(c, [k, big, p], 120, 160);
      return { head: h("div", {}, k, big, p), artMin: 0.38, split: 0.44, legend: "dashed line = weekday average",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt), max = niceMax(top.count, 3), st = niceStep(top.count, 3);
          const padL = tw(tick(max), "mono", 22 * u) + 24 * u, base = hgt - 52 * u, yTop = 80 * u, slot = (w - padL) / 7, bw = Math.min(slot * 0.62, 110 * u);
          const Y = (v) => base - (base - yTop) * (v / max);
          const ax = s("g");
          ax.append(ln(padL - 10 * u, base, w, base, { w: 2.4 * u }));
          for (let v = 0; v <= max + 1e-9; v += st) { ax.append(tx(c, padL - 22 * u, Y(v) + 8 * u, tick(v), { a: "end", size: 22 * u, fill: "var(--ink-2)" })); if (v) ax.append(ln(padL - 10 * u, Y(v), w, Y(v), { w: 1.2 * u, dash: `${3 * u} ${7 * u}`, op: 0.5 })); }
          svg.append(ax); fade(c, ax, 500);
          wds.forEach((d, i) => {
            const x = padL + i * slot + (slot - bw) / 2, hg = Math.max(3 * u, base - Y(d.count)), isTop = d.key === top.key;
            const r = s("rect", { x, y: base - hg, width: bw, height: hg, fill: isTop ? "var(--acc)" : hatch(c, "var(--ink)", 45, 11, 1.8), stroke: isTop ? "var(--acc)" : "var(--ink)", "stroke-width": 2.2 * u });
            const val = tx(c, x + bw / 2, base - hg - 14 * u, int(d.count), { a: "middle", size: clamp(bw * 0.3, 22 * u, 30 * u), w: 700, fill: isTop ? "var(--acc)" : "var(--ink)", halo: true });
            svg.append(r, val, tx(c, x + bw / 2, hgt - 12 * u, d.key.slice(0, 2).toUpperCase(), { a: "middle", size: 24 * u, w: 700 }));
            c.tl.grow(r, 600 + i * 100, { dur: 1100, ease: "out5" });
            fade(c, val, 1100 + i * 100, 400);
          });
          const avg = total / 7, ya = Y(avg), g = s("g");
          g.append(ln(padL - 10 * u, ya, w, ya, { stroke: "var(--acc)", w: 2.4 * u, dash: `${12 * u} ${8 * u}` }));
          const str = `weekday average ${int(avg)}`;
          g.append(ln(padL, 22 * u, padL + 48 * u, 22 * u, { stroke: "var(--acc)", w: 2.4 * u, dash: `${12 * u} ${8 * u}` }), tx(c, padL + 60 * u, 32 * u, str, { f: "hand", size: 36 * u, fill: "var(--acc)" }));
          svg.append(g); fade(c, g, 2300);
          return svg;
        } };
    });

    // 5. streak -----------------------------------------------------------
    card({ id: "streak", title: "Streak", ch: "rhythm", dur: 6500 }, (c) => {
      const S = D.streak || { days: 0 };
      const k = lab("Longest streak");
      const big = heroCount(c, S.days, int, S.days === 1 ? "day" : "days", 300, 200);
      const p = body(S.start ? `in a row, ${dshort(S.start)} to ${dshort(S.end)}. ` : "", b(`${int(T.activeDays)} active days`), ` out of ${int(D.range.days)}.`);
      enter(c, [k, big, p], 120, 160);
      const bd = D.bigDay ? h("div", { class: "pn-body", style: { display: "flex", alignItems: "center", gap: px(c, 20, 12) } },
        (() => { const sv = s("svg", { width: 40 * c.u, height: 40 * c.u, viewBox: `0 0 ${40 * c.u} ${40 * c.u}`, style: "flex:none" }); sv.append(s("circle", { cx: 20 * c.u, cy: 20 * c.u, r: 16 * c.u, fill: "none", stroke: "var(--ink)", "stroke-width": 4 * c.u })); return sv; })(),
        h("span", {}, "Biggest day: ", b(`${int(D.bigDay.prompts)} prompts`), ` on a ${DAYNAME[D.bigDay.weekday].slice(0, -1)}.`)) : null;
      if (bd) c.tl.in(bd, 1900, { y: 20 * c.u });
      return { head: h("div", {}, k, big, p), extra: bd, artMin: 0.32, split: 0.46, legend: "solid = the streak",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          const firstDow = (new Date((D.daily[0]?.day ?? D.range.from) + "T12:00:00Z").getUTCDay() + 6) % 7, n = D.daily.length;
          const weeks = Math.ceil((n + firstDow) / 7);
          // choose: weeks as rows (7 columns) or weeks as columns (7 rows), in 1..4 bands, for the biggest cells
          let best = null;
          for (const orient of ["rows", "cols"]) for (let bands = 1; bands <= 4; bands++) {
            const per = Math.ceil(weeks / bands), labS = 34 * u, bandGap = 26 * u;
            const gw = orient === "rows" ? bands * 7 : per, gh = orient === "rows" ? per : bands * 7;
            const availW = w - (orient === "cols" ? labS : 0) - (orient === "rows" ? (bands - 1) * bandGap : 0);
            const availH = hgt - (orient === "rows" ? labS : 0) - (orient === "cols" ? (bands - 1) * bandGap : 0);
            const pitch = Math.min(availW / gw, availH / gh, 120 * u);
            if (!best || pitch > best.pitch + 0.5) best = { orient, bands, per, pitch, labS, bandGap };
          }
          const { orient, per, pitch, labS, bandGap } = best;
          const size = pitch * 0.84;
          const pos = (j) => {
            const wk = Math.floor(j / 7), dow = j % 7, band = Math.floor(wk / per), wi = wk % per;
            return orient === "rows" ? [band * (7 * pitch + bandGap) + dow * pitch, labS + wi * pitch] : [labS + wi * pitch, band * (7 * pitch + bandGap) + dow * pitch];
          };
          const used = orient === "rows" ? [best.bands * 7 * pitch + (best.bands - 1) * bandGap, labS + per * pitch] : [labS + per * pitch, best.bands * 7 * pitch + (best.bands - 1) * bandGap];
          const ox = (w - used[0]) / 2, oy = Math.max(0, (hgt - used[1]) / 2);
          const g = s("g", { transform: `translate(${ox.toFixed(1)},${oy.toFixed(1)})` });
          const ls = Math.min(26 * u, pitch * 0.6);
          if (ls >= 22 * u) ["M", "T", "W", "T", "F", "S", "S"].forEach((L, i) => {
            for (let band = 0; band < best.bands; band++) {
              if (orient === "rows") g.append(tx(c, band * (7 * pitch + bandGap) + i * pitch + size / 2, labS - 12 * u, L, { a: "middle", size: ls, w: 700, fill: "var(--ink-2)" }));
              else g.append(tx(c, labS - 12 * u, band * (7 * pitch + bandGap) + i * pitch + size / 2 + ls * 0.36, L, { a: "end", size: ls, w: 700, fill: "var(--ink-2)" }));
            }
          });
          const inS = (day) => S.start && day >= S.start && day <= S.end;
          // one path per kind keeps long histories to a handful of marks
          let dOff = "", dAct = "", dStr = "";
          const rr = (x, y) => `M${x.toFixed(1)},${y.toFixed(1)}h${size.toFixed(1)}v${size.toFixed(1)}h${(-size).toFixed(1)}Z`;
          let bigXY = null;
          D.daily.forEach((d, i) => {
            const [x, y] = pos(i + firstDow);
            if (inS(d.day)) dStr += rr(x, y); else if (activeDay(d)) dAct += rr(x, y); else dOff += rr(x, y);
            if (D.bigDay && d.day === D.bigDay.day) bigXY = [x + size / 2, y + size / 2];
          });
          const sw = Math.max(1.4 * u, Math.min(3 * u, size * 0.06));
          const pOff = s("path", { d: dOff || "M0,0", fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": sw, opacity: 0.6 });
          const pAct = s("path", { d: dAct || "M0,0", fill: hatch(c, "var(--acc)", 45, Math.max(6, Math.min(11, size / 3)), 2), stroke: "var(--acc)", "stroke-width": sw });
          const pStr = s("path", { d: dStr || "M0,0", fill: "var(--acc)", stroke: "var(--acc)", "stroke-width": sw });
          const cid = `pnlclip-${c.uid}`;
          const clipR = s("rect", { x: -2, y: -2, width: 0, height: used[1] + 4 });
          c.defs.append(s("clipPath", { id: cid }, clipR));
          const cells = s("g", { "clip-path": `url(#${cid})` }, pOff, pAct, pStr);
          g.append(cells);
          if (bigXY) { const rr0 = Math.max(size * 0.72, 18 * u), sw0 = Math.max(3.5 * u, size * 0.07); const ring = s("g"); ring.append(s("circle", { cx: bigXY[0], cy: bigXY[1], r: rr0, fill: "none", stroke: "var(--paper)", "stroke-width": sw0 + 5 * u }), s("circle", { cx: bigXY[0], cy: bigXY[1], r: rr0, fill: "none", stroke: "var(--ink)", "stroke-width": sw0 })); g.append(ring); c.tl.pop(ring, 2000, { dur: 700 }); ring.style.transformBox = "fill-box"; ring.style.transformOrigin = "50% 50%"; }
          svg.append(g);
          c.tl.at(300, 1600, "inOut", (q) => clipR.setAttribute("width", (used[0] + 4) * q));
          return svg;
        } };
    });

    // 6. words ------------------------------------------------------------
    card({ id: "words", title: "Words", ch: "voice", dur: 7000 }, (c) => {
      const w0 = V.words[0];
      const k = lab(`Most-used word · ${int(V.prompts)} prompts read`);
      const big = hero(c, w0.key, 300, 110);
      const n = note(c, ["turned up in ", `${int(w0.count)} prompts.`], 64);
      enter(c, [k, big, n], 120, 160);
      const op = V.openers && V.openers[0];
      const opener = op && (c.tall || c.mode === "side") ? h("div", {}, lab("How you open"),
        h("div", { class: "pn-hero", style: { fontSize: px(c, 104, 50), marginTop: px(c, 12, 6) } }, `“${op.key}…”`),
        body(b(`${int(op.count)} prompts`), " start this way. ", b(pct(V.questionShare)), " were questions.")) : null;
      if (opener) c.tl.in(opener, 1900, { y: 24 * c.u });
      return { head: h("div", {}, k, big, n), extra: opener, artMin: 0.3, split: 0.5, legend: "from a fixed dev vocabulary",
        art(w, hgt) { return tracks(c, w, hgt, V.words.slice(0, 5).map((x) => ({ label: x.key, value: x.count, text: `×${int(x.count)}` })), { unit: "PROMPTS", at: 900 }); } };
    });

    // 7. manners ----------------------------------------------------------
    card({ id: "manners", title: "Manners", ch: "voice", dur: 6500 }, (c) => {
      const plz = V.polite.please, ty = V.polite.thanks;
      const k = lab("Manners check");
      const line = (nv, word) => { const num = h("span", {}, int(nv)); c.tl.count(num, 300, 1000, nv); return h("div", { class: "pn-hero", style: { fontSize: px(c, 200, 80), display: "flex", alignItems: "baseline", gap: px(c, 18, 10) } }, num, h("span", { class: "pn-lab", style: { fontSize: px(c, 30), color: "var(--ink)" } }, word)); };
      const a0 = line(plz, plz === 1 ? "please" : "pleases"), b0 = line(ty, ty === 1 ? "thank you" : "thank-yous");
      if (c.tall) [a0, b0].forEach((el) => { el.style.fontSize = px(c, 300, 120); el.lastChild.style.fontSize = px(c, 40); });
      const a = h("div", { style: { display: "flex", flexDirection: c.tall ? "column" : "row", flexWrap: "wrap", columnGap: px(c, 56, 24), marginTop: px(c, 12, 6) } }, a0, b0), bb = null;
      const quip = ty === 0 ? "The agents will live." : plz > ty ? "Polite, mostly." : "Very gracious.";
      const q = note(c, quip, 70);
      const p = body(b(pct(V.questionShare)), " of your prompts were questions.");
      enter(c, [k, a, bb, q, p], 120, 150);
      const L = V.leverage;
      return { head: h("div", {}, k, a, bb, q, p), artMin: 0.3, split: 0.48, legend: L ? "log scale, one decade per step" : "",
        art: L ? (w, hgt) => {
          const u = c.u, svg = box(w, hgt);
          const top = Math.max(2, Math.ceil(Math.log10(Math.max(10, L.toolCalls * 1.2))));
          const x0 = 20 * u, x1 = w - 20 * u, X = (v) => lerp(x0, x1, Math.log10(Math.max(1, v)) / top);
          const S1 = c.tall ? 1.45 : 1, roomAnn = hgt >= 292 * S1 * u, y0 = Math.max(0, (hgt - (roomAnn ? 292 : 212) * S1 * u) / 2), y = y0 + 150 * S1 * u;
          const g = s("g");
          g.append(tx(c, 0, y0 + 24 * u, "SHORTEST PROMPT, BIGGEST JOB", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
          g.append(ln(x0, y, x1, y, { w: 2.4 * u }));
          const lsz = 22 * S1 * u, endL = x1 - tw(int(10 ** top), "mono", lsz) - 16 * u;
          let lastR = -1e9;
          for (let d = 0; d <= top; d++) {
            g.append(ln(X(10 ** d), y, X(10 ** d), y + 22 * S1 * u, { w: 2.4 * u }));
            const lw = tw(int(10 ** d), "mono", lsz), l0 = d === 0 ? X(1) : d === top ? X(10 ** d) - lw : X(10 ** d) - lw / 2;
            if (d === top || (l0 > lastR + 14 * u && l0 + lw < endL)) { g.append(tx(c, X(10 ** d), y + 52 * S1 * u, int(10 ** d), { a: d === 0 ? "start" : d === top ? "end" : "middle", size: lsz, fill: "var(--ink-2)" })); lastR = l0 + lw; }
            if (d < top) for (let m = 2; m < 10; m++) g.append(ln(X(m * 10 ** d), y, X(m * 10 ** d), y + (m === 5 ? 14 : 9) * S1 * u, { w: 1.3 * u }));
          }
          svg.append(g); fade(c, g, 900);
          const mk = (v, txt, col, st, up) => {
            const mg = s("g"), x = X(v), yy = y - 12 * u;
            mg.append(s("path", { d: `M${x},${yy} l${-14 * u},${-24 * u} h${28 * u}Z`, fill: col }));
            mg.append(ln(x, yy - 24 * u, x, yy - up, { stroke: col, w: 2 * u }));
            const size = 54 * S1 * u, wdt = tw(txt, "cond", size);
            const tx_ = clamp(x, x0 + wdt / 2, x1 - wdt / 2);
            mg.append(tx(c, tx_, yy - up - 12 * u, txt, { f: "cond", size, a: "middle", fill: col }));
            svg.append(mg); c.tl.in(mg, st, { y: -30 * u, dur: 700, ease: "spring" });
          };
          mk(L.words, `${L.words} word${L.words === 1 ? "" : "s"}`, "var(--ink)", 1300, 40 * S1 * u);
          mk(L.toolCalls, `${int(L.toolCalls)} tool calls`, "var(--acc)", 1800, 40 * S1 * u);
          const ratio = L.toolCalls / Math.max(1, L.words);
          if (ratio >= 10) {
            const ann = s("g"), xa = X(L.words), xb = X(L.toolCalls), ya = y + 92 * S1 * u;
            if (roomAnn) {
              ann.append(s("path", { d: `M${xa},${ya - 14 * u} Q${(xa + xb) / 2},${ya + 30 * u} ${xb},${ya - 14 * u}`, fill: "none", stroke: "var(--acc)", "stroke-width": 2 * u, "stroke-dasharray": `${8 * u} ${6 * u}` }));
              const str = `×${int(ratio)}, before you said anything else`, size = 36 * S1 * u;
              if (ya + 50 * S1 * u < hgt) ann.append(tx(c, clamp((xa + xb) / 2, tw(str, "hand", size) / 2, w - tw(str, "hand", size) / 2), ya + 46 * S1 * u, str, { f: "hand", size, a: "middle", fill: "var(--acc)" }));
              svg.append(ann); fade(c, ann, 2500);
            }
          }
          return svg;
        } : null };
    });

    // 8. slash ------------------------------------------------------------
    card({ id: "slash", title: "Slash commands", ch: "voice", dur: 6500 }, (c) => {
      const top = D.slash[0] || { key: "/", count: 0 };
      const k = lab("Most-typed slash command");
      const cur = h("span", { style: { display: "inline-block", width: "0.5em", height: "0.78em", background: "var(--acc)", marginLeft: "0.08em", verticalAlign: "-0.04em" } });
      const big = hero(c, [top.key, cur], 210, 80, { mono: true });
      const p = body(b(`${int(top.count)} times`), `, out of ${int(D.slashTotal)} slash commands you typed.`);
      c.tl.in(k, 120).in(big, 260, { x: -40 * c.u, y: 0 }).in(p, 600);
      c.tl.idle((t) => { cur.style.opacity = t < 1000 ? 1 : Math.floor(t / 530) % 2 ? 0 : 1; });
      return { head: h("div", {}, k, big, p), artMin: 0.3, split: 0.5, legend: "built-ins by name",
        art(w, hgt) { return tracks(c, w, hgt, D.slash.map((x) => ({ label: x.key, value: x.count, text: `×${int(x.count)}` })), { mono: true, unit: "TIMES", at: 900 }); } };
    });

    // 9. shell ------------------------------------------------------------
    card({ id: "shell", title: "Hall of fame", ch: "work", dur: 6500 }, (c) => {
      const k = lab("Bash hall of fame");
      const big = heroCount(c, SH.calls, int, null, 280);
      const p = body("shell commands your agents ran. ", b(`${int(T.toolsPerPrompt)} tool calls`), " for every prompt you typed.");
      enter(c, [k, big, p], 120, 160);
      return { head: h("div", {}, k, big, p), artMin: 0.3, split: 0.48, legend: "first program per command",
        art(w, hgt) { return tracks(c, w, hgt, SH.programs.map((x) => ({ label: x.key, value: x.count, text: compact(x.count) })), { mono: true, bars: true, unit: "RUNS", at: 900 }); } };
    });

    // 10. tests -----------------------------------------------------------
    card({ id: "tests", title: "Tests", ch: "work", dur: 6500 }, (c) => {
      const pass = SH.testPass;
      const k = lab("Test runs");
      const big = heroCount(c, SH.tests, int, null, 280);
      const p = body("times your agents ran the tests.", pass != null ? [" ", b(`${pct(pass)} passed`), "."] : "");
      enter(c, [k, big, p], 120, 160);
      const cm = h("div", { class: "pn-ro" }, h("div", { class: "pn-ro-l" }, "Then they shipped"),
        h("div", { style: { display: "flex", alignItems: "center", gap: px(c, 22, 12), padding: `${8 * c.u}px ${14 * c.u}px ${12 * c.u}px` } },
          h("div", { class: "pn-ro-v", style: { fontSize: px(c, 96, 48), padding: 0, flex: "none" } }, h("span", {}, int(T.commits)), h("span", { class: "pn-u" }, "commits")),
          h("div", { class: "pn-body", style: { marginTop: 0, fontSize: px(c, 30, 24), lineHeight: 1.2 } }, b(pct(T.commitShare)), " of your sessions ended with at least one.")));
      const inArt = c.square && c.mode === "stack" && pass != null; // 1:1: the commits sit beside the gauge
      if (!inArt) c.tl.in(cm, 1700, { y: 30 * c.u });
      return { head: h("div", {}, k, big, p), extra: inArt ? null : cm, artMin: 0.3, split: 0.46, legend: pass != null ? "needle = share of runs that passed" : "",
        art: pass != null ? (w, hgt) => {
          const u = c.u, svg = box(w, hgt), lab_ = 44 * u, below = 64 * u, gw = inArt ? w * 0.5 : w, r = gaugeR(gw, hgt, lab_, below);
          const cx = gw / 2, cy = lab_ + r + Math.max(0, (hgt - lab_ - below - 1.5 * r) / 2);
          if (inArt) {
            const px0 = w * 0.54, pw = w - px0, pg = s("g"), ns = Math.min(130 * u, fitPx(int(T.commits), "cond", 130 * u, pw * 0.6));
            pg.append(s("rect", { x: px0, y: 0, width: pw, height: hgt, fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": 2 * u }), ln(px0, 46 * u, w, 46 * u, { w: 1.5 * u, op: 0.4 }));
            pg.append(tx(c, px0 + 16 * u, 32 * u, "THEN THEY SHIPPED", { size: 22 * u, w: 600, ls: 0.13, fill: "var(--ink-2)" }));
            const ny = 60 * u + ns * 0.86;
            pg.append(tx(c, px0 + 16 * u, ny, int(T.commits), { f: "cond", size: ns }), tx(c, px0 + 30 * u + tw(int(T.commits), "cond", ns), ny, "commits", { f: "hand", size: 38 * u, fill: "var(--ink-2)" }));
            const fs = 27 * u, lines = wrap(`${pct(T.commitShare)} of your sessions ended with at least one.`, "text", fs, pw - 32 * u);
            if (ny + 20 * u + lines.length * fs * 1.25 <= hgt) lines.forEach((l, i) => pg.append(tx(c, px0 + 16 * u, ny + 14 * u + fs * 1.1 + i * fs * 1.25, l, { f: "text", size: fs })));
            svg.append(pg); c.tl.in(pg, 1600, { y: 30 * u });
          }
          const g = s("g");
          const ga = gauge(c, g, cx, cy, r, 100, { zone: [0, 50], zoneCol: "var(--c-friction)", step: 25, fmt: (v) => `${v}%`, labSize: r > 160 * u ? 24 : 22, labGap: 34, nw: r > 160 * u ? 6 : 4.5 });
          svg.append(g); fade(c, g, 500, 600);
          const num = tx(c, cx, cy + r * 0.5 + 8 * u, "0%", { a: "middle", f: "cond", size: clamp(r * 0.36, 40 * u, 120 * u) });
          svg.append(num); fade(c, num, 500, 600);
          c.tl.at(900, 1800, "spring", (q) => ga.set(pass * 100 * q));
          c.tl.count(num, 900, 1500, Math.round(pass * 100), (v) => `${int(v)}%`);
          if (r > 110 * u) { const lb = tx(c, cx, cy + r * 0.5 + 50 * u, "PASSED", { a: "middle", size: 22 * u, w: 700, ls: 0.14, fill: "var(--ink-2)" }); svg.append(lb); fade(c, lb, 1500); }
          return svg;
        } : null };
    });

    // 11. danger ----------------------------------------------------------
    card({ id: "danger", title: "Danger", ch: "friction", dur: 6800 }, (c) => {
      const k = lab("Run by your agents");
      const big = hero(c, "Living dangerously.", 170, 70);
      enter(c, [k, big], 120, 160);
      const p = body("Nothing caught fire. Probably.", SH.sleeps ? [" Also ", b(`${int(SH.sleeps)} naps`), " while waiting on something."] : "");
      c.tl.in(p, 2400, { y: 20 * c.u });
      return { head: h("div", {}, k, big), extra: p, artMin: 0.42, split: 0.4, legend: "hatched = the red zone",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          const items = [[SH.rmrf, "rm -rf"], [SH.forcePush, "git push --force"]];
          const row = w / hgt > 1.25, gap = 30 * u;
          const cw = row ? (w - gap) / 2 : w, chh = row ? hgt : (hgt - gap) / 2;
          items.forEach(([v, label], i) => {
            const ox = row ? i * (cw + gap) : 0, oy = row ? 0 : i * (chh + gap);
            const lab_ = 40 * u, below = 60 * u, r = gaugeR(cw, chh, lab_, below);
            const cx = ox + cw / 2, cy = oy + lab_ + r + Math.max(0, (chh - lab_ - below - 1.5 * r) / 2);
            const max = niceMax(Math.max(v, 4) * 1.15, 4), g = s("g");
            const ga = gauge(c, g, cx, cy, r, max, { zone: [max * 0.75, max], zoneCol: "var(--c-friction)", labSize: 22, labGap: 30, nw: r > 140 * u ? 6 : 4.5 });
            svg.append(g);
            fade(c, g, 400 + i * 500, 500);
            c.tl.at(800 + i * 500, 1800, "spring", (q) => ga.set(v * q));
            const num = tx(c, cx, cy + r * 0.5 + 6 * u, "0", { a: "middle", f: "cond", size: clamp(r * 0.42, 44 * u, 150 * u) });
            const lsz = fitPx(label, "mono", 30 * u, cw - 20 * u, 0, 700);
            const lb = tx(c, cx, cy + r * 0.5 + 6 * u + Math.max(lsz, 22 * u) + 14 * u, label, { a: "middle", size: lsz, w: 700, fill: "var(--acc)" });
            svg.append(num, lb);
            fade(c, num, 400 + i * 500, 500);
            c.tl.count(num, 800 + i * 500, 1500, v);
            fade(c, lb, 1100 + i * 500);
          });
          return svg;
        } };
    });

    // 12. parallel --------------------------------------------------------
    card({ id: "parallel", title: "Parallel", ch: "work", dur: 6800 }, (c) => {
      // With lanes the count is the lanes open at the peak (the data layer keeps them equal to max).
      const L = D.parallel.lanes, n = L ? L.atPeak : D.parallel.max;
      const k = lab("Most agents at once");
      const num = h("span", {}, int(n));
      const big = h("div", { class: "pn-hero", style: { fontSize: px(c, 380, 150), lineHeight: 0.8, flex: "none" } }, num);
      c.tl.count(num, 250, 1200, n);
      const side = h("div", { class: "pn-body", style: { marginTop: 0, minWidth: 0 } }, "sessions running side by side. Plus ", b(`${int(D.parallel.subagents)} subagents`), " launched along the way.");
      const row = h("div", { style: { display: "flex", alignItems: "flex-end", gap: px(c, 34, 16), marginTop: px(c, 14, 6) } }, big, side);
      enter(c, [k, row], 120, 160);
      // Real lanes when the recap has them: a channel per session, high while it worked, over a window around the
      // peak. Otherwise identical channels with no time axis, a plain picture of N sessions.
      return { head: h("div", {}, k, row), artMin: 0.34, split: 0.42, legend: L ? `one channel = one session · ${Math.round(L.windowMinutes / 60)} h` : "one channel = one session",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          const rows = L ? L.rows.slice(0, 40) : Array.from({ length: Math.min(n, 40) }, () => ({ start: 0.03, end: 0.99, active: [[0.03, 0.99]], atPeak: true }));
          const m = rows.length, pitch = Math.min(64 * u, (hgt - 110 * u) / m), labels = pitch >= 30 * u;
          const x0 = labels ? tw("CH00", "mono", 22 * u) + 20 * u : 0, x1 = w, X = (f) => lerp(x0, x1, f);
          const y0 = 76 * u;
          const traces = [];
          rows.forEach((r, i) => {
            const y = y0 + i * pitch + pitch * 0.5, hi = y - pitch * 0.3, lo = y + pitch * 0.22;
            let d = `M${x0},${lo.toFixed(1)}`;
            for (const [a, bb] of r.active) d += ` H${X(a).toFixed(1)} V${hi.toFixed(1)} H${Math.max(X(a) + 2 * u, X(bb)).toFixed(1)} V${lo.toFixed(1)}`;
            d += ` H${x1}`;
            const col = r.atPeak ? "var(--ink)" : "var(--ink-2)";
            const p = s("path", { d, fill: "none", stroke: col, "stroke-width": Math.max(2, Math.min(3 * u, pitch * 0.08)), "stroke-linejoin": "miter" });
            const band = s("rect", { x: X(r.start), y: hi, width: Math.max(2 * u, X(r.end) - X(r.start)), height: lo - hi, fill: hatch(c, r.atPeak ? "var(--acc)" : "var(--ink-2)", 45, 10, 2), opacity: 0 });
            svg.append(band, p);
            if (labels) svg.append(tx(c, 0, y + 8 * u, `CH${String(i + 1).padStart(2, "0")}`, { size: 22 * u, fill: "var(--ink-2)" }));
            traces.push([p, band]);
          });
          c.tl.stagger(traces, 900, Math.min(70, 900 / m), ([p, band], st) => { c.tl.draw(p, st, 1300, "inOut"); c.tl.at(st + 1000, 500, "out", (q) => band.setAttribute("opacity", (q * 0.6).toFixed(3))); });
          if (!L) return svg;
          const yEnd = y0 + m * pitch + 8 * u, cur = X(L.peak);
          const cg = s("g");
          cg.append(ln(cur, y0 - 6 * u, cur, yEnd, { stroke: "var(--acc)", w: 3 * u, dash: `${10 * u} ${6 * u}` }));
          cg.append(s("path", { d: `M${cur - 14 * u},${y0 - 22 * u} L${cur + 14 * u},${y0 - 22 * u} L${cur},${y0 - 4 * u}Z`, fill: "var(--acc)" }));
          const lbl = `${n} open at the peak`, lw = tw(lbl, "hand", 40 * u), right = cur + 22 * u + lw <= w;
          cg.append(tx(c, right ? cur + 22 * u : cur - 22 * u, y0 - 18 * u, lbl, { f: "hand", size: 40 * u, fill: "var(--acc)", a: right ? "start" : "end" }));
          svg.append(cg); fade(c, cg, 2500);
          const ax = s("g");
          ax.append(ln(x0, yEnd, x1, yEnd, { w: 2 * u }));
          const hours = Math.max(1, Math.round(L.windowMinutes / 60));
          for (let i = 0; i <= hours; i++) ax.append(ln(lerp(x0, x1, i / hours), yEnd, lerp(x0, x1, i / hours), yEnd + 14 * u, { w: 1.6 * u }));
          if (yEnd + 46 * u <= hgt) ax.append(tx(c, x1, yEnd + 44 * u, "HOURS", { a: "end", size: 22 * u, w: 700, ls: 0.14, fill: "var(--ink-2)" }));
          svg.append(ax); fade(c, ax, 800);
          return svg;
        } };
    });

    // 13. marathon --------------------------------------------------------
    card({ id: "marathon", title: "Marathon", ch: "work", dur: 6500 }, (c) => {
      const L = D.longestSession || { activeMinutes: 0, wallMinutes: 0, prompts: 0, toolCalls: 0, compactions: 0, harness: "" };
      const days = L.wallMinutes / 1440;
      const k = lab("Longest session");
      const big = heroCount(c, L.activeMinutes / 60, one, "hrs", 300);
      const p = body(`of active work in one ${harnessName(L.harness)} session`, days >= 1 ? [", spread over ", b(`${one(days)} days`), "."] : ".");
      // Longer sessions a script or another agent drove are not the person's marathon: say they were left out.
      const skip = L.skippedAutomated > 0 ? h("div", { class: "pn-note", style: { fontSize: px(c, 40, 26), marginTop: px(c, 10, 4) } }, `${int(L.skippedAutomated)} longer automated ${L.skippedAutomated === 1 ? "session" : "sessions"} left out`) : null;
      enter(c, [k, big, p, skip], 120, 160);
      const calls = L.toolCallsCapped ? `${int(L.toolCalls)}+` : capped(L.toolCalls, 99999);
      const ro = readouts(c, [["Prompts", L.prompts], ["Tool calls", calls], ["Resets", L.compactions]], { size: 84, at: 1600 });
      return { head: h("div", {}, k, big, p, skip), extra: ro, artMin: 0.2, split: 0.46, legend: "active = gaps under 10 min",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt), wallH = L.wallMinutes / 60, actH = L.activeMinutes / 60;
          const x0 = 0, x1 = w - 4 * u, X = (v) => lerp(x0, x1, v / Math.max(wallH, actH, 1e-6));
          const bh = clamp((hgt - 150 * u) / 2, 26 * u, (c.tall ? 120 : 56) * u), block = 2 * bh + 150 * u, axisLabels = hgt >= block - 2 * u;
          const ya = 34 * u + Math.max(0, (hgt - block) / 2), yb = ya + bh + 56 * u;
          const g = s("g");
          g.append(tx(c, 0, ya - 14 * u, "ELAPSED", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }), tx(c, 0, yb - 14 * u, "ACTIVE", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
          const ra = s("rect", { x: x0, y: ya, width: X(wallH) - x0, height: bh, fill: hatch(c, "var(--ink)", 45, 11, 1.6), stroke: "var(--ink)", "stroke-width": 2 * u });
          const rb = s("rect", { x: x0, y: yb, width: Math.max(2 * u, X(actH) - x0), height: bh, fill: "var(--acc)", stroke: "var(--acc)", "stroke-width": 2 * u });
          g.append(ra, rb);
          const ea = days >= 1 ? `${one(days)} days` : `${one(wallH)} h`, eb = `${one(actH)} h`;
          g.append(tx(c, X(wallH), ya - 12 * u, ea, { a: "end", f: "cond", size: 40 * u }));
          const ebx = X(actH) + 14 * u + tw(eb, "cond", 40 * u) < w ? X(actH) + 14 * u : X(actH) - 14 * u;
          g.append(tx(c, ebx, yb + bh * 0.5 + 14 * u, eb, { a: ebx > X(actH) ? "start" : "end", f: "cond", size: 40 * u, fill: ebx > X(actH) ? "var(--acc)" : "var(--paper)" }));
          // day ticks along the elapsed bar
          const ys = yb + bh + 16 * u;
          g.append(ln(x0, ys, x1, ys, { w: 2 * u }));
          const unitH = days >= 2 ? 24 : wallH > 12 ? 6 : 1, nt = Math.floor(wallH / unitH);
          const stepL = Math.ceil(nt / 8);
          for (let i = 0; i <= nt; i++) { const x = X(i * unitH); g.append(ln(x, ys, x, ys + (i % stepL === 0 ? 16 : 8) * u, { w: 1.6 * u })); if (axisLabels && i % stepL === 0 && i > 0 && x < x1 - 60 * u) g.append(tx(c, x, ys + 42 * u, unitH === 24 ? `DAY ${i}` : `${i * unitH} H`, { a: "middle", size: 22 * u, fill: "var(--ink-2)" })); }
          svg.append(g);
          fade(c, g, 500);
          c.tl.grow(ra, 700, { axis: "X", origin: "0% 50%", dur: 1200 }).grow(rb, 1300, { axis: "X", origin: "0% 50%", dur: 1000 });
          const share = actH / Math.max(wallH, 1e-6);
          if (share < 0.9 && share > 0) { const str = `${pct(share)} of the clock`, size = 38 * u; const ann = tx(c, Math.min(w - tw(str, "hand", size), X(actH) + 30 * u + (ebx > X(actH) ? tw(eb, "cond", 40 * u) + 14 * u : 0)), yb + bh * 0.5 + 12 * u, str, { f: "hand", size, fill: "var(--acc)" }); if (X(actH) + 30 * u + tw(eb, "cond", 40 * u) + 14 * u + tw(str, "hand", size) < w) { svg.append(ann); fade(c, ann, 2400); } }
          return svg;
        } };
    });

    // 14. failures --------------------------------------------------------
    card({ id: "failures", title: "Failures", ch: "friction", dur: 6800 }, (c) => {
      const FL = D.failures;
      const k = lab("Where things broke");
      const big = heroCount(c, FL.total, int, null, 280);
      const p = body("failed tool calls. Only ", b(`${one(FL.rate * 100)}%`), ` of ${int(FL.calls)}.`);
      enter(c, [k, big, p], 120, 160);
      const esc = h("div", { class: "pn-slab" }, h("div", { class: "pn-lab" }, "The Esc key"), h("div", { class: "pn-hero", style: { fontSize: px(c, 60, 34), marginTop: px(c, 10, 4), whiteSpace: "normal", lineHeight: 1 } }, `You interrupted or steered ${int(D.interrupted)} times.`));
      c.tl.in(esc, 1900, { y: 30 * c.u });
      const named = FL.categories.filter((x) => x.key !== "other");
      const cats = named.slice(0, 4);
      const rest = named.slice(4).reduce((a, x) => a + x.count, 0) + FL.categories.filter((x) => x.key === "other").reduce((a, x) => a + x.count, 0);
      if (rest) cats.push({ key: "other", label: "Everything else", count: rest });
      const tot = Math.max(1, cats.reduce((a, x) => a + x.count, 0));
      return { head: h("div", {}, k, big, p), extra: c.tall || c.mode === "side" ? esc : null, artMin: 0.34, split: 0.44, legend: "share of failed calls",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          const fills = ["var(--acc)", hatch(c, "var(--acc)", 45, 10, 2.4), hatch(c, "var(--ink)", -45, 10, 1.8), hatch(c, "var(--ink)", 0, 9, 1.6), "var(--paper)"];
          const bh = clamp(hgt * 0.13, 40 * u, (c.tall ? 150 : 90) * u), yb = 60 * u;
          const g = s("g");
          propBar(c, g, cats.map((x, i) => ({ share: x.count / tot, fill: fills[i] })), 0, w, yb, bh, { at: 800 });
          svg.append(g);
          // legend table under the bar
          const top = yb + bh + 24 * u, avail = hgt - top, pitch = Math.min((c.tall ? 104 : 70) * u, avail / cats.length);
          const nShow = pitch >= 36 * u ? cats.length : Math.max(1, Math.floor(avail / (36 * u)));
          const pp = Math.max(pitch, 36 * u);
          const fs = clamp(pp * 0.5, 24 * u, (c.tall ? 46 : 38) * u);
          cats.slice(0, nShow).forEach((x, i) => {
            const y = top + i * pp, rg = s("g");
            rg.append(ln(0, y, w, y, { w: 1.2 * u, op: 0.45 }));
            rg.append(s("rect", { x: 0, y: y + pp / 2 - 13 * u, width: 26 * u, height: 26 * u, fill: fills[i], stroke: "var(--ink)", "stroke-width": 2 * u }));
            const val = pct(x.count / tot), vw = tw(val, "mono", fs, 0, 700);
            const lsz = fitPx(x.label, "cond", fs * 1.15, w - 50 * u - vw - 24 * u);
            rg.append(tx(c, 42 * u, y + pp / 2 + lsz * 0.34, x.label, { f: "cond", size: lsz }), tx(c, w, y + pp / 2 + fs * 0.36, val, { a: "end", size: fs, w: 700 }));
            svg.append(rg); fade(c, rg, 1500 + i * 120, 400);
          });
          return svg;
        } };
    });

    // 15. nemesis ---------------------------------------------------------
    card({ id: "nemesis", title: "Nemesis", ch: "friction", dur: 6500 }, (c) => {
      const NM = D.failures.nemesis, nm = NM[0] || { key: "", count: 0, runs: 0 };
      const k = lab("Your agent's nemesis");
      const big = hero(c, nm.key, 220, 80, { mono: true });
      const p = body("failed ", b(`${int(nm.count)} times`), ` in ${int(nm.runs)} runs.`);
      c.tl.in(k, 120).in(big, 240, { y: 0, sc: 1.4, dur: 800 }).in(p, 700);
      c.tl.at(1000, 500, "lin", (q) => { big.style.translate = `${(Math.sin(q * Math.PI * 8) * (1 - q) * 16 * c.u).toFixed(2)}px 0`; });
      return { head: h("div", {}, k, big, p), artMin: 0.32, split: 0.48, legend: "fail rate = fails / runs",
        art(w, hgt) {
          const rows = NM.map((x) => ({ label: x.key, value: x.count / Math.max(1, x.runs), text: `${int(x.count)} / ${capped(x.runs, 999999)}` }));
          const mx = Math.max(...rows.map((r) => r.value), 0.01);
          return tracks(c, w, hgt, rows.map((r) => ({ ...r })), { mono: true, max: niceMax(mx * 100, 2) / 100, unit: "FAILS / RUNS", at: 900, scaleFmt: pct });
        } };
    });

    // 16. model -----------------------------------------------------------
    card({ id: "model", title: "Model", ch: "work", dur: 6800 }, (c) => {
      const M = D.models;
      const k = lab(`Top model · of ${int(U.requests)} requests`);
      const big = hero(c, M[0].key, 190, 70);
      const n = note(c, `answered ${pct(M[0].share)} of them.`, 64);
      enter(c, [k, big, n], 120, 160);
      return { head: h("div", {}, k, big, n), artMin: 0.36, split: 0.46, legend: "share of model requests",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          const fills = ["var(--acc)", hatch(c, "var(--ink)", 45, 11, 2), hatch(c, "var(--ink)", -45, 9, 1.6), "var(--ink)"];
          const bh = clamp(hgt * 0.18, 50 * u, (c.tall ? 200 : 110) * u), yb = 64 * u;
          const g = s("g");
          propBar(c, g, M.map((m, i) => ({ share: m.share, fill: fills[i] || "var(--ink)" })), 0, w, yb, bh, { at: 800 });
          svg.append(g);
          const top = yb + bh + 40 * u, avail = hgt - top - 34 * u;
          const pitch = Math.min((c.tall ? 150 : 76) * u, avail / M.length), nShow = pitch >= 40 * u ? M.length : Math.max(1, Math.floor(avail / (40 * u)));
          const pp = Math.max(pitch, 40 * u), fs = clamp(pp * 0.55, 26 * u, 56 * u);
          const tb = s("g");
          if (avail > 44 * u) {
            const hx = w * 0.62;
            tb.append(tx(c, 0, top + 2 * u, "MODEL", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }), tx(c, w, top + 2 * u, "REQUESTS", { a: "end", size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
            const showH = w > 640 * u;
            if (showH) tb.append(tx(c, hx, top + 2 * u, "HARNESS", { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
            M.slice(0, nShow).forEach((m, i) => {
              const y = top + 18 * u + i * pp;
              tb.append(ln(0, y, w, y, { w: (i === 0 ? 2 : 1.2) * u, op: i === 0 ? 1 : 0.5 }));
              tb.append(s("rect", { x: 0, y: y + pp / 2 - 14 * u, width: 28 * u, height: 28 * u, fill: fills[i] || "var(--ink)", stroke: "var(--ink)", "stroke-width": 2 * u }));
              const req = int(m.requests), rw = tw(req, "mono", fs * 0.7, 0, 700);
              const nameW = (showH ? hx : w - rw) - 44 * u - 20 * u;
              tb.append(tx(c, 44 * u, y + pp / 2 + fs * 0.34, m.key, { f: "cond", size: fitPx(m.key, "cond", fs, nameW) }));
              if (showH) tb.append(tx(c, hx, y + pp / 2 + 9 * u, harnessName(m.harness), { size: fitPx(harnessName(m.harness), "mono", 24 * u, w - hx - rw - 24 * u), fill: "var(--ink-2)" }));
              tb.append(tx(c, w, y + pp / 2 + fs * 0.25, req, { a: "end", size: Math.max(22 * u, fs * 0.7), w: 700 }));
            });
          }
          svg.append(tb); fade(c, tb, 1700, 600);
          return svg;
        } };
    });

    // 17. tokens ----------------------------------------------------------
    card({ id: "tokens", title: "Tokens", ch: "work", dur: 6800 }, (c) => {
      const k = lab("Tokens processed");
      const big = heroCount(c, U.tokens, compact, null, 300);
      const p = U.cacheHitRate != null ? body(b(pct(U.cacheHitRate)), " of input came straight from cache.") : null;
      enter(c, [k, big, p], 120, 160);
      const money = priced ? readouts(c, [["At list prices", `$${int(U.usd)}`], ...(U.usdPerCommit ? [["Per commit", `$${one(U.usdPerCommit)}`]] : [])], { size: 90, at: 1900 }) : null;
      const nNov = Math.round(U.novels || 0);
      return { head: h("div", {}, k, big, p), extra: money, artMin: 0.26, split: 0.46, legend: U.unpriced && priced ? `${int(U.unpriced)} requests unpriced` : "one stroke = one novel",
        art: nNov > 0 ? (w, hgt) => {
          const u = c.u, svg = box(w, hgt);
          // tally marks, gates of five; past 150 strokes one stroke stands for several novels
          const per = nNov > 150 ? Math.ceil(nNov / 150) : 1, strokes = Math.ceil(nNov / per), gates = Math.ceil(strokes / 5);
          const capH = 64 * u, ah = hgt - capH - 10 * u;
          let best = null;
          for (let cols = 1; cols <= gates; cols++) {
            const rows = Math.ceil(gates / cols), gw = w / cols, gh = ah / rows, sz = Math.min(gw / 1.25, gh / 1.15, 120 * u);
            if (!best || sz > best.sz) best = { cols, rows, sz, gw: sz * 1.25, gh: sz * 1.15 };
          }
          const { cols, sz, gw, gh } = best, ox = (w - cols * gw) / 2 + sz * 0.12, rr2 = rng(nNov * 31 + 7);
          const marks = [];
          for (let i = 0; i < strokes; i++) {
            const gi = Math.floor(i / 5), j = i % 5, gx = ox + (gi % cols) * gw, gy = Math.floor(gi / cols) * gh + gh * 0.08;
            const jx = (rr2() - 0.5) * sz * 0.06, jy = (rr2() - 0.5) * sz * 0.08;
            const m = j < 4 ? ln(gx + j * sz * 0.22 + jx, gy + jy, gx + j * sz * 0.22 - jx, gy + sz + jy, { w: Math.max(2.4 * u, sz * 0.055), cap: "round", stroke: "var(--ink)" })
              : ln(gx - sz * 0.12, gy + sz * 0.78, gx + sz * 0.8, gy + sz * 0.2, { w: Math.max(2.4 * u, sz * 0.055), cap: "round", stroke: "var(--acc)" });
            svg.append(m); marks.push(m);
          }
          c.tl.stagger(marks, 700, Math.min(30, 1600 / strokes), (m, st) => c.tl.draw(m, st, 220, "out"));
          const str = `The agents wrote about ${int(nNov)} novels of output${per > 1 ? `. One stroke = ${per}.` : "."}`;
          const size = fitPx(str, "hand", 42 * u, w);
          const cap = tx(c, 0, hgt - 16 * u, str, { f: "hand", size: Math.max(size, 30 * u) });
          if (size >= 30 * u) { svg.append(cap); fade(c, cap, 2400); }
          else { const a1 = tx(c, 0, hgt - 16 * u, `About ${int(nNov)} novels of output${per > 1 ? `, ${per} per stroke` : ""}.`, { f: "hand", size: 34 * u }); svg.append(a1); fade(c, a1, 2400); }
          return svg;
        } : null };
    });

    // 18. persona ---------------------------------------------------------
    card({ id: "persona", title: "Persona", ch: "findings", dur: 7500, squareSide: true }, (c) => {
      const P = D.persona;
      const k = lab("You are");
      const t1 = hero(c, `The ${P.time}`, 180, 48);
      const t2 = hero(c, `${P.role}.`, 180, 48, { mt: 6 });
      t2.style.color = "var(--c-rhythm)";
      const p = body(P.reason.charAt(0).toUpperCase() + P.reason.slice(1));
      c.tl.in(k, 1500).in(t1, 1650, { y: 40 * c.u }).in(t2, 1800, { y: 40 * c.u }).in(p, 2200);
      return { head: h("div", {}, k, t1, t2, p), artFirst: true, artMin: 0.36, split: 0.5, legend: "specimen: 24 hours × every day",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt), half = Math.min(w, hgt) / 2, Rr = Math.max(40 * u, half > 330 * u ? half - 110 * u : half * 0.74), cx = w / 2, cy = hgt / 2;
          const g = s("g");
          g.append(s("circle", { cx, cy, r: Rr, fill: "none", stroke: "var(--ink)", "stroke-width": 2 * u }), s("circle", { cx, cy, r: Rr * 0.74, fill: "none", stroke: "var(--ink)", "stroke-width": 1.2 * u, "stroke-dasharray": `${3 * u} ${6 * u}` }));
          g.append(ln(cx - Rr - 36 * u, cy, cx + Rr + 36 * u, cy, { w: 1, op: 0.5 }), ln(cx, cy - Rr - 36 * u, cx, cy + Rr + 36 * u, { w: 1, op: 0.5 }));
          // day ticks round the rim (weekly bins past 150 days)
          const { size, bins } = binned(D.daily.map((d) => d.prompts));
          const maxP = Math.max(...bins.map((x) => x.v), 1);
          const ticks = bins.map((bn, i) => {
            const a = (i / bins.length) * Math.PI * 2 - Math.PI / 2, act = bn.v > 0, len = act ? Rr * (0.08 + 0.22 * Math.sqrt(bn.v / maxP)) : Rr * 0.03;
            const t = ln(cx + Math.cos(a) * Rr, cy + Math.sin(a) * Rr, cx + Math.cos(a) * (Rr + len), cy + Math.sin(a) * (Rr + len), { stroke: act ? "var(--c-rhythm)" : "var(--ink)", w: act ? clamp((Math.PI * 2 * Rr) / bins.length * 0.45, 2 * u, 7 * u) : 1.6 * u });
            g.append(t); return t;
          });
          const mx = Math.max(...R.hours, 1);
          const pts = R.hours.map((v, hr) => { const a = (hr / 24) * Math.PI * 2 - Math.PI / 2, rad = Rr * 0.16 + Rr * 0.54 * Math.sqrt(v / mx); return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]; });
          const blob = s("path", { d: smooth(pts, true, 0.9), fill: hatch(c, "var(--ink)", 45, 11, 2), stroke: "var(--ink)", "stroke-width": 3.5 * u, "stroke-linejoin": "round" });
          g.append(blob);
          const spokes = [], nA = Math.min(D.parallel.max, 40);
          for (let i = 0; i < nA; i++) {
            const a = ((R.peakHour - 1.5 + (3 * i) / Math.max(1, nA - 1)) / 24) * Math.PI * 2 - Math.PI / 2;
            const sp = ln(cx + Math.cos(a) * Rr * 0.78, cy + Math.sin(a) * Rr * 0.78, cx + Math.cos(a) * Rr * 0.92, cy + Math.sin(a) * Rr * 0.92, { stroke: "var(--c-work)", w: 5 * u });
            g.append(sp); spokes.push(sp);
          }
          g.append(s("circle", { cx, cy, r: Rr * 0.05, fill: "var(--c-friction)" }));
          svg.append(g);
          c.tl.draw(blob, 300, 1400); c.tl.at(300, 1400, "inOut", (q) => { blob.style.fillOpacity = q; });
          c.tl.stagger(ticks, 400, Math.min(30, 1000 / ticks.length), (t, st) => c.tl.draw(t, st, 400, "out"));
          c.tl.stagger(spokes, 1300, 50, (t, st) => c.tl.draw(t, st, 300, "out"));
          // labelled parts, only when there is room beside the plate
          if (Rr > 150 * u) {
            const ann = s("g"), sz = 38 * u, d45 = Math.SQRT1_2;
            const put = (ax, ay, x, y, str, a) => { if (x - (a === "end" ? tw(str, "hand", sz) : 0) >= 0 && x + (a === "end" ? 0 : tw(str, "hand", sz)) <= w && y - sz >= 0 && y <= hgt) annot(c, ann, ax, ay, x, y, str, { a, size: sz }); };
            put(cx + Rr * d45 + 14 * u, cy - Rr * d45 - 14 * u, cx + Rr * d45 + 50 * u, cy - Rr * d45 - 44 * u, size > 1 ? "weeks" : "days", "start");
            put(cx + Rr * 0.3, cy + Rr * 0.2, cx + Rr + 30 * u, cy + Rr * 0.62, "hours", "start");
            const pa = ((R.peakHour) / 24) * Math.PI * 2 - Math.PI / 2;
            put(cx + Math.cos(pa) * Rr * 0.85, cy + Math.sin(pa) * Rr * 0.85, Math.cos(pa) < 0 ? cx - Rr - 20 * u : cx + Rr + 20 * u, cy + Math.sin(pa) * Rr * 0.85 - 30 * u, "agents", Math.cos(pa) < 0 ? "end" : "start");
            svg.append(ann); fade(c, ann, 2000);
          }
          return svg;
        } };
    });

    // 19. tips ------------------------------------------------------------
    card({ id: "tips", title: "Try next", ch: "findings", dur: 8000 }, (c) => {
      const WHY = {
        history_retention: (m) => (/session/i.test(m.unit) ? `${int(m.value)} transcripts can be deleted this week.` : `History kept: ${int(m.value)} days.`),
        context_resets: (m) => `${int(m.value)} context compactions in ${int(D.range.days)} days.`,
        slow_correction: (m) => `You usually step in after ${one(m.value)} minutes.`,
        repeated_failed_command: (m) => `One command failed ${int(m.value)} times running.`,
        long_sessions: (m) => `${int(m.value)} sessions ran very long.`,
        frequent_interruptions: (m) => `${int(m.value)} interruptions.`,
      };
      const tips = (D.tips || []).slice(0, 3);
      const k = lab(`${tips.length} ${tips.length === 1 ? "thing" : "things"} to try next`);
      const tt = hero(c, "Your next level.", 150, 70);
      enter(c, [k, tt], 120, 160);
      return { head: h("div", {}, k, tt), artMin: 0.48, split: 0.36, legend: "from your findings", center: false,
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt), n = Math.max(1, tips.length), rowH = Math.min((c.tall ? 380 : 260) * u, hgt / n);
          const numW = clamp(rowH * 0.42, 60 * u, 110 * u);
          tips.forEach((tip, i) => {
            const y = i * rowH, g = s("g");
            g.append(ln(0, y + 2 * u, w, y + 2 * u, { w: 2.4 * u }));
            g.append(tx(c, 0, y + numW * 0.95 + 14 * u, String(i + 1).padStart(2, "0"), { f: "cond", size: numW, fill: ["var(--c-rhythm)", "var(--c-work)", "var(--c-friction)"][i] }));
            const tx0 = numW * 1.1 + 22 * u, tw0 = w - tx0 - 60 * u;
            // title wraps to two lines at most; size down before dropping the why-line
            const words = tip.title.split(" ");
            let ts = clamp(rowH * 0.24, 34 * u, (c.tall ? 72 : 60) * u), lines;
            for (;;) {
              lines = []; let cur = "";
              for (const wd of words) { const nx = cur ? cur + " " + wd : wd; if (tw(nx, "cond", ts) > tw0 && cur) { lines.push(cur); cur = wd; } else cur = nx; }
              lines.push(cur);
              if ((lines.length <= 2 && Math.max(...lines.map((l) => tw(l, "cond", ts))) <= tw0) || ts <= 30 * u) break;
              ts -= 2 * u;
            }
            lines.forEach((l, j) => g.append(tx(c, tx0, y + 24 * u + ts * 0.86 + j * ts * 0.98, l, { f: "cond", size: ts })));
            const why = tip.metric && WHY[tip.kind] ? WHY[tip.kind](tip.metric) : null;
            const wy = y + 24 * u + ts * 0.86 + lines.length * ts * 0.98 + 14 * u;
            if (why && wy + 4 * u <= y + rowH) g.append(tx(c, tx0, wy + (c.tall ? 10 : 0) * u, why, { f: "text", size: fitPx(why, "text", (c.tall ? 36 : 30) * u, tw0), fill: "var(--ink-2)" }));
            // checkbox, ticked by hand
            const bx = w - 40 * u, by = y + 26 * u;
            g.append(s("rect", { x: bx, y: by, width: 40 * u, height: 40 * u, fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": 2.4 * u }));
            svg.append(g);
            c.tl.in(g, 600 + i * 260, { y: 40 * u, dur: 650 });
          });
          return svg;
        } };
    });

    // 20. summary ---------------------------------------------------------
    card({ id: "summary", title: "Summary", ch: "findings", dur: 9000, bigMark: true }, (c) => {
      const k = lab(D.range.from.startsWith(YEAR) ? `Logbook summary · ${YEAR}` : "Logbook summary");
      const dd = `${D.range.days} ${D.range.days === 1 ? "day" : "days"}`;
      const tt = c.mode === "side" ? h("div", {}, hero(c, "My last", 210, 90), hero(c, dd, 210, 90, { mt: 0 })) : hero(c, `My last ${dd}`, c.tall ? 170 : 140, 70);
      const n = note(c, "with AI, logged.", c.mode === "side" ? 84 : c.tall ? 80 : 60);
      n.style.color = "var(--c-rhythm)";
      c.tl.in(k, 100, { y: 20 * c.u }).in(tt, 200, { y: 30 * c.u }).in(n, 350, { y: 20 * c.u });
      return { head: h("div", {}, k, tt, n), artMin: c.tall ? 0.6 : 0.52, split: 0.34, legend: `${SHARE.skill}  ${SHARE.hashtag}`, center: c.mode === "side",
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt), GAP = 14 * u, ar = w / hgt;
          const L = ar >= 1.75 ? { rows: [["rhythm", "voice", "friction"], ["work", "hours", "prompts", "model"], ["persona"]], wt: [1.3, 0.85, 0.55] }
            : ar >= 1.3 ? { rows: [["rhythm", "voice", "friction"], ["work", "hours", "prompts"], ["persona:2", "model"]], wt: [1.25, 0.9, 0.62] }
              : ar >= 0.95 ? { rows: [["rhythm", "voice"], ["friction", "work"], ["hours", "prompts", "model"], ["persona"]], wt: [1.1, 1.1, 0.72, 0.5] }
                : { rows: [["rhythm", "voice"], ["friction", "work"], ["hours", "prompts"], ["model"], ["persona"]], wt: [1.25, 1.25, 0.8, 0.5, 0.55] };
          const tot = L.wt.reduce((a, x) => a + x, 0), availH = hgt - GAP * (L.rows.length - 1);
          const cells = [];
          let y = 0;
          L.rows.forEach((row, ri) => {
            const chh = (availH * L.wt[ri]) / tot;
            const units = row.reduce((a, id) => a + (+(id.split(":")[1] || 1)), 0), cwU = (w - GAP * (units - 1)) / units;
            let x = 0;
            row.forEach((sp) => { const [id, span] = sp.split(":"), nU = +span || 1, cw = cwU * nU + GAP * (nU - 1); cells.push({ id, x, y, w: cw, h: chh }); x += cw + GAP; });
            y += chh + GAP;
          });
          const w0 = V.words[0], vmax = Math.max(...V.words.map((x) => x.count), 1);
          const DEF = {
            rhythm: { label: "Rhythm", col: "var(--c-rhythm)", value: R.verdict.label, sub: `peak ${hh(R.peakHour)}`,
              gfx(g, gx, gy, gw, gh) {
                const r = Math.min(gw, gh) / 2 - 6 * u; if (r < 40 * u) return false;
                const pp = polarPlot(c, g, gx + gw / 2, gy + gh / 2, r, Math.max(6 * u, r * 0.16), { labels: false, sw: 3 });
                pp.traces.forEach((t, i) => { if (i === 0) { t.setAttribute("stroke", "var(--c-rhythm)"); t.setAttribute("fill", hatch(c, "var(--c-rhythm)", 45, 9, 1.8)); } });
                return true;
              } },
            voice: { label: "Voice", col: "var(--c-voice)", value: w0.key, sub: `${int(w0.count)} prompts`,
              gfx(g, gx, gy, gw, gh) {
                const nb = Math.min(3, V.words.length, Math.floor(gh / (40 * u))); if (nb < 2 || gw < 160 * u) return false;
                const lw = Math.max(...V.words.slice(0, nb).map((x) => tw(x.key, "cond", 26 * u))) + 14 * u, pitch = Math.min(56 * u, gh / nb);
                V.words.slice(0, nb).forEach((wd, i) => {
                  const yy = gy + pitch * (i + 0.5), a = gx + lw, bb = gx + gw - 10 * u, e = lerp(a, bb, wd.count / vmax);
                  g.append(tx(c, gx, yy + 9 * u, wd.key, { f: "cond", size: 26 * u }), ln(a, yy, bb, yy, { w: 1.2 * u, op: 0.6 }), ln(a, yy, e, yy, { stroke: "var(--c-voice)", w: 5 * u }), s("circle", { cx: e, cy: yy, r: 7 * u, fill: i === 0 ? "var(--c-voice)" : "var(--paper)", stroke: "var(--c-voice)", "stroke-width": 3 * u }));
                });
                return true;
              } },
            friction: { label: "Friction", col: "var(--c-friction)", value: int(SH.rmrf), sub: "rm -rf", subMono: true,
              gfx(g, gx, gy, gw, gh) {
                const r = gaugeR(gw, gh, 6 * u, 6 * u); if (r < 44 * u) return false;
                const v = SH.rmrf, max = niceMax(Math.max(v, 4) * 1.15, 4), cx = gx + gw / 2, cy = gy + 6 * u + r + (gh - 12 * u - 1.5 * r) / 2;
                const ga = gauge(c, g, cx, cy, r, max, { zone: [max * 0.75, max], zoneCol: "var(--c-friction)", needleCol: "var(--c-friction)", labels: false, nw: 4 });
                c.tl.at(1000, 1600, "spring", (q) => ga.set(v * q));
                return true;
              } },
            work: { label: "Agents at once", short: "Agents", col: "var(--c-work)", value: int(D.parallel.max), sub2: `+${int(D.parallel.subagents)} subagents`,
              gfx(g, gx, gy, gw, gh) {
                const nL = Math.min(D.parallel.max, 14), pitch = Math.min(22 * u, gh / nL); if (pitch < 7 * u || gw < 120 * u) return false;
                const L = D.parallel.lanes, y0 = gy + (gh - nL * pitch) / 2;
                for (let i = 0; i < nL; i++) { const a = L && L[i] ? gx + L[i][0] * gw : gx, bb = L && L[i] ? gx + L[i][1] * gw : gx + gw, yy = y0 + pitch * (i + 0.5); g.append(ln(a, yy, bb, yy, { stroke: i % 2 ? "var(--ink)" : "var(--c-work)", w: Math.max(2 * u, pitch * 0.5), cap: "round" })); }
                return true;
              } },
            hours: { label: "Hours w/ agents", short: "Hours", value: int(T.wallHours), unit: "h" },
            prompts: { label: "Prompts", value: int(T.prompts) },
            model: { label: "Top model", value: D.models[0].key, small: true },
          };
          const drawn = [];
          for (const cl of cells) {
            const { x, y: y0, w: cw, h: chh } = cl, g = s("g");
            if (cl.id === "persona") {
              g.append(s("rect", { x, y: y0, width: cw, height: chh, fill: "var(--ink)" }));
              const big = chh >= 110 * u;
              const ps = Math.max(28 * u, Math.min(fitPx(D.persona.title, "cond", 104 * u, cw - 52 * u - (big ? 0 : 150 * u)), (chh - (big ? 52 : 20) * u) * 0.92));
              if (big) { g.append(tx(c, x + 26 * u, y0 + 36 * u, "PERSONA", { size: 22 * u, w: 700, ls: 0.14, fill: "#c9ccd3" })); g.append(tx(c, x + 26 * u, y0 + 44 * u + (chh - 44 * u) / 2 + ps * 0.34, D.persona.title, { f: "cond", size: ps, fill: "var(--paper)" })); }
              else { g.append(tx(c, x + 26 * u, y0 + chh / 2 + 8 * u, "PERSONA", { size: 22 * u, w: 700, ls: 0.14, fill: "#c9ccd3" })); g.append(tx(c, x + 176 * u, y0 + chh / 2 + ps * 0.34, D.persona.title, { f: "cond", size: ps, fill: "var(--paper)" })); }
              svg.append(g); drawn.push(g); continue;
            }
            const d = DEF[cl.id];
            g.append(s("rect", { x, y: y0, width: cw, height: chh, fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": 2 * u }));
            const lbl = (tw(d.label.toUpperCase(), "mono", 22 * u, 0.12, 700) <= cw - (d.col ? 60 : 32) * u ? d.label : d.short || d.label).toUpperCase();
            if (d.col) g.append(s("rect", { x: x + 16 * u, y: y0 + 16 * u, width: 18 * u, height: 18 * u, fill: d.col }));
            g.append(tx(c, x + (d.col ? 44 : 16) * u, y0 + 33 * u, lbl, { size: 22 * u, w: 700, ls: 0.12, fill: "var(--ink-2)" }));
            const top = y0 + 50 * u, bot = y0 + chh - 14 * u, ch_ = bot - top;
            const besideG = d.gfx && cw >= 360 * u && ch_ >= 90 * u;
            const textW = besideG ? (cw - 32 * u) * 0.56 : cw - 32 * u - (d.unit ? 34 * u : 0);
            const subS = d.sub ? (d.subMono ? 24 * u : 36 * u) : 0;
            let sub2S = d.sub2 ? 22 * u : 0, inline = false;
            const textBlock = (vs) => vs * 0.9 + (subS && !inline ? subS * 1.15 : 0) + (sub2S ? sub2S * 1.5 : 0);
            const vMax = Math.min(fitPx(d.value, "cond", d.small ? 64 * u : 140 * u, textW), d.small ? 64 * u : 140 * u);
            let vs = vMax;
            while (vs > 30 * u && textBlock(vs) > ch_) vs -= 2 * u;
            if (sub2S && vs < vMax * 0.75) { sub2S = 0; vs = vMax; while (vs > 30 * u && textBlock(vs) > ch_) vs -= 2 * u; } // drop the second line before shrinking the value
            if (subS && vs < vMax * 0.75) { // short cell: the note goes beside the value
              inline = true; vs = vMax; while (vs > 30 * u && textBlock(vs) > ch_) vs -= 2 * u;
              if (tw(d.value, "cond", vs) + 16 * u + tw(d.sub, d.subMono ? "mono" : "hand", subS) > cw - 32 * u) { inline = false; vs = vMax; while (vs > 30 * u && textBlock(vs) > ch_) vs -= 2 * u; }
            }
            const remain = ch_ - textBlock(vs);
            const gfxBelow = d.gfx && !besideG && remain >= 90 * u;
            const ty0 = gfxBelow ? top : top + Math.max(0, (ch_ - textBlock(vs)) / 2);
            let yy = ty0 + vs * 0.86;
            g.append(tx(c, x + 16 * u, yy, d.value, { f: "cond", size: vs }));
            if (d.unit) g.append(tx(c, x + cw - 16 * u, yy, d.unit, { f: "hand", size: 40 * u, a: "end", fill: "var(--ink-2)" }));
            if (d.sub && inline) g.append(tx(c, x + 32 * u + tw(d.value, "cond", vs), yy, d.sub, { f: d.subMono ? "mono" : "hand", size: subS, w: d.subMono ? 700 : undefined, fill: d.subMono ? d.col : "var(--ink)" }));
            else if (d.sub) { yy += subS * 1.15; g.append(tx(c, x + 16 * u, yy, d.sub, { f: d.subMono ? "mono" : "hand", size: Math.max(22 * u, Math.min(subS, fitPx(d.sub, d.subMono ? "mono" : "hand", subS, textW, 0, d.subMono ? 700 : undefined))), w: d.subMono ? 700 : undefined, fill: d.subMono ? d.col : "var(--ink)" })); }
            if (sub2S && tw(d.sub2, "mono", 22 * u) <= textW) { yy += sub2S * 1.5; g.append(tx(c, x + 16 * u, yy, d.sub2, { size: 22 * u, fill: "var(--ink-2)" })); }
            const usedW = Math.max(tw(d.value, "cond", vs), d.sub ? tw(d.sub, d.subMono ? "mono" : "hand", subS) : 0, sub2S ? tw(d.sub2, "mono", 22 * u) : 0);
            if (besideG) d.gfx(g, x + 16 * u + textW + 12 * u, top, cw - 32 * u - textW - 12 * u, ch_);
            else if (gfxBelow) d.gfx(g, x + 16 * u, yy + 14 * u, cw - 32 * u, bot - yy - 14 * u);
            else if (d.gfx && cw - 32 * u - usedW - 20 * u >= 110 * u) d.gfx(g, x + 16 * u + usedW + 20 * u, top, cw - 32 * u - usedW - 20 * u, ch_); // room beside the value
            svg.append(g); drawn.push(g);
          }
          drawn.forEach((g, i) => c.tl.in(g, 600 + i * 110, { y: 24 * u, dur: 600 }));
          return svg;
        } };
    });

    // optional cards: offered only when their data exists, never in the default selection ----------------
    /** A unit so that n items need at most `max` marks: 1, 2, 5, 10, 20, 50, ... */
    const unitFor = (n, max = 150) => { let q = 1; for (const step of [2, 2.5, 2]) { if (Math.ceil(n / q) <= max) break; q *= step; } while (Math.ceil(n / q) > max) q *= 10; return q; };
    const dur = (ms) => (ms >= 3_600_000 ? [one(ms / 3_600_000), "hrs"] : ms >= 60_000 ? [int(ms / 60_000), "min"] : [int(ms / 1000), "sec"]);
    /** n marks on a grid: circles or squares, hatched with the chapter colour, drawn in order. */
    function markGrid(c, n, w, hgt, shape) {
      const u = c.u, svg = box(w, hgt), g = kit.cellGrid(n, w, hgt, 0.3), sz = g.size;
      const ox = (w - (g.cols * sz + (g.cols - 1) * g.gap)) / 2, oy = (hgt - (g.rows * sz + (g.rows - 1) * g.gap)) / 2;
      const marks = Array.from({ length: n }, (_, i) => {
        const x = ox + (i % g.cols) * (sz + g.gap), y = oy + Math.floor(i / g.cols) * (sz + g.gap), sw = Math.max(1.6 * u, sz * 0.06);
        const m = shape === "circle" ? s("circle", { cx: x + sz / 2, cy: y + sz / 2, r: sz / 2 - sw, fill: hatch(c, "var(--acc)", 45, 9, 2), stroke: "var(--ink)", "stroke-width": sw })
          : s("rect", { x: x + sw / 2, y: y + sw / 2, width: sz - sw, height: sz - sw, fill: hatch(c, "var(--acc)", 45, 9, 2), stroke: "var(--ink)", "stroke-width": sw });
        svg.append(m); return m;
      });
      c.tl.stagger(marks, 700, Math.min(25, 1300 / n), (m, st) => c.tl.in(m, st, { y: 10 * u, dur: 400 }));
      return svg;
    }

    if (D.thinking) card({ id: "thinking", title: "Deep thoughts", ch: "work", dur: 6000 }, (c) => {
      const TH = D.thinking, timed = TH.totalMs != null;
      const k = lab("Deep thoughts");
      const [v, unit] = timed ? dur(TH.totalMs) : [compact(TH.blocks), null];
      const big = hero(c, [h("span", {}, v), unit ? h("span", { class: "pn-u" }, unit) : null], 300, 110);
      const p = body(timed ? ["of thinking before answering, over ", b(`${compact(TH.blocks)} thoughts`), "."] : "times the model stopped to think before answering.");
      enter(c, [k, big, p], 120, 160);
      const ro = TH.longestMs != null ? readouts(c, [["Longest think", dur(TH.longestMs).join(" ")], ["Sessions", TH.sessions]], { size: 84, at: 1600 }) : null;
      const per = unitFor(TH.blocks);
      return { head: h("div", {}, k, big, p), extra: ro, artMin: 0.26, split: 0.46, legend: per === 1 ? "one mark = one thought" : `one mark = ${int(per)} thoughts`,
        art: (w, hgt) => markGrid(c, Math.ceil(TH.blocks / per), w, hgt, "circle") };
    });

    if (D.approvals) card({ id: "approvals", title: "Rubber stamp", ch: "friction", dur: 6000 }, (c) => {
      const A = D.approvals;
      // the share of permission decisions nobody had to make: settings let them through, against those you answered
      const all = A.auto + A.byPerson + (A.denied || 0) || 1;
      const k = lab("Rubber stamp");
      const big = heroCount(c, (A.auto / all) * 100, (x) => `${Math.round(x)}`, "%", 300);
      const p = body("of permission checks passed without asking you. You said yes ", b(`${int(A.byPerson)} times`), ".");
      enter(c, [k, big, p], 120, 160);
      const rows = [["By your settings", A.auto], ["Approved by you", A.byPerson], ["Declined by you", A.denied], ["Blocked by auto-review", A.autoBlocked]]
        .filter(([, value], i) => value != null && (i < 2 || value > 0)).map(([label, value]) => ({ label, value, text: compact(value) }));
      return { head: h("div", {}, k, big, p), artMin: 0.3, split: 0.46, legend: `${int(A.sessions)} sessions recorded it`,
        art: (w, hgt) => tracks(c, w, hgt, rows, { unit: "DECISIONS", at: 900 }) };
    });

    if (D.history) card({ id: "history", title: "History kept", ch: "rhythm", dur: 6000 }, (c) => {
      const Hh = D.history;
      const k = lab("History kept");
      const big = heroCount(c, Hh.days, int, Hh.days === 1 ? "day" : "days", 300);
      const p = body(Hh.firstDay ? ["of sessions AI Insights still has, back to ", b(dshort(Hh.firstDay)), "."] : "of sessions AI Insights still has.",
        Hh.cachedOnly > 0 ? [" ", b(int(Hh.cachedOnly)), ` ${Hh.cachedOnly === 1 ? "lives" : "live"} on only in its cache.`] : "");
      enter(c, [k, big, p], 120, 160);
      // a day per square up to 150 days, then a week, then a month: never more than about 150 marks
      const [per, word] = Hh.days <= 150 ? [1, "day"] : Hh.days <= 150 * 7 ? [7, "week"] : [30, "month"];
      return { head: h("div", {}, k, big, p), artMin: 0.26, split: 0.46, legend: `one square = one ${word}`,
        art: (w, hgt) => markGrid(c, Math.max(1, Math.ceil(Hh.days / per)), w, hgt, "square") };
    });

    // 21. outro: the maker's card, lime on teal -------------------------------------
    card({ id: "outro", title: "Made with", ch: "findings", dur: 3800, noFoot: true, dark: true, bg: "var(--brand-deep)", fg: "var(--brand-lime)" }, (c) => {
      c.el.style.setProperty("--acc", "var(--brand-lime)");
      // the outro is the mark: it carries the same title block the other sheets get from CardKit
      const tb = h("div", { class: "foot" }, h("span", { class: "mark" }, rabbitSvg("currentColor"), h("span", {}, "AI Insights"), h("span", { class: "by" }, "by Matrix OS")), h("span", { class: "legend" }, "matrix-os.com"));
      c.el.append(tb);
      c.tl.in(tb, 700, { y: 20 * c.u, dur: 600 });
      const lines = [
        h("div", { class: "pn-lab", style: { color: "#FCFCF5" } }, "Made with"),
        h("div", { class: "pn-hero", "data-fit": Math.round(200 * c.k * c.u), "data-min": Math.round(80 * c.u), style: { marginTop: px(c, 12, 6) } }, "AI Insights"),
        h("div", { class: "pn-note pn-sp1", style: { fontSize: px(c, 64, 40), color: "#FCFCF5" } }, "by Matrix OS"),
        h("div", { class: "pn-lab", style: { color: "#FCFCF5", marginTop: px(c, 36, 16) } }, "Make your own"),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: px(c, 16, 10), marginTop: px(c, 12, 6) } }, h("span", { class: "pn-tag", style: { fontSize: px(c, 34, 24) } }, SHARE.command), h("span", { class: "pn-tag", style: { fontSize: px(c, 34, 24) } }, SHARE.skill)),
        h("div", { class: "pn-note", "data-fit": Math.round(34 * c.k * c.u), "data-min": Math.round(MIN * c.u), style: { fontFamily: "var(--mono)", fontSize: px(c, 34, 24), color: "#FCFCF5", marginTop: px(c, 16, 8), whiteSpace: "nowrap" } }, `${SHARE.site}  ${SHARE.hashtag}`),
      ];
      enter(c, lines, 500, 140);
      return { head: h("div", {}, ...lines), artFirst: true, artMin: 0.34, split: 0.44,
        art(w, hgt) {
          const u = c.u, svg = box(w, hgt);
          const lm = 50 * u, hg = Math.max(60 * u, Math.min(hgt - 2 * lm, ((w - 2 * lm - 80 * u) * 660) / 510)), wd = (hg * 510) / 660;
          const ox = (w - wd) / 2, oy = (hgt - hg) / 2;
          const sc = hg / 660, g = s("g", { transform: `translate(${ox.toFixed(1)},${oy.toFixed(1)}) scale(${sc.toFixed(4)})` });
          const paths = [...rabbitSvg("none").querySelectorAll("path")].map((q) => q.getAttribute("d")).map((d) => { const p = s("path", { d, fill: "var(--brand-lime)", stroke: "var(--brand-lime)", "stroke-width": (2 / sc).toFixed(2) }); p.style.fillOpacity = 0; g.append(p); return p; });
          svg.append(g);
          paths.forEach((p, i) => { c.tl.draw(p, 100 + i * 40, 900, "inOut"); c.tl.at(700 + i * 40, 500, "out", (q) => { p.style.fillOpacity = q; }); });
          // dimension lines: height on the left, width below
          const dims = s("g"), dx = ox - 30 * u, dyb = oy + hg + 26 * u;
          dims.append(ln(dx, oy, dx, oy + hg, { w: 1.6 * u }), ln(dx - 12 * u, oy, dx + 12 * u, oy, { w: 1.6 * u }), ln(dx - 12 * u, oy + hg, dx + 12 * u, oy + hg, { w: 1.6 * u }));
          dims.append(ln(ox, dyb, ox + wd, dyb, { w: 1.6 * u }), ln(ox, dyb - 12 * u, ox, dyb + 12 * u, { w: 1.6 * u }), ln(ox + wd, dyb - 12 * u, ox + wd, dyb + 12 * u, { w: 1.6 * u }));
          if (dyb + 34 * u <= hgt) dims.append(s("rect", { x: ox + wd / 2 - 70 * u, y: dyb - 15 * u, width: 140 * u, height: 30 * u, fill: "var(--brand-deep)" }), tx(c, ox + wd / 2, dyb + 8 * u, "FIG. 1", { a: "middle", size: 22 * u, w: 700, ls: 0.14, fill: "var(--brand-lime)" }));
          svg.append(dims); fade(c, dims, 1300, 500);
          return svg;
        } };
    });

    return SPECS;
  },
});
