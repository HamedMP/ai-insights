/* sticker.js: the "Sticker sheet" card style. Every stat is a die-cut sticker (thick white contour, soft shadow,
   slight seeded rotation, foil/holo/halftone fills) slapped onto a light dotted sheet with a little overshoot.
   Contract: card-styles-contract.md. Everything lives inside registerCardStyle; no top-level names. */
registerCardStyle({
  id: "sticker",
  name: "Sticker sheet",
  swatch: "radial-gradient(circle at 32% 36%,#ff5b3d 0 21%,#fff 22% 27%,transparent 28%),radial-gradient(circle at 68% 64%,#2d5bff 0 21%,#fff 22% 27%,transparent 28%),#f2ede3",
  specs(D, kit) {
    const { h, s, clamp, lerp, E, int, one, pct, compact, capped, dshort, hh, DAYNAME, rng, smooth, rabbitSvg, cellGrid, harnessName } = kit;
    const T = D.totals, R = D.rhythm, V = D.voice || {}, SH = D.shell || {}, SHARE = kit.share;
    const YEAR = D.range.to.slice(0, 4);
    const rangeLabel = `${dshort(D.range.from)} – ${dshort(D.range.to)}, ${YEAR}`;
    const has = (x) => x !== undefined && x !== null && !(typeof x === "number" && !Number.isFinite(x));
    const activeDay = (d) => d.prompts > 0 || d.minutes > 0;
    const topWeekday = R.weekdays.slice().sort((a, b) => b.count - a.count)[0];
    const priced = !!D.usage && D.usage.priced !== false && has(D.usage.usd);
    const BG = "#f2ede3", FG = "#1f1c22";
    const CAP = 999999;
    const SPECS = [];
    const add = (spec) => SPECS.push({ bg: BG, fg: FG, dark: false, squareSide: false, ...spec });

    // ================================================================ primitives
    const PX = (n) => Math.max(22, Math.round(n));
    const hash = (str) => { let x = 2166136261; for (const ch of str) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0; return x; };
    const HOLO = [["0", "#ff9fd0"], [".2", "#ffd66b"], [".42", "#7fe8c0"], [".62", "#86b0ff"], [".82", "#c58cff"], ["1", "#ff9fd0"]];
    const GOLD = [["0", "#e9b949"], [".3", "#fff0b0"], [".55", "#c99228"], [".78", "#f8dc87"], ["1", "#a8741c"]];
    const LIGHT = new Set(["var(--lemon)", "var(--mint)", "var(--pink)", "var(--lilac)", "var(--sky)", "holo", "gold", "var(--paper)"]);

    /** Per-build helpers: seeded rotation, deterministic ids, the slap entrance, die-cut type. */
    function kitFor(c, id) {
      let n = 0;
      const uid = () => `sk-${id}-${c.W}x${c.H}-${Math.round(c.k * 100)}-${n++}`;
      const rnd = rng(hash(id) + c.W * 3 + c.H);
      const K = c.k * c.u;
      const cuts = [];

      /** Sticker lands: big and lifted, then springs flat with a little overshoot. Pure in t. */
      function slap(el, start, rot = 0, o = {}) {
        const spin = o.spin ?? (rot >= 0 ? 9 : -9), from = o.from ?? 1.45, dur = o.dur ?? 640;
        c.tl.at(start, dur, "lin", (p) => {
          const q = p <= 0 ? 0 : E.spring(p);
          el.style.opacity = String(clamp(p * 6));
          el.style.transform = `rotate(${(rot + (1 - q) * spin).toFixed(2)}deg) scale(${lerp(from, 1, q).toFixed(4)})`;
          el.style.setProperty("--lift", (1 - E.out(p)).toFixed(3));
        });
        return el;
      }
      function shimmer(el, i = 0) { c.tl.idle((t) => { el.style.backgroundPosition = `${(50 + 42 * Math.sin(t / 1400 + i * 1.9)).toFixed(1)}% ${(50 + 30 * Math.cos(t / 1800 + i)).toFixed(1)}%`; }); }
      function sheen(host, i = 0) {
        const sh = h("i", { class: "sk-sheen" });
        host.append(sh);
        c.tl.idle((t) => { sh.style.transform = `translateX(${((((t / 24) + i * 120) % 420) - 210).toFixed(1)}%)`; });
        return sh;
      }
      const tape = (txt, bg = "var(--ink)", o = {}) => {
        const fs = PX((o.size || 30) * K);
        return h("div", { class: "sk-tape", "data-fit": fs, "data-min": 22, style: { fontSize: fs + "px", background: bg, color: o.fg || "#fff" } }, txt);
      };
      /** Die-cut type: transparent HTML text for layout, fitting and audit; an SVG overlay paints the contour. */
      function cut(txt, size, fill = "var(--ink)", o = {}) {
        const fs = Math.round(size);
        const t = h("span", {}, txt, h("i"));
        const g = h("div", { class: "sk-cut" + (o.mono ? " mono" : ""), "data-fit": fs, "data-min": PX(o.min ?? fs * 0.36), style: { fontSize: fs + "px", textAlign: o.align || "left" } }, t);
        cuts.push({ g, t, fill, o });
        return g;
      }
      function paintCuts() {
        for (const { g, t, fill, o } of cuts) {
          if (!g.isConnected) continue;
          const fs = parseFloat(g.style.fontSize), x = t.offsetLeft, y = t.lastChild.offsetTop, w = t.offsetWidth;
          const W = g.offsetWidth, H = g.offsetHeight;
          const sv = s("svg", { class: "sk-ov", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
          const fam = o.mono ? "GeistM, monospace" : "Brico, sans-serif", wt = o.mono ? 700 : 800, ls = (o.mono ? -0.04 : -0.045) * fs;
          const txt = (attrs) => s("text", { x, y, "font-family": fam, "font-weight": wt, "font-size": fs, style: `letter-spacing:${ls.toFixed(2)}px`, ...attrs }, document.createTextNode(t.firstChild.textContent));
          const ol = o.ol ?? fs * 0.16;
          let paint = fill;
          if (fill === "holo" || fill === "gold") {
            const id = uid(), lg = s("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: x, y1: y - fs * 0.8, x2: x + w, y2: y + fs * 0.15 });
            (fill === "holo" ? HOLO : GOLD).forEach(([of, col]) => lg.append(s("stop", { offset: of, "stop-color": col })));
            sv.append(s("defs", {}, lg));
            paint = `url(#${id})`;
          }
          if (o.plain) { sv.append(txt({ fill: paint })); g.append(sv); continue; }
          sv.append(
            txt({ fill: "rgba(70,48,28,0.16)", stroke: "rgba(70,48,28,0.10)", "stroke-width": ol * 1.25, "stroke-linejoin": "round", transform: `translate(0 ${(fs * 0.04).toFixed(1)})` }),
            txt({ fill: "#fff", stroke: "#fff", "stroke-width": ol, "stroke-linejoin": "round" }),
            txt(LIGHT.has(fill) ? { fill: paint, stroke: "var(--ink)", "stroke-width": Math.max(2, fs * 0.022), "stroke-linejoin": "round", "paint-order": "stroke" } : { fill: paint }));
          g.append(sv);
        }
      }
      const note = (kids, o = {}) => h("div", { class: "sk-note", style: { fontSize: PX((o.size || 40) * K) + "px", ...(o.style || {}) } }, kids);
      /** Plain sticker of a given size. o: { bg, fg, cls, round, b (border), r (radius), pad }. */
      function stk(w, hg, o = {}, ...kids) {
        const b = o.b ?? Math.max(6, Math.round(Math.min(w, hg) * 0.045));
        const el = h("div", { class: `sk-stk${o.round ? " sk-round" : ""}${o.cls ? " " + o.cls : ""}`, style: { width: w + "px", height: hg + "px", "--b": b + "px", "--r": (o.r ?? Math.min(w, hg) * 0.16) + "px", backgroundColor: o.bg || "var(--paper)", color: o.fg || "var(--ink)", padding: o.pad != null ? o.pad + "px" : `${Math.round(hg * 0.06)}px ${Math.round(w * 0.07)}px`, ...(o.style || {}) } }, kids);
        if (o.cls && /sk-holo|sk-gold|sk-silver|sk-bronze/.test(o.cls)) { if (/sk-holo/.test(o.cls)) shimmer(el, n++); sheen(el, n++); }
        return el;
      }
      /** Shaped sticker: SVG shadow + white contour + fill for path d inside w x h; content centred in an inner box. */
      function shape(w, hg, d, fill, o = {}, ...kids) {
        const ol = o.ol ?? Math.max(10, Math.min(w, hg) * 0.06);
        const sv = s("svg", { width: w, height: hg, viewBox: `0 0 ${w} ${hg}` });
        if (o.under) sv.append(o.under);
        let paint = fill;
        if (fill === "gold" || fill === "holo") {
          const id = uid(), lg = s("linearGradient", { id, x1: 0, y1: 0, x2: 1, y2: 1 });
          (fill === "holo" ? HOLO : GOLD).forEach(([of, col]) => lg.append(s("stop", { offset: of, "stop-color": col })));
          sv.append(s("defs", {}, lg)); paint = `url(#${id})`;
        }
        sv.append(
          s("path", { d, fill: "rgba(70,48,28,0.14)", stroke: "rgba(70,48,28,0.09)", "stroke-width": ol * 1.6, "stroke-linejoin": "round", transform: `translate(0 ${(ol * 0.5).toFixed(1)})` }),
          s("path", { d, fill: "#fff", stroke: "#fff", "stroke-width": ol, "stroke-linejoin": "round" }),
          s("path", { d, fill: paint }));
        if (o.over) sv.append(o.over);
        const ib = o.inner || { x: w * 0.18, y: hg * 0.18, w: w * 0.64, h: hg * 0.64 };
        return h("div", { class: "sk-stk sk-bare", style: { width: w + "px", height: hg + "px", color: o.fg || "var(--ink)" } }, sv,
          h("div", { class: "sk-in", style: { left: ib.x + "px", top: ib.y + "px", width: ib.w + "px", height: ib.h + "px" } }, kids));
      }
      const num = (txt, size, o = {}) => h("div", { class: "sk-num" + (o.mono ? " sk-mono" : ""), "data-fit": Math.round(size), "data-min": 22, style: { fontSize: Math.round(size) + "px", ...(o.style || {}) } }, txt);
      const lbl = (txt, size, o = {}) => o.wrap ? h("div", { class: "sk-lbl", style: { fontSize: PX(size) + "px", whiteSpace: "normal", ...(o.style || {}) } }, txt)
        : h("div", { class: "sk-lbl", "data-fit": PX(size), "data-min": 22, style: { fontSize: PX(size) + "px", ...(o.style || {}) } }, txt);
      const txtl = (kids, size, o = {}) => h("div", { class: "sk-txt", style: { fontSize: PX(size) + "px", ...(o.style || {}) } }, kids);
      return { c, K, rnd, uid, slap, shimmer, sheen, tape, cut, paintCuts, note, stk, shape, num, lbl, txtl };
    }

    // ================================================================ shapes (paths inside w x h, inset by m)
    function starD(w, hg, n = 12, inner = 0.8, m = 8) {
      const cx = w / 2, cy = hg / 2, Rx = w / 2 - m, Ry = hg / 2 - m; let d = "";
      for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, k = i % 2 ? inner : 1; d += (i ? "L" : "M") + (cx + Math.cos(a) * Rx * k).toFixed(1) + "," + (cy + Math.sin(a) * Ry * k).toFixed(1); }
      return d + "Z";
    }
    function scallopD(w, hg, n = 22, amp = 0.05, m = 8) {
      const cx = w / 2, cy = hg / 2, R0 = Math.min(w, hg) / 2 - m, pts = [];
      for (let i = 0; i < n * 4; i++) { const a = (i / (n * 4)) * Math.PI * 2; const rr = R0 * (1 - amp + amp * Math.cos(i * Math.PI / 2)); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
      return smooth(pts, true, 1);
    }
    function triD(w, hg, m = 10) { const r = Math.min(w, hg) * 0.06; return `M${w / 2},${m + r * 0.5} L${w - m},${hg - m - r * 0.2} Q${w - m},${hg - m} ${w - m - r},${hg - m} L${m + r},${hg - m} Q${m},${hg - m} ${m},${hg - m - r * 0.2} Z`; }
    function bubbleD(w, hg, m = 8) {
      const r = Math.min(w, hg) * 0.16, tb = hg * 0.78, x0 = m, y0 = m, x1 = w - m;
      return `M${x0 + r},${y0} H${x1 - r} A${r},${r} 0 0 1 ${x1},${y0 + r} V${tb - r} A${r},${r} 0 0 1 ${x1 - r},${tb} H${w * 0.3} L${w * 0.16},${hg - m} L${w * 0.19},${tb} H${x0 + r} A${r},${r} 0 0 1 ${x0},${tb - r} V${y0 + r} A${r},${r} 0 0 1 ${x0 + r},${y0} Z`;
    }
    function tagD(w, hg, m = 8) { const r = hg * 0.12, nk = hg * 0.42; return `M${m + nk},${m} H${w - m - r} Q${w - m},${m} ${w - m},${m + r} V${hg - m - r} Q${w - m},${hg - m} ${w - m - r},${hg - m} H${m + nk} L${m},${hg / 2} Z`; }
    function moonD(w, hg, m = 8) { const R0 = Math.min(w, hg) / 2 - m, cx = w / 2, cy = hg / 2; return `M${cx + R0 * 0.1},${cy - R0} A${R0},${R0} 0 1 0 ${cx + R0},${cy + R0 * 0.12} A${R0 * 0.78},${R0 * 0.78} 0 1 1 ${cx + R0 * 0.1},${cy - R0} Z`; }

    // ================================================================ layout: justified collage of stickers
    /** Plan rows for items in w x h. items: [{ ars:[...], wt, max, rmax, make(w, h) }]. Maximises the smallest area/wt. */
    function plan(K, w, hg, items, o = {}) {
      const gap = (o.gap ?? 30) * K.c.u, n = items.length;
      if (!n || w <= 0 || hg <= 0) return null;
      const opts = items.map((it) => it.ars || [it.ar || 1]);
      const combos = [];
      (function rec(i, acc) { if (i === n) { combos.push(acc.slice()); return; } for (const a of opts[i]) { acc.push(a); rec(i + 1, acc); acc.pop(); } })(0, []);
      let best = null;
      for (const ars of combos) for (let mask = 0; mask < 1 << (n - 1); mask++) {
        const rows = [[0]];
        for (let i = 1; i < n; i++) { if (mask & (1 << (i - 1))) rows.push([i]); else rows[rows.length - 1].push(i); }
        if (o.maxRows && rows.length > o.maxRows) continue;
        if (o.even && rows.some((r, j) => r.length !== rows[0].length && !(j === rows.length - 1 && r.length < rows[0].length))) continue;
        let rh = rows.map((r) => (w - gap * (r.length - 1)) / r.reduce((a, i) => a + ars[i], 0));
        rh = rh.map((x, j) => Math.min(x, ...rows[j].map((i) => (items[i].max ?? 1e9) / Math.max(ars[i], 1))));
        if (o.even) { const m = Math.min(...rh); rh = rh.map(() => m); }
        const avail = hg - gap * (rows.length - 1);
        if (avail <= 0) continue;
        const sc = Math.min(1, avail / rh.reduce((a, b) => a + b, 0));
        rh = rh.map((x) => x * sc);
        let score = Infinity, area = 0;
        rows.forEach((r, j) => r.forEach((i) => { const a = rh[j] * rh[j] * ars[i]; area += a; score = Math.min(score, a / (items[i].wt || 1)); }));
        if (!best || score > best.score * 1.02 || (score > best.score * 0.98 && area > best.area * 1.02)) best = { score, area, rows, rh, ars };
      }
      if (!best) return null;
      best.gap = gap; best.items = items;
      best.usedW = Math.max(...best.rows.map((row, j) => row.reduce((a, i) => a + best.ars[i] * best.rh[j], 0) + gap * (row.length - 1)));
      best.usedH = best.rh.reduce((a, b) => a + b, 0) + gap * (best.rows.length - 1);
      return best;
    }
    function place(K, pl, x0, y0, rw, rhgt, wrap, placed, valign) {
      let y = y0 + (valign === "top" ? 0 : (rhgt - pl.usedH) / 2);
      pl.rows.forEach((row, j) => {
        const H_ = pl.rh[j], w_ = row.reduce((a, i) => a + pl.ars[i] * H_, 0) + pl.gap * (row.length - 1);
        let x = x0 + (rw - w_) / 2;
        row.forEach((i) => {
          const it = pl.items[i], cw = pl.ars[i] * H_, ch = H_, m = it.inset ?? 0.035;
          const el = it.make(Math.floor(cw * (1 - 2 * m)), Math.floor(ch * (1 - 2 * m)));
          const jx = (K.rnd() - 0.5) * cw * m, jy = (K.rnd() - 0.5) * ch * m;
          Object.assign(el.style, { position: "absolute", left: (x + cw * m + jx).toFixed(1) + "px", top: (y + ch * m + jy).toFixed(1) + "px" });
          placed.push({ el, rot: it.rot ?? +((K.rnd() * 2 - 1) * (it.rmax ?? 3.5)).toFixed(2), it });
          wrap.append(el);
          x += cw + pl.gap;
        });
        y += H_ + pl.gap;
      });
    }
    /** Collage: a main sticker (item.main) gets its own region with the rest beside or below it, whichever gives more. */
    function collage(K, w, hg, items, o = {}) {
      const wrap = h("div", { style: { position: "relative", width: w + "px", height: hg + "px" } }), placed = [];
      const main = items.find((it) => it.main), sides = items.filter((it) => it !== main);
      let best = { score: -1 };
      const flat = main && items.length > 1 ? null : plan(K, w, hg, items, o);
      if (flat) best = { score: flat.score, flat };
      if (main && sides.length) {
        const gap = (o.gap ?? 30) * K.c.u;
        for (const dir of ["right", "below"]) for (let f = 0.16; f <= 0.6; f += 0.04) {
          const mw = dir === "right" ? w * (1 - f) - gap / 2 : w, mh = dir === "right" ? hg : hg * (1 - f) - gap / 2;
          const sw = dir === "right" ? w * f - gap / 2 : w, sh = dir === "right" ? hg : hg * f - gap / 2;
          const mp = plan(K, mw, mh, [main], o), sp = plan(K, sw, sh, sides, { ...o, even: o.evenSides });
          if (!mp || !sp) continue;
          const score = Math.min(mp.score, sp.score), area = mp.area + sp.area;
          if (score > best.score * 1.02 || (score > best.score * 0.98 && area > (best.area || 0) * 1.02)) best = { score, area, dir, mp, sp };
        }
      }
      if (best.flat) place(K, best.flat, 0, 0, w, hg, wrap, placed, o.valign);
      else {
        const { dir, mp, sp } = best, gap = mp.gap;
        if (dir === "right") { const x0 = (w - mp.usedW - gap - sp.usedW) / 2; place(K, mp, x0, 0, mp.usedW, hg, wrap, placed); place(K, sp, x0 + mp.usedW + gap, 0, sp.usedW, hg, wrap, placed); }
        else { const y0 = (hg - mp.usedH - gap - sp.usedH) / 2; place(K, mp, 0, y0, w, mp.usedH, wrap, placed); place(K, sp, 0, y0 + mp.usedH + gap, w, sp.usedH, wrap, placed); }
        const mi = placed.findIndex((p) => p.it === main);
        if (mi > 0) placed.unshift(placed.splice(mi, 1)[0]);
      }
      return { wrap, placed };
    }
    /** Art from a collage, with the slap entrance. */
    function art(K, items, o = {}) {
      return (w, hg) => {
        const roomy = w * hg >= 0.3 * K.c.W * K.c.H;
        const list = items.filter((it) => it && (roomy || !it.minor));
        if (!list.length) return null;
        const { wrap, placed } = collage(K, w, hg, list, o);
        placed.forEach((p, i) => K.slap(p.el, (o.start ?? 700) + i * (o.gap2 ?? 150), p.rot));
        return wrap;
      };
    }
    /** Head: tape, cut lines and a note, slapped in order. */
    function head(K, kids, start = 80) {
      const list = kids.filter(Boolean);
      const el = h("div", { class: "sk-head" }, list);
      list.forEach((k, i) => {
        if (i) k.style.marginTop = Math.round((k.classList.contains("sk-note") ? 26 : k.classList.contains("sk-cut") ? (list[i - 1].classList.contains("sk-cut") ? -14 : 6) : 18) * K.K) + "px";
        const rot = k.classList.contains("sk-tape") ? (K.rnd() < 0.5 ? -2 : 1.6) : k.classList.contains("sk-note") ? (K.rnd() - 0.5) * 1.6 : (K.rnd() - 0.5) * 2.2;
        K.slap(k, start + i * 140, +rot.toFixed(2), { from: k.classList.contains("sk-cut") ? 1.3 : 1.4 });
      });
      return el;
    }
    /** Every build returns through here so the cut contours are painted after layout. */
    function done(K, parts) {
      const own = parts.post;
      parts.post = (rect) => { K.paintCuts(); if (own) own(rect); };
      return parts;
    }

    // ================================================================ reusable stickers
    /** Round badge: big number + label. */
    function badge(K, w, hg, value, label, o = {}) {
      const d = Math.min(w, hg);
      const kids = [o.top ? K.lbl(o.top, d * 0.085, { style: { opacity: 0.8, marginBottom: d * 0.02 + "px" } }) : null, K.num(value, d * (o.numK || 0.3)), label ? K.lbl(label, d * (o.lblK || 0.082), { wrap: true, style: { marginTop: d * 0.04 + "px" } }) : null];
      return K.stk(d, d, { round: true, bg: o.bg || "var(--lemon)", fg: o.fg, cls: o.cls, pad: Math.round(d * 0.13) }, kids);
    }
    function starBadge(K, w, hg, value, label, o = {}) {
      const d = Math.min(w, hg);
      return K.shape(d, d, starD(d, d, o.points || 12, o.inner || 0.82, d * 0.04), o.fill || "var(--cobalt)", { fg: o.fg || "#fff", inner: { x: d * 0.2, y: d * 0.2, w: d * 0.6, h: d * 0.6 } },
        o.top ? K.lbl(o.top, d * 0.075) : null, K.num(value, d * (o.numK || 0.24)), label ? K.lbl(label, d * 0.072, { wrap: true, style: { marginTop: d * 0.03 + "px" } }) : null);
    }
    /** Rect stat sticker: number and label. */
    function statRect(K, w, hg, value, label, o = {}) {
      const u = Math.min(hg, w / 2.2);
      return K.stk(w, hg, { bg: o.bg || "var(--paper)", fg: o.fg, cls: o.cls }, o.top ? K.lbl(o.top, u * 0.15, { style: { opacity: 0.8 } }) : null, K.num(value, u * (o.numK || 0.5)), label ? K.lbl(label, u * 0.14, { wrap: true, style: { marginTop: u * 0.06 + "px" } }) : null);
    }
    /** One mark per day, or per week when the range is long (<= ~150 marks per series). */
    function binned() {
      const days = D.daily;
      if (days.length <= 150) return { unit: "day", marks: days.map((d) => ({ on: activeDay(d), v: d.prompts, m: d.minutes, from: d.day, to: d.day })) };
      const marks = [];
      for (let i = 0; i < days.length; i += 7) { const wk = days.slice(i, i + 7); marks.push({ on: wk.some(activeDay), v: wk.reduce((a, d) => a + d.prompts, 0), m: wk.reduce((a, d) => a + d.minutes, 0), from: wk[0].day, to: wk[wk.length - 1].day }); }
      return { unit: "week", marks };
    }
    const DOTC = ["var(--tomato)", "var(--cobalt)", "var(--lemon)", "var(--mint)", "var(--pink)", "var(--lilac)"];
    function sigilSvg(size, o = {}) {
      const sv = s("svg", { viewBox: "0 0 600 600", width: size, height: size });
      const cx = 300, Rr = 270, mx = Math.max(...R.hours, 1);
      sv.append(s("circle", { cx, cy: cx, r: Rr, fill: o.disc || "rgba(255,255,255,0.6)" }));
      const pts = R.hours.map((v, hr) => { const a = (hr / 24) * Math.PI * 2 - Math.PI / 2, rr = Rr * 0.22 + Rr * 0.5 * Math.sqrt(v / mx); return [cx + Math.cos(a) * rr, cx + Math.sin(a) * rr]; });
      sv.append(s("path", { d: smooth(pts, true, 1), fill: o.blob || "var(--ink)" }));
      const { marks } = binned();
      marks.forEach((d, i) => { const a = (i / marks.length) * Math.PI * 2 - Math.PI / 2; sv.append(s("circle", { cx: cx + Math.cos(a) * Rr * 0.88, cy: cx + Math.sin(a) * Rr * 0.88, r: d.on ? Math.min(14, 600 / marks.length) : Math.min(6, 260 / marks.length), fill: d.on ? DOTC[i % DOTC.length] : "none", stroke: d.on ? "#fff" : "var(--ink)", "stroke-width": d.on ? 3.5 : 2 })); });
      return sv;
    }
    function rosette(K, w, hg, small) {
      const M = D.models, d = Math.min(w, hg / (small ? 1 : 1.12));
      const words = M[0].key.split(" "), l2 = words.length > 1 ? words.pop() : words[0], l1 = words.length && M[0].key !== l2 ? words.join(" ") : "";
      const tails = small ? null : s("g", {},
        s("path", { d: `M${d * 0.3},${d * 0.62} L${d * 0.2},${d * 1.1} L${d * 0.3},${d * 1.03} L${d * 0.38},${d * 1.12} L${d * 0.46},${d * 0.66} Z`, fill: "var(--tomato)", stroke: "#fff", "stroke-width": d * 0.022, "stroke-linejoin": "round" }),
        s("path", { d: `M${d * 0.7},${d * 0.62} L${d * 0.8},${d * 1.1} L${d * 0.7},${d * 1.03} L${d * 0.62},${d * 1.12} L${d * 0.54},${d * 0.66} Z`, fill: "var(--cobalt)", stroke: "#fff", "stroke-width": d * 0.022, "stroke-linejoin": "round" }));
      const ring = s("circle", { cx: d / 2, cy: d / 2, r: d * 0.36, fill: "none", stroke: "rgba(120,80,10,0.35)", "stroke-width": Math.max(2, d * 0.008), "stroke-dasharray": `${d * 0.012} ${d * 0.012}` });
      const el = K.shape(d, d, scallopD(d, d, 22, 0.05, d * 0.035), "gold", { under: tails, over: ring, fg: "var(--ink)", inner: { x: d * 0.2, y: d * 0.2, w: d * 0.6, h: d * 0.6 } },
        K.lbl(small ? "top model" : "No. 1", d * 0.065),
        l1 ? K.num(l1, d * 0.1, { style: { marginTop: d * 0.015 + "px" } }) : null,
        K.num(l2, d * (l1 ? 0.15 : 0.13)),
        K.lbl(pct(M[0].share), d * 0.07, { style: { marginTop: d * 0.02 + "px" } }));
      if (!small) el.style.height = Math.round(d * 1.12) + "px";
      return el;
    }
    function tradingCard(K, w, hg, small) {
      const P = D.persona;
      const ww = Math.min(w, hg * 0.72), hh_ = Math.min(hg, ww / 0.72), u = ww / 600;
      const el = K.stk(ww, hh_, { cls: "sk-holo", r: 44 * u, b: Math.max(8, 14 * u), pad: Math.round(22 * u), style: { justifyContent: "stretch", alignItems: "stretch" } });
      const words = P.title.replace(/^The /, "").split(" ");
      const last = words.pop(), first = ["The", ...words].join(" ");
      const stats = [[int(D.parallel.max), "at once"], [int(Math.round(T.toolsPerPrompt)), "tools / prompt"], has(D.winRate) ? [pct(D.winRate), "goals hit"] : null].filter(Boolean);
      const inner = h("div", { style: { flex: "1", borderRadius: 26 * u + "px", background: "var(--paper)", display: "flex", flexDirection: "column", padding: `${22 * u}px ${28 * u}px`, textAlign: "left", position: "relative" } },
        h("div", { class: "sk-row", style: { justifyContent: "space-between" } }, K.lbl(small ? "you are" : `${int(D.range.days)} days`, PX(26 * u), { style: { width: "auto" } }), small ? null : K.lbl("holo", PX(26 * u), { style: { width: "auto", textAlign: "right" } })),
        h("div", { class: "sk-holo", style: { flex: "1", marginTop: 14 * u + "px", borderRadius: 20 * u + "px", display: "grid", placeItems: "center", minHeight: "0", overflow: "hidden" } }, sigilSvg(Math.min(ww * 0.6, hh_ * (small ? 0.34 : 0.4)))),
        K.num(first, 84 * u, { style: { marginTop: 18 * u + "px" } }),
        K.num(last, 84 * u, { style: { color: "var(--cobalt)" } }),
        small ? null : h("div", { style: { marginTop: 18 * u + "px", display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))`, gap: 14 * u + "px" } },
          stats.map(([v, l]) => h("div", { style: { borderTop: `${Math.max(3, 5 * u)}px solid var(--ink)`, paddingTop: 10 * u + "px", minWidth: "0" } }, K.num(v, 62 * u), K.lbl(l, 22 * u, { wrap: true, style: { letterSpacing: "0.02em" } })))));
      el.append(inner);
      return el;
    }

    // ================================================================ 1. intro
    add({ id: "intro", title: "Intro", dur: 5600, squareSide: true,
      build(c) {
        const K = kitFor(c, "intro"), F = (n) => n * K.K;
        const harn = T.harnesses.map((x) => harnessName(x.key));
        const who = harn.length === 1 ? harn[0] : harn.length === 2 ? `${harn[0]} and ${harn[1]}` : "Your coding agents";
        const hd = head(K, [
          K.tape(rangeLabel),
          K.cut("My last", F(c.wide ? 150 : 168), "var(--ink)"),
          K.cut(`${D.range.days} days`, F(c.wide ? 190 : 210), "holo"),
          K.cut("with AI.", F(c.wide ? 150 : 168), "var(--tomato)"),
          K.note([`${who}, looked back on. `, h("b", {}, `${int(T.activeDays)} busy days`), ` out of ${int(D.range.days)}.`], { size: 38 }),
        ]);
        const B = binned();
        const items = [
          { main: true, ars: [1, 1.5, 2.2, 3.2], wt: 3, make: (w, hg) => {
            const st = K.stk(w, hg, { bg: "var(--paper)", pad: Math.round(Math.min(w, hg) * 0.07), style: { justifyContent: "flex-start", alignItems: "stretch" } });
            const lb = K.lbl(`1 dot = 1 ${B.unit}`, 26 * c.u, { style: { textAlign: "left", color: "var(--muted)" } });
            const iw = w - Math.min(w, hg) * 0.14 - 20, ih = hg - Math.min(w, hg) * 0.14 - 20 - 40 * c.u;
            const g = cellGrid(B.marks.length, iw, ih, 0.28);
            const sv = s("svg", { width: iw, height: ih, viewBox: `0 0 ${iw} ${ih}`, style: "margin-top:10px;overflow:visible" });
            const mx = Math.max(...B.marks.map((m) => m.v), 1), gw = g.cols * (g.size + g.gap) - g.gap, ox = (iw - gw) / 2;
            B.marks.forEach((m, i) => {
              const x = ox + (i % g.cols) * (g.size + g.gap) + g.size / 2, y = Math.floor(i / g.cols) * (g.size + g.gap) + g.size / 2;
              sv.append(m.on ? s("circle", { cx: x, cy: y, r: (g.size / 2) * (0.62 + 0.38 * Math.sqrt(m.v / mx)), fill: DOTC[i % DOTC.length], stroke: "#fff", "stroke-width": Math.max(2, g.size * 0.09) })
                : s("circle", { cx: x, cy: y, r: g.size * 0.36, fill: "none", stroke: "#c9c0b4", "stroke-width": Math.max(2, g.size * 0.05), "stroke-dasharray": `${Math.max(2, g.size * 0.07)} ${Math.max(2, g.size * 0.07)}` }));
            });
            st.append(lb, sv);
            return st;
          } },
          { ar: 1, wt: 1, max: 300 * c.u, rmax: 8, make: (w, hg) => badge(K, w, hg, int(T.sessions), "sessions", { bg: "var(--lemon)" }) },
          { ar: 1, wt: 1, max: 320 * c.u, rmax: 8, make: (w, hg) => starBadge(K, w, hg, int(T.prompts), "prompts", { fill: "var(--cobalt)" }) },
        ];
        return done(K, { head: hd, artMin: 0.24, split: 0.52, art: art(K, items, { start: 900 }) });
      } });

    // ================================================================ 2. hours
    add({ id: "hours", title: "Time", dur: 6500,
      build(c) {
        const K = kitFor(c, "hours"), F = (n) => n * K.K;
        const hd = head(K, [
          K.tape("time with your agents", "var(--cobalt)"),
          K.cut(`${int(T.wallHours)} hrs`, F(250), "var(--cobalt)"),
          K.note(["with at least one agent at work. Side by side, they logged ", h("b", {}, `${int(T.agentHours)} agent-hours`), "."], { size: 38 }),
        ]);
        const B = binned();
        const items = [
          { main: true, ars: [1.4, 2, 2.8, 3.8], wt: 2.5, make: (w, hg) => {
            const pad = Math.round(Math.min(w, hg) * 0.08);
            const st = K.stk(w, hg, { bg: "var(--paper)", pad, style: { justifyContent: "flex-start", alignItems: "stretch" } });
            const lb = K.lbl(`agent time per ${B.unit}`, 26 * c.u, { style: { textAlign: "left", color: "var(--muted)" } });
            const iw = w - 2 * pad - 20, ih = hg - 2 * pad - 20 - 44 * c.u;
            const sv = s("svg", { width: iw, height: ih, viewBox: `0 0 ${iw} ${ih}`, style: "margin-top:12px;overflow:visible" });
            const mx = Math.max(...B.marks.map((m) => m.m), 1), slot = iw / B.marks.length, bw = Math.max(2, slot * 0.7);
            B.marks.forEach((m, i) => { const bh = m.m ? Math.max(bw * 0.6, (m.m / mx) * ih) : 0; if (bh) sv.append(s("rect", { x: i * slot + (slot - bw) / 2, y: ih - bh, width: bw, height: bh, rx: Math.min(bw / 2, 10), fill: DOTC[(i * 5) % 6] })); });
            sv.append(s("rect", { x: 0, y: ih - 2, width: iw, height: 4, rx: 2, fill: "var(--ink)" }));
            st.append(lb, sv);
            return st;
          } },
          { ar: 1, wt: 1, max: 300 * c.u, rmax: 8, make: (w, hg) => badge(K, w, hg, int(T.sessions), "sessions", { bg: "var(--mint)", cls: "sk-half" }) },
          { ar: 1, wt: 1, max: 320 * c.u, rmax: 8, make: (w, hg) => starBadge(K, w, hg, int(T.prompts), "prompts", { fill: "var(--tomato)" }) },
        ];
        return done(K, { head: hd, artMin: 0.24, split: 0.5, legend: "", art: art(K, items, { start: 800 }) });
      } });

    // ================================================================ 3. clock
    add({ id: "clock", title: "Clock", dur: 7000,
      build(c) {
        const K = kitFor(c, "clock"), F = (n) => n * K.K;
        const quiet = R.quiet && R.quiet.len >= 3;
        const hd = head(K, [
          K.tape("when you prompt", "var(--cobalt)"),
          K.cut(`${R.verdict.label}.`, F(190), "var(--ink)"),
          K.note([h("b", {}, pct(R.nightShare)), " of your prompts came after 22:00. Golden hour: ", h("b", {}, hh(R.peakHour)), ".", quiet ? [" Never between ", h("b", {}, `${hh(R.quiet.start)}–${hh((R.quiet.start + R.quiet.len) % 24)}`), "."] : ""], { size: 38 }),
        ]);
        const dial = (w, hg) => {
          const d = Math.min(w, hg), el = K.stk(d, d, { round: true, bg: "var(--paper)", pad: 0 });
          const sv = s("svg", { viewBox: "0 0 720 720", width: d * 0.92, height: d * 0.92 }), cx = 360, R0 = 120, R1 = 320, mx = Math.max(...R.hours, 1);
          for (let hr = 0; hr < 24; hr++) {
            const a = (hr / 24) * Math.PI * 2 - Math.PI / 2, v = R.hours[hr], len = v ? 18 + (R1 - R0 - 18) * Math.sqrt(v / mx) : 0;
            if (!v) sv.append(s("circle", { cx: cx + Math.cos(a) * (R0 + 14), cy: cx + Math.sin(a) * (R0 + 14), r: 9, fill: "none", stroke: "#bdb4c9", "stroke-width": 4, "stroke-dasharray": "4 4" }));
            else { const ln = s("line", { x1: cx + Math.cos(a) * R0, y1: cx + Math.sin(a) * R0, x2: cx + Math.cos(a) * (R0 + len), y2: cx + Math.sin(a) * (R0 + len), stroke: hr === R.peakHour ? "var(--tomato)" : "var(--cobalt)", "stroke-width": 24, "stroke-linecap": "round" }); sv.append(ln); c.tl.draw(ln, 1100 + hr * 30, 500, "out"); }
          }
          const fs = Math.max(40, (22 * 720) / (d * 0.92));
          if (d >= 470 * c.u) for (const hr of [0, 6, 12, 18]) { const a = (hr / 24) * Math.PI * 2 - Math.PI / 2; sv.append(s("text", { x: cx + Math.cos(a) * 66, y: cx + Math.sin(a) * 66 + fs * 0.36, "text-anchor": "middle", "font-family": "GeistM, monospace", "font-weight": 800, "font-size": fs, fill: "var(--ink)" }, document.createTextNode(String(hr).padStart(2, "0")))); }
          sv.append(s("circle", { cx, cy: cx, r: 12, fill: "var(--ink)" }));
          el.append(sv);
          return el;
        };
        const peaks = R.harnessPeaks && R.harnessPeaks.length > 1 ? R.harnessPeaks.slice(0, 3) : null;
        const items = [
          { main: true, ar: 1, wt: 4, make: dial },
          { ar: 1, wt: 1, max: 300 * c.u, rmax: 9, make: (w, hg) => starBadge(K, w, hg, hh(R.peakHour), null, { fill: "var(--pink)", fg: "var(--ink)", top: "peak", points: 10, numK: 0.22 }) },
          peaks ? { ars: [0.9, 1.3, 2.2], wt: 1, max: 380 * c.u, make: (w, hg) => {
            const u = Math.min(hg / (peaks.length * 1.9 + 0.4), w / 5.2);
            return K.stk(w, hg, { bg: "var(--ink)", fg: "#fff" }, peaks.map((p, i) => h("div", { style: { width: "100%", marginTop: i ? u * 0.3 + "px" : "0" } }, K.lbl(harnessName(p.key), u * 0.42, { wrap: true, style: { opacity: 0.85 } }), K.num(hh(p.peak), u * 1.05, { style: { color: "var(--lemon)", marginTop: u * 0.08 + "px" } }))));
          } } : null,
          R.verdict.key === "night_owl" ? { minor: true, ar: 1, wt: 0.5, max: 220 * c.u, rmax: 12, make: (w, hg) => K.shape(Math.min(w, hg), Math.min(w, hg), moonD(Math.min(w, hg), Math.min(w, hg), Math.min(w, hg) * 0.05), "var(--lemon)", {}) } : null,
        ];
        return done(K, { head: hd, artMin: 0.32, split: 0.5, art: art(K, items, { start: 700 }) });
      } });

    // ================================================================ 4. weekday
    add({ id: "weekday", title: "Weekdays", dur: 6500,
      build(c) {
        const K = kitFor(c, "weekday"), F = (n) => n * K.K;
        const fri = (R.weekdays.find((d) => d.key === "Fri")?.count ?? 0) / Math.max(1, T.prompts);
        const hd = head(K, [
          K.tape("favourite day", "var(--tomato)"),
          K.cut(`${DAYNAME[topWeekday.key]}.`, F(220), "var(--tomato)"),
          K.note([h("b", {}, pct(topWeekday.count / Math.max(1, T.prompts))), " of your prompts.", fri < 0.08 && topWeekday.key !== "Fri" ? [" Fridays? Just ", h("b", {}, pct(fri)), ". TGIF, apparently."] : ""], { size: 38 }),
        ]);
        const week = (w, hg) => {
          let cols = 7, cell = 0;
          for (let q = 1; q <= 7; q++) { const cs = Math.min(w / q, hg / Math.ceil(7 / q)); if (cs > cell * 1.001) { cell = cs; cols = q; } }
          const rows = Math.ceil(7 / cols);
          const el = h("div", { style: { position: "relative", width: w + "px", height: hg + "px" } });
          const mx = Math.max(...R.weekdays.map((d) => d.count), 1), cols6 = ["var(--lemon)", "var(--mint)", "var(--sky)", "var(--pink)", "var(--lilac)", "var(--paper)"];
          R.weekdays.forEach((d, i) => {
            const top = d.key === topWeekday.key, r = Math.floor(i / cols), q = i % cols;
            const rowN = Math.min(cols, 7 - r * cols), ox = (w - rowN * cell) / 2, oy = (hg - rows * cell) / 2;
            const dd = cell * (0.62 + 0.3 * Math.sqrt(d.count / mx)) * 0.94;
            const st = K.stk(dd, dd, { round: true, bg: top ? "var(--tomato)" : cols6[i % 6], fg: top ? "#fff" : "var(--ink)", cls: top ? "" : i % 3 === 1 ? "sk-half" : "", pad: Math.round(dd * 0.12) },
              K.lbl(d.key.slice(0, 2), dd * 0.17), K.num(int(d.count), dd * 0.27, { style: { marginTop: dd * 0.03 + "px" } }));
            Object.assign(st.style, { left: (ox + q * cell + (cell - dd) / 2).toFixed(1) + "px", top: (oy + r * cell + (cell - dd) / 2).toFixed(1) + "px" });
            el.append(st);
            K.slap(st, 700 + i * 110, +((K.rnd() * 2 - 1) * 8).toFixed(2));
          });
          return el;
        };
        return done(K, { head: hd, artMin: 0.3, split: 0.46, legend: "prompts by weekday", art: (w, hg) => week(w, hg) });
      } });

    // ================================================================ 5. streak
    add({ id: "streak", title: "Streak", dur: 6500,
      build(c) {
        const K = kitFor(c, "streak");
        const S = D.streak;
        const hd = head(K, [
          K.tape("longest streak", "var(--ink)"),
          K.cut(`${int(S.days)} day${S.days === 1 ? "" : "s"}`, 250 * K.K, "var(--lemon)"),
          K.note([S.days > 0 && S.start && S.end ? `in a row, ${dshort(S.start)} to ${dshort(S.end)}. ` : "", h("b", {}, `${int(T.activeDays)} active days`), ` out of ${int(D.range.days)}.`], { size: 38 }),
        ]);
        const days = D.daily.length <= 147;
        const inS = (a, b) => S.days > 0 && !!S.start && b >= S.start && a <= S.end;
        const cal = (w, hg) => {
          const pad = Math.round(Math.min(w, hg) * 0.07);
          const st = K.stk(w, hg, { bg: "var(--paper)", pad, style: { justifyContent: "flex-start", alignItems: "stretch" } });
          const lh = 40 * c.u, iw = w - 2 * pad - 20, ih = hg - 2 * pad - 20 - lh;
          st.append(K.lbl(days ? "1 square = 1 day" : "1 square = 1 week", 26 * c.u, { style: { textAlign: "left", color: "var(--muted)" } }));
          const sv = s("svg", { width: iw, height: ih, viewBox: `0 0 ${iw} ${ih}`, style: "margin-top:10px;overflow:visible" });
          let marks, cols, rows, pos;
          if (days) {
            const first = (new Date(D.range.from + "T12:00:00Z").getUTCDay() + 6) % 7, nW = Math.ceil((D.daily.length + first) / 7);
            const across = iw / ih > 1.6;
            cols = across ? nW : 7; rows = across ? 7 : nW;
            marks = D.daily.map((d, i) => ({ on: activeDay(d), s: inS(d.day, d.day), big: D.bigDay && d.day === D.bigDay.day, j: i + first }));
            pos = (m) => (across ? [Math.floor(m.j / 7), m.j % 7] : [m.j % 7, Math.floor(m.j / 7)]);
          } else {
            const B = binned().marks;
            const g = cellGrid(B.length, iw, ih, 0.2);
            cols = g.cols; rows = g.rows;
            marks = B.map((m, i) => ({ on: m.on, s: inS(m.from, m.to), big: D.bigDay && D.bigDay.day >= m.from && D.bigDay.day <= m.to, j: i }));
            pos = (m) => [m.j % cols, Math.floor(m.j / cols)];
          }
          const size = Math.min(iw / (cols + (cols - 1) * 0.2), ih / (rows + (rows - 1) * 0.2)), gp = size * 0.2;
          const ox = (iw - (cols * (size + gp) - gp)) / 2, oy = (ih - (rows * (size + gp) - gp)) / 2;
          const streakCells = [];
          marks.forEach((m) => {
            const [q, r] = pos(m), x = ox + q * (size + gp), y = oy + r * (size + gp);
            const rc = s("rect", { x, y, width: size, height: size, rx: size * 0.22, fill: m.s ? "var(--tomato)" : m.on ? "var(--ink)" : "none", stroke: m.s || m.on ? "#fff" : "#c9c0b4", "stroke-width": m.s || m.on ? Math.max(1.5, size * 0.1) : Math.max(1.5, size * 0.06), "stroke-dasharray": m.s || m.on ? null : `${size * 0.12} ${size * 0.1}` });
            sv.append(rc);
            if (m.s) streakCells.push(rc);
            if (m.big) sv.append(s("path", { d: starD(size, size, 5, 0.5, size * 0.12), transform: `translate(${x} ${y})`, fill: "var(--lemon)", stroke: "var(--ink)", "stroke-width": Math.max(1, size * 0.05) }));
          });
          c.tl.stagger(streakCells, 1300, Math.min(60, 900 / Math.max(1, streakCells.length)), (rc, t0) => c.tl.pop(rc, t0, { dur: 500 }));
          streakCells.forEach((rc) => { rc.style.transformBox = "fill-box"; rc.style.transformOrigin = "50% 50%"; });
          st.append(sv);
          return st;
        };
        const items = [
          { main: true, ars: days ? [1, 1.4, 2.2, 3.2] : [1, 1.5, 2.4], wt: 3, make: cal },
          D.bigDay ? { ar: 1, wt: 1, max: 330 * c.u, rmax: 9, make: (w, hg) => starBadge(K, w, hg, int(D.bigDay.prompts), `on ${dshort(D.bigDay.day)}`, { fill: "var(--lemon)", fg: "var(--ink)", top: "best day", points: 14, inner: 0.84, numK: 0.25 }) } : null,
        ];
        return done(K, { head: hd, artMin: 0.32, split: 0.48, legend: "", art: art(K, items, { start: 700 }) });
      } });

    // ================================================================ 6. words
    add({ id: "words", title: "Words", dur: 7000,
      build(c) {
        const K = kitFor(c, "words"), F = (n) => n * K.K;
        const w0 = V.words[0];
        const hd = head(K, [
          K.tape("your favourite word", "var(--tomato)"),
          K.cut(w0.key, F(Math.min(300, 1500 / Math.max(3, w0.key.length))), "holo"),
          K.note(["Showed up in ", h("b", {}, `${int(w0.count)} prompts`), "."], { size: 38 }),
        ]);
        const cols = ["var(--cobalt)", "var(--mint)", "var(--lemon)", "var(--pink)"], fg = ["#fff", "var(--ink)", "var(--ink)", "var(--ink)"];
        const runners = V.words.slice(1, 5).map((wd, i) => ({ ar: 2.6, wt: 1, max: 520 * c.u, rmax: 5, make: (w, hg) => K.stk(w, hg, { bg: cols[i], fg: fg[i], cls: i === 1 ? "sk-half" : "", style: { flexDirection: "row", gap: hg * 0.12 + "px" } },
          K.num(wd.key, hg * 0.48, { style: { width: "auto", maxWidth: w * 0.62 + "px" } }), K.lbl(`×${int(wd.count)}`, hg * 0.2, { style: { width: "auto" } })) }));
        const op = V.openers && V.openers[0];
        const items = [...runners, op ? { ar: 2.3, wt: 2, max: 760 * c.u, rmax: 2, make: (w, hg) => K.shape(w, hg, bubbleD(w, hg, Math.min(w, hg) * 0.05), "var(--paper)", { inner: { x: w * 0.1, y: hg * 0.1, w: w * 0.8, h: hg * 0.6 } },
          K.num(`“${op.key}…”`, hg * 0.26, { style: { textAlign: "left" } }), K.lbl(`how ${int(op.count)} prompts start`, hg * 0.075, { wrap: true, style: { textAlign: "left", marginTop: hg * 0.04 + "px", color: "var(--muted)" } })) } : null];
        return done(K, { head: hd, artMin: 0.3, split: 0.5, legend: "from a fixed dev vocabulary", art: art(K, items, { start: 700, gap2: 120 }) });
      } });

    // ================================================================ 7. manners
    add({ id: "manners", title: "Manners", dur: 6500,
      build(c) {
        const K = kitFor(c, "manners"), F = (n) => n * K.K;
        const plz = V.polite.please, ty = V.polite.thanks;
        const quip = ty === 0 ? "The agents will live." : plz > ty ? "Polite, mostly." : "Very gracious.";
        const hd = head(K, [
          K.tape("manners check", "var(--ink)"),
          K.cut(`${int(plz)} ${plz === 1 ? "please" : "pleases"}`, F(170), "var(--pink)"),
          K.cut(`${int(ty)} ${ty === 1 ? "thank you" : "thank-yous"}`, F(170), "var(--ink)"),
          K.note([h("b", {}, quip), " ", h("b", {}, pct(V.questionShare)), " of your prompts were questions."], { size: 38 }),
        ]);
        const L = V.leverage;
        const items = [
          L ? { main: true, ars: [1.3, 1.7, 2.3], wt: 3, max: 900 * c.u, rmax: 2.5, make: (w, hg) => {
            const u = Math.min(hg / 4.2, w / 6.5);
            return K.stk(w, hg, { bg: "var(--paper)", style: { alignItems: "flex-start", textAlign: "left" }, pad: Math.round(u * 0.6) },
              K.lbl("shortest prompt, biggest job", u * 0.36, { wrap: true, style: { textAlign: "left", color: "var(--muted)" } }),
              K.num(`${int(L.words)} word${L.words === 1 ? "" : "s"} →`, u * 1.05, { style: { textAlign: "left", marginTop: u * 0.25 + "px" } }),
              K.num(`${int(L.toolCalls)} tool calls`, u * 1.05, { style: { textAlign: "left", color: "var(--tomato)" } }),
              K.txtl("before you said anything else.", u * 0.42, { style: { marginTop: u * 0.2 + "px" } }));
          } } : null,
          has(V.polite.sorry) && V.polite.sorry > 0 ? { minor: true, ar: 1, wt: 0.8, max: 280 * c.u, rmax: 9, make: (w, hg) => badge(K, w, hg, int(V.polite.sorry), V.polite.sorry === 1 ? "sorry" : "sorries", { bg: "var(--lilac)" }) } : null,
        ];
        return done(K, { head: hd, artMin: 0.24, split: 0.5, legend: `${int(V.prompts)} prompts you typed`, art: art(K, items, { start: 900 }) });
      } });

    // ================================================================ 8. slash
    add({ id: "slash", title: "Slash commands", dur: 6500,
      build(c) {
        const K = kitFor(c, "slash"), F = (n) => n * K.K;
        const top = D.slash[0] || { key: "/", count: 0 };
        const hd = head(K, [
          K.tape("most-typed slash command", "var(--ink)"),
          K.cut(top.key, F(200), "var(--cobalt)", { mono: true }),
          K.note([h("b", {}, `${int(top.count)} time${top.count === 1 ? "" : "s"}`), `, out of ${int(D.slashTotal)} slash commands you typed.`], { size: 38 }),
        ]);
        const fills = ["var(--lemon)", "var(--mint)", "var(--pink)", "var(--sky)"];
        const items = D.slash.slice(1, 5).map((x, i) => ({ ar: 2.4, wt: 1, max: 520 * c.u, rmax: 5, make: (w, hg) => {
          const el = K.stk(w, hg, { bg: fills[i], r: hg * 0.2, style: { flexDirection: "row", gap: hg * 0.1 + "px", boxShadow: `inset 0 ${-hg * 0.07}px 0 rgba(31,28,34,0.16), 0 4px 0 rgba(60,40,20,0.16), 0 12px 20px rgba(60,40,20,0.12)` } },
            K.num(x.key, hg * 0.3, { mono: true, style: { width: "auto", maxWidth: w * 0.66 + "px", fontWeight: 700, letterSpacing: "-0.03em" } }), K.lbl(`×${int(x.count)}`, hg * 0.2, { style: { width: "auto" } }));
          return el;
        } }));
        return done(K, { head: hd, artMin: 0.26, split: 0.5, legend: "built-ins by name", art: art(K, items, { start: 700 }) });
      } });

    // ================================================================ 9. shell
    add({ id: "shell", title: "Hall of fame", dur: 6500,
      build(c) {
        const K = kitFor(c, "shell"), F = (n) => n * K.K;
        const hd = head(K, [
          K.tape("bash hall of fame", "var(--ink)"),
          K.cut(capped(SH.calls, CAP), F(230), "var(--cobalt)"),
          K.note(["shell commands your agents ran. ", h("b", {}, `${int(T.toolsPerPrompt)} tool calls`), " for every prompt you typed."], { size: 38 }),
        ]);
        const medal = ["sk-gold", "sk-silver", "sk-bronze"];
        const items = SH.programs.slice(0, 5).map((p, i) => ({ minor: i > 2, ar: i < 3 ? 2.6 : 2.4, wt: i < 3 ? 1.3 : 1, max: 560 * c.u, rmax: 4, make: (w, hg) => K.stk(w, hg, { bg: i < 3 ? "#e9e2d6" : "var(--paper)", cls: medal[i] || "", style: { flexDirection: "row", justifyContent: "flex-start", gap: hg * 0.1 + "px" }, pad: Math.round(hg * 0.1) },
          h("div", { style: { flex: "none", width: hg * 0.46 + "px", height: hg * 0.46 + "px", borderRadius: "50%", background: "var(--ink)", color: "#fff", display: "grid", placeItems: "center", fontFamily: "var(--mono)", fontWeight: 800, fontSize: PX(hg * 0.24) + "px" } }, i + 1),
          h("div", { style: { flex: "1", minWidth: "0", textAlign: "left" } }, K.num(p.key, hg * 0.28, { mono: true, style: { fontWeight: 700, letterSpacing: "-0.03em", textAlign: "left" } }), K.lbl(compact(p.count), hg * 0.17, { style: { textAlign: "left", marginTop: hg * 0.03 + "px" } }))) }));
        return done(K, { head: hd, artMin: 0.3, split: 0.5, legend: "first program per command", art: art(K, items, { start: 800, gap2: 120 }) });
      } });

    // ================================================================ 10. tests
    add({ id: "tests", title: "Tests", dur: 6500,
      build(c) {
        const K = kitFor(c, "tests"), F = (n) => n * K.K;
        const passOk = has(SH.testPass) && SH.tests > 0;
        const hd = head(K, [
          K.tape("test runs", "var(--ink)"),
          K.cut(capped(SH.tests, CAP), F(250), "var(--mint)"),
          K.note(["times your agents ran the tests.", passOk ? [" ", h("b", {}, `${pct(SH.testPass)} passed`), "."] : ""], { size: 38 }),
        ]);
        const items = [
          passOk ? { ar: 1, wt: 1.4, max: 420 * c.u, rmax: 7, make: (w, hg) => {
            const d = Math.min(w, hg), el = K.stk(d, d, { round: true, bg: "var(--paper)", pad: 0 });
            const sv = s("svg", { viewBox: "0 0 200 200", width: d, height: d, style: "position:absolute;left:0;top:0" }), r = 76, C = 2 * Math.PI * r;
            sv.append(s("circle", { cx: 100, cy: 100, r, fill: "none", stroke: "var(--tomato)", "stroke-width": 26 }));
            const arc = s("circle", { cx: 100, cy: 100, r, fill: "none", stroke: "var(--mint)", "stroke-width": 26, transform: "rotate(-90 100 100)", "stroke-dasharray": `0 ${C}` });
            sv.append(arc);
            c.tl.at(1100, 1200, "inOut", (p) => arc.setAttribute("stroke-dasharray", `${(SH.testPass * C * p).toFixed(1)} ${C}`));
            el.append(sv, h("div", { style: { position: "relative", width: "56%" } }, K.num(pct(SH.testPass), d * 0.2), K.lbl("passed", d * 0.075)));
            return el;
          } } : null,
          { ars: [1.4, 1.9], wt: 2, max: 640 * c.u, rmax: 3, make: (w, hg) => {
            const u = Math.min(hg / 3.6, w / 4.6);
            return K.stk(w, hg, { bg: "var(--cobalt)", fg: "#fff", style: { alignItems: "flex-start", textAlign: "left" }, pad: Math.round(u * 0.45) },
              K.lbl("then they shipped", u * 0.3, { style: { textAlign: "left", opacity: 0.85 } }),
              K.num(`${capped(T.commits, CAP)} commits`, u * 1.0, { style: { textAlign: "left", marginTop: u * 0.15 + "px" } }),
              K.txtl([h("b", {}, pct(T.commitShare)), " of your sessions ended with at least one."], u * 0.34, { style: { marginTop: u * 0.2 + "px" } }));
          } },
        ];
        return done(K, { head: hd, artMin: 0.26, split: 0.5, art: art(K, items, { start: 800 }) });
      } });

    // ================================================================ 11. danger
    add({ id: "danger", title: "Danger", dur: 6500,
      build(c) {
        const K = kitFor(c, "danger");
        const hd = head(K, [
          K.tape("living dangerously", "var(--tomato)"),
          K.note([h("b", {}, "Nothing caught fire."), " Probably. Run by your agents:"], { size: 40 }),
        ]);
        const items = [
          { main: true, ars: [1.35, 1.7], wt: 3, max: 940 * c.u, rmax: 2.5, make: (w, hg) => {
            const b = Math.min(w, hg) * 0.075;
            const el = K.stk(w, hg, { pad: 0, r: Math.min(w, hg) * 0.08, style: { backgroundImage: `repeating-linear-gradient(-45deg, var(--ink) 0 ${b * 0.7}px, var(--lemon) ${b * 0.7}px ${b * 1.4}px)` } });
            el.append(h("div", { style: { position: "absolute", inset: b + "px", background: "var(--paper)", borderRadius: Math.min(w, hg) * 0.04 + "px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: `0 ${b}px` } },
              K.num(int(SH.rmrf), hg * 0.4),
              h("div", { class: "sk-mono", style: { fontSize: PX(hg * 0.12) + "px", fontWeight: 800, background: "var(--ink)", color: "#fff", padding: "0.02em 0.4em 0.1em", borderRadius: "0.2em", marginTop: hg * 0.03 + "px", whiteSpace: "nowrap" } }, "rm -rf")));
            return el;
          } },
          { ar: 1.06, wt: 1.3, max: 460 * c.u, rmax: 6, make: (w, hg) => K.shape(w, hg, triD(w, hg, Math.min(w, hg) * 0.05), "var(--tomato)", { fg: "#fff", inner: { x: w * 0.22, y: hg * 0.36, w: w * 0.56, h: hg * 0.54 } },
            K.num(int(SH.forcePush), hg * 0.26), h("div", { class: "sk-mono", style: { fontSize: PX(hg * 0.075) + "px", fontWeight: 800, width: "100%", lineHeight: 1.1, whiteSpace: "nowrap" } }, "git push", h("br"), "--force")) },
          SH.sleeps > 0 ? { ar: 1, wt: 1, max: 360 * c.u, rmax: 9, make: (w, hg) => badge(K, w, hg, int(SH.sleeps), "naps", { bg: "#dfe3ea", cls: "sk-silver", top: "zzz" }) } : null,
        ];
        return done(K, { head: hd, artMin: 0.45, split: 0.36, legend: "run by your agents", art: art(K, items, { start: 500, gap2: 300 }) });
      } });

    // ================================================================ 12. parallel
    add({ id: "parallel", title: "Parallel", dur: 6500,
      build(c) {
        const K = kitFor(c, "parallel"), F = (n) => n * K.K;
        // With lanes the count is the lanes open at the peak (the data layer keeps them equal to max).
        const L = D.parallel.lanes, n = L ? L.atPeak : D.parallel.max;
        const hd = head(K, [
          K.tape("most agents at once", "var(--ink)"),
          K.cut(int(n), F(360), "holo"),
          K.note(["sessions running side by side. Plus ", h("b", {}, `${int(D.parallel.subagents)} subagents`), " launched along the way."], { size: 38 }),
        ]);
        const cols = ["var(--tomato)", "var(--lemon)", "var(--mint)", "var(--pink)", "var(--lilac)", "var(--cobalt)", "var(--sky)"];
        // Real lanes: one strip per session over the hours around the peak, a pill for each stretch it worked.
        const strips = (w, hg) => {
          const pad = Math.round(Math.min(w, hg) * 0.07), el = K.stk(w, hg, { bg: "#fff", pad, r: Math.min(w, hg) * 0.08 });
          const iw = w - 2 * pad, ih = hg - 2 * pad, rows = L.rows.slice(0, 40), m = rows.length, top = Math.min(56 * c.u, ih * 0.12);
          const pitch = (ih - top) / m, lh = Math.max(3, pitch * 0.66), sv = s("svg", { width: iw, height: ih, viewBox: `0 0 ${iw} ${ih}`, style: "overflow:visible" });
          rows.forEach((r, i) => {
            const y = top + i * pitch + pitch / 2, g = s("g");
            g.append(s("line", { x1: r.start * iw, y1: y, x2: r.end * iw, y2: y, stroke: "#c9c0b4", "stroke-width": Math.max(2, lh * 0.2), "stroke-linecap": "round" }));
            for (const [a, b] of r.active) g.append(s("rect", { x: a * iw, y: y - lh / 2, width: Math.max(lh * 0.6, (b - a) * iw), height: lh, rx: lh / 2, fill: r.atPeak ? cols[i % cols.length] : "#d8d0c4", stroke: "var(--ink)", "stroke-width": Math.max(1.5, lh * 0.08) }));
            sv.append(g);
          });
          const px = L.peak * iw;
          sv.append(s("line", { x1: px, y1: top * 0.7, x2: px, y2: ih, stroke: "var(--ink)", "stroke-width": Math.max(3, 5 * c.u), "stroke-dasharray": `${12 * c.u} ${9 * c.u}` }));
          el.append(sv, h("div", { style: { position: "absolute", top: pad * 0.4 + "px", left: Math.min(Math.max(pad, pad + px - 50 * c.u), w - pad - 100 * c.u) + "px" } }, K.lbl("peak", Math.max(22, 26 * c.u))));
          return el;
        };
        const shown = Math.min(n, 24);
        const faces = (w, hg) => {
          const g = cellGrid(shown, w, hg, 0.16), el = h("div", { style: { position: "relative", width: w + "px", height: hg + "px" } });
          const gw = g.cols * (g.size + g.gap) - g.gap, gh = g.rows * (g.size + g.gap) - g.gap;
          for (let i = 0; i < shown; i++) {
            const r = rng(i * 17 + 3), sz = g.size * 0.94;
            const sv = s("svg", { viewBox: "0 0 100 100", width: sz * 0.66, height: sz * 0.66 }), ey = 42 + r() * 6, gp = 14 + r() * 6;
            sv.append(s("rect", { x: 50 - gp - 7, y: ey - 9, width: 14, height: 18, rx: 7, fill: "var(--ink)" }), s("rect", { x: 50 + gp - 7, y: ey - 9, width: 14, height: 18, rx: 7, fill: "var(--ink)" }),
              r() < 0.5 ? s("path", { d: `M36,${ey + 22} Q50,${ey + 34} 64,${ey + 22}`, fill: "none", stroke: "var(--ink)", "stroke-width": 6, "stroke-linecap": "round" }) : s("rect", { x: 40, y: ey + 20, width: 20, height: 7, rx: 3.5, fill: "var(--ink)" }),
              s("line", { x1: 50, y1: 6, x2: 50, y2: 18, stroke: "var(--ink)", "stroke-width": 5, "stroke-linecap": "round" }), s("circle", { cx: 50, cy: 6, r: 5, fill: "var(--ink)" }));
            const st = K.stk(sz, sz, { bg: cols[i % cols.length], r: sz * 0.26, pad: 0 }, sv);
            Object.assign(st.style, { left: ((w - gw) / 2 + (i % g.cols) * (g.size + g.gap) + (g.size - sz) / 2).toFixed(1) + "px", top: ((hg - gh) / 2 + Math.floor(i / g.cols) * (g.size + g.gap) + (g.size - sz) / 2).toFixed(1) + "px" });
            el.append(st);
            K.slap(st, 800 + i * 70, +((r() - 0.5) * 18).toFixed(2));
          }
          return el;
        };
        const items = [
          L ? { main: true, ars: [1, 1.4, 1.8, 2.4], wt: 3, make: strips } : { main: true, ars: [0.8, 1.2, 1.8, 2.6, 3.6], wt: 3, make: faces, inset: 0 },
          { ar: 1, wt: 0.9, max: 320 * c.u, rmax: 9, make: (w, hg) => starBadge(K, w, hg, int(D.parallel.subagents), "subagents", { fill: "var(--cobalt)" }) },
        ];
        const legend = L ? `one strip = one session · ${Math.round(L.windowMinutes / 60)} h` : shown < n ? `first ${shown} of ${int(n)} shown` : "one face = one session";
        return done(K, { head: hd, artMin: 0.3, split: 0.46, legend, art: (w, hg) => {
          const { wrap, placed } = collage(K, w, hg, items);
          if (L) K.slap(placed[0].el, 800, placed[0].rot);
          K.slap(placed[1].el, L ? 1100 : 800 + shown * 70, placed[1].rot);
          return wrap;
        } });
      } });

    // ================================================================ 13. marathon
    add({ id: "marathon", title: "Marathon", dur: 6500,
      build(c) {
        const K = kitFor(c, "marathon");
        const L = D.longestSession || { activeMinutes: 0, wallMinutes: 0, prompts: 0, toolCalls: 0, compactions: 0, harness: "" }, days = L.wallMinutes / 1440;
        const hd = head(K, [
          K.tape("longest session", "var(--tomato)"),
          D.longestSession ? K.note(["Active work in one ", h("b", {}, harnessName(L.harness)), " session", days >= 1 ? [", spread over ", h("b", {}, `${one(days)} days`), "."] : "."], { size: 40 }) : K.note("No session long enough to measure yet.", { size: 40 }),
          // Longer sessions a script or another agent drove are not the person's marathon: say they were left out.
          L.skippedAutomated > 0 ? K.note(`${int(L.skippedAutomated)} longer automated ${L.skippedAutomated === 1 ? "session" : "sessions"} left out.`, { size: 30 }) : null,
        ]);
        if (!D.longestSession) return done(K, { head: hd, center: true });
        const tc = L.toolCallsCapped ? `${int(L.toolCalls)}+` : capped(L.toolCalls, CAP);
        const items = [
          { main: true, ars: [1.1, 1.4], wt: 3, max: 900 * c.u, rmax: 2.5, make: (w, hg) => {
            const u = Math.min(w / 5, hg / 4), el = K.stk(w, hg, { bg: "#fff", pad: 0, r: u * 0.3, style: { justifyContent: "flex-start" } });
            const holes = [[0.07, 0.08], [0.93, 0.08], [0.07, 0.92], [0.93, 0.92]].map(([x, y]) => h("i", { style: { position: "absolute", left: `calc(${x * 100}% - ${u * 0.12}px)`, top: `calc(${y * 100}% - ${u * 0.12}px)`, width: u * 0.24 + "px", height: u * 0.24 + "px", borderRadius: "50%", background: "var(--sheet)", boxShadow: "inset 0 2px 3px rgba(0,0,0,.25)" } }));
            el.append(h("div", { style: { width: "100%", background: "var(--tomato)", color: "#fff", padding: `${u * 0.22}px ${u * 0.62}px` } }, K.lbl("active hours", u * 0.3)),
              h("div", { style: { flex: "1", display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", padding: `0 ${u * 0.4}px` } }, K.num(one(L.activeMinutes / 60), hg * 0.46, { style: { letterSpacing: "-0.06em" } }), K.lbl("one session", u * 0.34, { style: { marginTop: u * 0.1 + "px" } })), ...holes);
            return el;
          } },
          { ar: 2.1, wt: 0.8, max: 480 * c.u, make: (w, hg) => statRect(K, w, hg, int(L.prompts), "prompts from you", { bg: "var(--lemon)" }) },
          { ar: 2.1, wt: 0.8, max: 480 * c.u, make: (w, hg) => statRect(K, w, hg, tc, "tool calls", { bg: "var(--sky)" }) },
          { ar: 2.1, wt: 0.8, max: 480 * c.u, make: (w, hg) => statRect(K, w, hg, int(L.compactions), "context resets", { bg: "var(--pink)" }) },
        ];
        return done(K, { head: hd, artMin: 0.5, split: 0.34, legend: "active = gaps under 10 min", art: art(K, items, { start: 500, gap2: 160 }) });
      } });

    // ================================================================ 14. failures
    add({ id: "failures", title: "Failures", dur: 6500,
      build(c) {
        const K = kitFor(c, "failures"), F = (n) => n * K.K;
        const Fl = D.failures;
        const hd = head(K, [
          K.tape("where things broke", "var(--ink)"),
          K.cut(capped(Fl.total, CAP), F(240), "var(--tomato)"),
          K.note(["failed tool calls. Only ", h("b", {}, `${one(Fl.rate * 100)}%`), ` of ${capped(Fl.calls, CAP)}.`], { size: 38 }),
        ]);
        const named = Fl.categories.filter((x) => x.key !== "other"), cats = named.slice(0, 4);
        const rest = named.slice(4).reduce((a, x) => a + x.count, 0) + Fl.categories.filter((x) => x.key === "other").reduce((a, x) => a + x.count, 0);
        if (rest) cats.push({ key: "other", label: "Everything else", count: rest });
        const tot = Math.max(1, cats.reduce((a, b) => a + b.count, 0)), cc = ["var(--tomato)", "var(--cobalt)", "var(--lemon)", "var(--mint)", "var(--lilac)"];
        const items = [
          { main: true, ars: [1.3, 1.8, 2.4], wt: 3, max: 900 * c.u, rmax: 2, make: (w, hg) => {
            const rowH = Math.min((hg * 0.82) / cats.length, w / 9), pad = Math.round(rowH * 0.45);
            const el = K.stk(w, hg, { bg: "var(--paper)", pad, style: { alignItems: "stretch", justifyContent: "center" } });
            const bar = h("div", { style: { display: "flex", height: rowH * 0.7 + "px", borderRadius: rowH * 0.2 + "px", overflow: "hidden", marginBottom: rowH * 0.3 + "px", border: "3px solid var(--ink)" } }, cats.map((x, i) => h("i", { style: { width: (x.count / tot) * 100 + "%", background: cc[i] } })));
            el.append(bar, ...cats.map((x, i) => h("div", { class: "sk-row", style: { height: rowH + "px", gap: rowH * 0.3 + "px" } },
              h("i", { style: { flex: "none", width: rowH * 0.5 + "px", height: rowH * 0.5 + "px", borderRadius: "50%", background: cc[i], boxShadow: "0 0 0 3px #fff, 0 0 0 5px var(--ink)" } }),
              h("div", { class: "sk-txt", "data-fit": PX(rowH * 0.44), "data-min": 22, style: { fontSize: PX(rowH * 0.44) + "px", flex: "1", minWidth: "0", textAlign: "left", whiteSpace: "nowrap", fontWeight: 650 } }, x.label),
              K.lbl(pct(x.count / tot), rowH * 0.4, { style: { width: "auto" } }))));
            return el;
          } },
          has(D.interrupted) ? { ar: 1.35, wt: 1.2, max: 480 * c.u, rmax: 6, make: (w, hg) => {
            const el = K.stk(w, hg, { bg: "var(--ink)", fg: "#fff", r: hg * 0.16, style: { boxShadow: `inset 0 ${-hg * 0.06}px 0 rgba(255,255,255,0.12), 0 4px 0 rgba(60,40,20,0.2), 0 12px 22px rgba(60,40,20,0.14)` } },
              K.lbl("esc", hg * 0.13, { style: { color: "var(--lemon)" } }), K.num(int(D.interrupted), hg * 0.32, { style: { marginTop: hg * 0.03 + "px" } }), K.lbl("times you stepped in", hg * 0.085, { wrap: true, style: { marginTop: hg * 0.03 + "px", opacity: 0.85 } }));
            return el;
          } } : null,
        ];
        return done(K, { head: hd, artMin: 0.32, split: 0.46, legend: "share of failures", art: art(K, items, { start: 800 }) });
      } });

    // ================================================================ 15. nemesis
    add({ id: "nemesis", title: "Nemesis", dur: 6500,
      build(c) {
        const K = kitFor(c, "nemesis");
        const nm = D.failures.nemesis[0] || { key: "–", count: 0, runs: 0 };
        const hd = head(K, [
          K.tape("your agent's nemesis", "var(--tomato)"),
          K.note(["It failed ", h("b", {}, `${int(nm.count)} times`), ` in ${capped(nm.runs, CAP)} runs. The agents kept calling it anyway.`], { size: 40 }),
        ]);
        const items = [
          { main: true, ars: [0.82, 1.1, 1.5], wt: 3, max: 860 * c.u, rmax: 2.5, make: (w, hg) => {
            const u = Math.min(w / 5, hg / 5.4);
            return K.stk(w, hg, { bg: "#f6e7c4", pad: Math.round(u * 0.4), r: u * 0.18, style: { border: `${Math.max(8, u * 0.12)}px solid #fff`, boxShadow: `inset 0 0 0 ${Math.max(3, u * 0.05)}px #7a5a2b, 0 4px 0 rgba(60,40,20,.16), 0 12px 22px rgba(60,40,20,.12)` } },
              K.num("WANTED", u * 0.95, { style: { letterSpacing: "0.02em", color: "#7a3b1c" } }),
              K.lbl("for repeat failure", u * 0.3, { style: { marginTop: u * 0.15 + "px", color: "#7a3b1c" } }),
              K.num(nm.key, u * 0.85, { mono: true, style: { marginTop: u * 0.3 + "px", fontWeight: 700, letterSpacing: "-0.03em" } }),
              K.lbl(`${int(nm.count)} fails`, u * 0.42, { style: { marginTop: u * 0.25 + "px", color: "var(--tomato)" } }));
          } },
          ...D.failures.nemesis.slice(1, 4).map((x) => ({ ar: 2.4, wt: 0.8, max: 520 * c.u, rmax: 5, make: (w, hg) => K.stk(w, hg, { bg: "var(--paper)" },
            K.num(x.key, hg * 0.3, { mono: true, style: { fontWeight: 700, letterSpacing: "-0.03em" } }), K.lbl(`${int(x.count)} fails`, hg * 0.17, { style: { marginTop: hg * 0.05 + "px", color: "var(--muted)" } })) })),
        ];
        return done(K, { head: hd, artMin: 0.5, split: 0.36, legend: "failed shell runs", art: art(K, items, { start: 500, gap2: 160 }) });
      } });

    // ================================================================ 16. model
    add({ id: "model", title: "Model", dur: 6500,
      build(c) {
        const K = kitFor(c, "model");
        const M = D.models;
        const hd = head(K, [
          K.tape("top model", "var(--ink)"),
          K.note(["answered ", h("b", {}, pct(M[0].share)), ` of ${capped(D.usage.requests, CAP)} model requests.`], { size: 40 }),
        ]);
        const runner = (m, i) => ({ ar: 1, wt: 0.8, max: (i ? 300 : 360) * c.u, rmax: 9, make: (w, hg) => {
          const d = Math.min(w, hg);
          return K.stk(d, d, { round: true, bg: "#dfe3ea", cls: i ? "sk-bronze" : "sk-silver", pad: Math.round(d * 0.12) }, K.lbl(`No. ${i + 2}`, d * 0.08), K.txtl(m.key, d * 0.13, { style: { marginTop: d * 0.03 + "px", fontFamily: "var(--display)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 } }), K.lbl(m.share < 0.01 ? "<1%" : pct(m.share), d * 0.09, { style: { marginTop: d * 0.03 + "px" } }));
        } });
        const items = [
          { main: true, ar: 1 / 1.12, wt: 3, max: 860 * c.u, rmax: 3, make: (w, hg) => rosette(K, w, hg, false) },
          M[1] ? runner(M[1], 0) : null,
          M[2] ? runner(M[2], 1) : null,
          M[3] ? { minor: true, ar: 3.2, wt: 0.5, max: 520 * c.u, rmax: 3, make: (w, hg) => K.stk(w, hg, { bg: "var(--ink)", fg: "#fff", r: hg * 0.16 }, K.lbl(`${M[3].key} · ${M[3].share < 0.01 ? "<1%" : pct(M[3].share)}`, hg * 0.3)) } : null,
        ];
        return done(K, { head: hd, artMin: 0.5, split: 0.34, legend: "share of requests", art: art(K, items, { start: 400, gap2: 220 }) });
      } });

    // ================================================================ 17. tokens
    add({ id: "tokens", title: "Tokens", dur: 6500,
      build(c) {
        const K = kitFor(c, "tokens"), F = (n) => n * K.K;
        const U = D.usage;
        const hd = head(K, [
          K.tape("tokens processed", "var(--ink)"),
          K.cut(compact(U.tokens), F(300), "gold"),
          has(U.cacheHitRate) ? K.note([h("b", {}, pct(U.cacheHitRate)), " of input came straight from cache."], { size: 38 }) : null,
        ]);
        const nov = Math.round(U.novels || 0);
        const items = [
          priced ? { ars: [1.7, 2.2], wt: 2, max: 760 * c.u, rmax: 3, make: (w, hg) => K.shape(w, hg, tagD(w, hg, Math.min(w, hg) * 0.05), "var(--lemon)", {
            over: s("circle", { cx: hg * 0.3, cy: hg / 2, r: hg * 0.07, fill: "var(--sheet)", stroke: "var(--ink)", "stroke-width": 3 }),
            inner: { x: hg * 0.5, y: hg * 0.14, w: w - hg * 0.62, h: hg * 0.72 } },
            K.lbl("at list prices", hg * 0.085, { style: { textAlign: "left" } }), K.num(`$${int(U.usd)}`, hg * 0.3, { style: { textAlign: "left", marginTop: hg * 0.02 + "px" } }),
            has(U.usdPerCommit) ? K.lbl(`$${one(U.usdPerCommit)} a commit`, hg * 0.085, { style: { textAlign: "left", marginTop: hg * 0.03 + "px" } }) : null) } : null,
          nov > 0 ? { ar: 1, wt: 1, max: 360 * c.u, rmax: 8, make: (w, hg) => {
            const d = Math.min(w, hg), books = s("svg", { viewBox: "0 0 120 60", width: d * 0.42, height: d * 0.21 });
            ["var(--tomato)", "var(--cobalt)", "var(--lemon)", "var(--mint)", "var(--pink)"].forEach((col, i) => books.append(s("rect", { x: 6 + i * 22, y: 6 + (i % 2) * 6, width: 18, height: 50 - (i % 2) * 6, rx: 3, fill: col, stroke: "var(--ink)", "stroke-width": 3 })));
            return K.stk(d, d, { round: true, bg: "var(--paper)", cls: "sk-half", pad: Math.round(d * 0.13) }, books, K.num(int(nov), d * 0.24, { style: { marginTop: d * 0.03 + "px" } }), K.lbl("novels of output", d * 0.072, { wrap: true, style: { marginTop: d * 0.02 + "px" } }));
          } } : null,
        ];
        return done(K, { head: hd, artMin: 0.24, split: 0.5, legend: priced && U.unpriced ? `${capped(U.unpriced, CAP)} requests unpriced` : "", art: art(K, items, { start: 900 }) });
      } });

    // ================================================================ 18. persona
    add({ id: "persona", title: "Persona", dur: 7500, squareSide: true,
      build(c) {
        const K = kitFor(c, "persona");
        const P = D.persona;
        const hd = head(K, [
          K.tape("you are", "var(--ink)"),
          K.note(P.reason.charAt(0).toUpperCase() + P.reason.slice(1), { size: 38 }),
        ], 1400);
        const items = [{ ar: 0.72, wt: 1, rmax: 2, make: (w, hg) => tradingCard(K, w, hg, false) }];
        return done(K, { head: hd, artFirst: true, artMin: 0.55, split: 0.38, art: art(K, items, { start: 150 }) });
      } });

    // ================================================================ 19. tips
    add({ id: "tips", title: "Try next", dur: 8000,
      build(c) {
        const K = kitFor(c, "tips"), F = (n) => n * K.K;
        const WHY = {
          history_retention: (m) => (/session/i.test(m.unit) ? `${int(m.value)} transcripts can be deleted this week.` : `History kept: ${int(m.value)} days.`),
          context_resets: (m) => `${int(m.value)} context compactions in ${int(D.range.days)} days.`,
          slow_correction: (m) => `You usually step in after ${one(m.value)} minutes.`,
          repeated_failed_command: (m) => `One command failed ${int(m.value)} times running.`,
          long_sessions: (m) => `${int(m.value)} sessions ran very long.`,
          frequent_interruptions: (m) => `${int(m.value)} interruptions.`,
        };
        const tips = D.tips.slice(0, 3);
        const hd = head(K, [
          K.tape(`${tips.length} thing${tips.length === 1 ? "" : "s"} to try next`, "var(--tomato)"),
          K.cut("Your next level.", F(130), "var(--ink)"),
        ]);
        const cols = ["var(--lemon)", "var(--mint)", "var(--pink)"];
        const items = tips.map((tip, i) => ({ ars: [1.5, 2.4, 3.6, 5], wt: 1, rmax: 1.6, make: (w, hg) => {
          const why = tip.metric && WHY[tip.kind] ? WHY[tip.kind](tip.metric) : "";
          const ts = Math.max(26, Math.min(hg * 0.24, w * 0.055, 66 * c.u)), ws = Math.max(22, ts * 0.62), dd = Math.min(hg * 0.5, ts * 1.9);
          return K.stk(w, hg, { bg: "var(--paper)", pad: Math.round(Math.min(hg * 0.12, 34 * c.u)), style: { flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: ts * 0.6 + "px", textAlign: "left" } },
            h("div", { style: { flex: "none", width: dd + "px", height: dd + "px", borderRadius: "50%", background: cols[i], border: "4px solid var(--ink)", display: "grid", placeItems: "center", fontFamily: "var(--display)", fontWeight: 800, fontSize: PX(dd * 0.56) + "px" } }, i + 1),
            h("div", { style: { flex: "1", minWidth: "0" } }, K.txtl(tip.title, ts, { style: { fontFamily: "var(--display)", fontWeight: 760, letterSpacing: "-0.02em", lineHeight: 1.04 } }), why ? K.txtl(why, ws, { style: { marginTop: ts * 0.22 + "px", color: "var(--muted)", fontWeight: 500 } }) : null));
        } }));
        return done(K, { head: hd, artMin: 0.45, split: 0.38, legend: "from your findings", center: false, art: art(K, items, { start: 600, gap2: 260, gap: 22 }) });
      } });

    // ================================================================ 20. summary: the collection
    add({ id: "summary", title: "Summary", dur: 9000, bigMark: true,
      build(c) {
        const K = kitFor(c, "summary"), F = (n) => n * K.K;
        const hd = head(K, [
          K.tape(rangeLabel),
          c.tall || c.wide ? K.cut(`My last ${D.range.days} days`, F(c.wide ? 130 : 140), "var(--ink)") : K.cut(`My last ${D.range.days} days with AI.`, F(110), "var(--ink)"),
          c.tall || c.wide ? K.cut("with AI.", F(c.wide ? 130 : 140), "var(--tomato)") : null,
        ]);
        /** One sticker per hero: the die-cut figure from its card in that card's fill, on a coloured sticker. */
        const hero = (label, value, fill, bg, o = {}) => ({ ar: o.ar || 1.2, wt: 1, rmax: 4.5, make: (w, hg) => {
          const pad = Math.round(Math.min(w, hg) * 0.07);
          const el = K.stk(w, hg, { bg, fg: o.fg || "var(--ink)", cls: o.cls || "", pad });
          el.append(K.lbl(label, Math.min(hg * 0.12, w * 0.085), { wrap: true }), K.cut(value, Math.min(hg * 0.5, ((w - 2 * pad) * 1.55) / Math.max(1.6, value.length * 0.95)), fill, { align: "center", mono: o.mono, min: 30 }));
          return el;
        } });
        const M0 = D.models && D.models[0];
        const items = [
          { main: true, ar: 0.72, wt: 3, rmax: 2, make: (w, hg) => tradingCard(K, w, hg, true) },
          hero("hours", int(T.wallHours), "var(--cobalt)", "var(--sky)"),
          D.streak && D.streak.days > 0 ? hero("day streak", int(D.streak.days), "var(--lemon)", "var(--tomato)", { fg: "#fff" }) : null,
          hero("at once", int(D.parallel.max), "holo", "var(--ink)", { fg: "#fff" }),
          V.words && V.words[0] ? hero("top word", V.words[0].key, "holo", "var(--lilac)") : null,
          M0 ? { ar: 1.2, wt: 1, rmax: 4.5, make: (w, hg) => {
            const pad = Math.round(Math.min(w, hg) * 0.08), parts = M0.key.split(" "), l2 = parts.length > 1 ? parts.pop() : "", l1 = parts.join(" ");
            return K.stk(w, hg, { bg: "#e9c46a", cls: "sk-gold", pad }, K.lbl("top model", Math.min(hg * 0.12, w * 0.085), { wrap: true }), K.num(l1, Math.min(hg * 0.22, w * 0.2), { style: { marginTop: hg * 0.04 + "px" } }), l2 ? K.num(l2, Math.min(hg * 0.22, w * 0.2)) : null);
          } } : null,
          hero("tokens", compact(D.usage.tokens), "gold", "var(--ink)", { fg: "#fff" }),
        ].filter(Boolean);
        return done(K, { head: hd, artMin: 0.55, split: 0.34, center: false, art: art(K, items, { start: 700, gap2: 170, gap: 24, evenSides: true }) });
      } });

    // ================================================================ optional cards (only with their data; never in the default selection)
    /** A unit so that n items need at most `max` marks: 1, 2, 5, 10, 20, 50, ... */
    const unitFor = (n, max = 150) => { let q = 1; for (const step of [2, 2.5, 2]) { if (Math.ceil(n / q) <= max) break; q *= step; } while (Math.ceil(n / q) > max) q *= 10; return q; };
    const dur = (ms) => (ms >= 3_600_000 ? `${one(ms / 3_600_000)} hrs` : ms >= 60_000 ? `${int(ms / 60_000)} min` : `${int(ms / 1000)} sec`);
    /** A white sheet of n dot or square stickers in order, in the sticker colours. */
    function markSheet(K, n, shape) {
      return (w, hg) => {
        const pad = Math.round(Math.min(w, hg) * 0.08), el = K.stk(w, hg, { bg: "#fff", pad, r: Math.min(w, hg) * 0.08 });
        const iw = w - 2 * pad, ih = hg - 2 * pad, g = cellGrid(n, iw, ih, 0.28), sv = s("svg", { width: iw, height: ih, viewBox: `0 0 ${iw} ${ih}` });
        const ox = (iw - (g.cols * g.size + (g.cols - 1) * g.gap)) / 2, oy = (ih - (g.rows * g.size + (g.rows - 1) * g.gap)) / 2, sw = Math.max(1.5, g.size * 0.07);
        for (let i = 0; i < n; i++) {
          const x = ox + (i % g.cols) * (g.size + g.gap), y = oy + Math.floor(i / g.cols) * (g.size + g.gap), fill = DOTC[i % DOTC.length];
          sv.append(shape === "circle" ? s("circle", { cx: x + g.size / 2, cy: y + g.size / 2, r: g.size / 2 - sw / 2, fill, stroke: "var(--ink)", "stroke-width": sw })
            : s("rect", { x: x + sw / 2, y: y + sw / 2, width: g.size - sw, height: g.size - sw, rx: g.size * 0.2, fill, stroke: "var(--ink)", "stroke-width": sw }));
        }
        el.append(sv);
        return el;
      };
    }

    if (D.thinking) add({ id: "thinking", title: "Deep thoughts", dur: 6000,
      build(c) {
        const K = kitFor(c, "thinking"), F = (n) => n * K.K, TH = D.thinking, timed = TH.totalMs != null;
        const hd = head(K, [
          K.tape("deep thoughts", "var(--lilac)", { fg: "var(--ink)" }),
          K.cut(timed ? dur(TH.totalMs) : compact(TH.blocks), F(timed ? 200 : 260), "holo"),
          K.note(timed ? ["of thinking before answering, over ", h("b", {}, `${compact(TH.blocks)} thoughts`), "."] : "times the model stopped to think before answering.", { size: 38 }),
        ]);
        const per = unitFor(TH.blocks);
        const items = [
          { main: true, ars: [1, 1.4, 1.8], wt: 3, make: markSheet(K, Math.ceil(TH.blocks / per), "circle") },
          TH.longestMs != null ? { ar: 1, wt: 0.9, max: 340 * c.u, rmax: 9, make: (w, hg) => badge(K, w, hg, dur(TH.longestMs), "longest think", { bg: "var(--lemon)", numK: 0.2 }) } : null,
        ].filter(Boolean);
        return done(K, { head: hd, artMin: 0.3, split: 0.46, legend: per === 1 ? "one dot = one thought" : `one dot = ${int(per)} thoughts`, art: art(K, items, { start: 700 }) });
      } });

    if (D.approvals) add({ id: "approvals", title: "Rubber stamp", dur: 6000,
      build(c) {
        const K = kitFor(c, "approvals"), F = (n) => n * K.K, A = D.approvals;
        // the share of permission decisions nobody had to make: settings let them through, against those you answered
        const all = A.auto + A.byPerson + (A.denied || 0) || 1;
        const hd = head(K, [
          K.tape("rubber stamp", "var(--tomato)"),
          K.cut(`${Math.round((A.auto / all) * 100)}%`, F(300), "var(--mint)"),
          K.note(["of permission checks passed without asking you. You said yes ", h("b", {}, `${int(A.byPerson)} times`), "."], { size: 38 }),
        ]);
        const rows = [["by your settings", A.auto, "var(--mint)"], ["approved by you", A.byPerson, "var(--lemon)"], ["declined by you", A.denied, "var(--pink)"], ["blocked by auto-review", A.autoBlocked, "var(--sky)"]]
          .filter(([, v], i) => v != null && (i < 2 || v > 0));
        const items = rows.map(([label, v, bg], i) => ({ ar: 2.1, wt: i < 2 ? 1.2 : 0.8, max: 520 * c.u, make: (w, hg) => statRect(K, w, hg, compact(v), label, { bg }) }));
        return done(K, { head: hd, artMin: 0.3, split: 0.46, legend: `${int(A.sessions)} sessions recorded it`, art: art(K, items, { start: 700 }) });
      } });

    if (D.persona && D.persona.earned && D.persona.earned.length) add({ id: "titles", title: "Titles earned", dur: 6500,
      build(c) {
        const K = kitFor(c, "titles"), F = (n) => n * K.K, T = D.persona.earned;
        const hd = head(K, [
          K.tape(T.length === 1 ? "title earned" : `${T.length} titles earned`, "var(--cobalt)"),
          K.cut("Earned, not given.", F(120), "var(--ink)"),
        ]);
        const cols = ["var(--lemon)", "var(--mint)", "var(--pink)"];
        const items = T.map((t, i) => ({ ars: [1.5, 2.4, 3.6, 5], wt: 1, rmax: 1.6, make: (w, hg) => {
          const ts = Math.max(28, Math.min(hg * 0.3, w * 0.07, 78 * c.u)), ws = Math.max(22, Math.min(ts * 0.5, 34 * c.u));
          return K.stk(w, hg, { bg: cols[i], pad: Math.round(Math.min(hg * 0.12, 34 * c.u)), style: { flexDirection: "column", alignItems: "flex-start", justifyContent: "center", textAlign: "left" } },
            K.txtl(t.title, ts, { style: { fontFamily: "var(--display)", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.04 } }),
            K.txtl(t.rule, ws, { style: { marginTop: ts * 0.22 + "px", color: "var(--ink)", opacity: 0.72, fontWeight: 500 } }));
        } }));
        return done(K, { head: hd, artMin: 0.45, split: 0.38, legend: "from your ratios, by fixed rules", center: false, art: art(K, items, { start: 600, gap2: 260, gap: 22 }) });
      } });

    if (D.history) add({ id: "history", title: "History kept", dur: 6000,
      build(c) {
        const K = kitFor(c, "history"), F = (n) => n * K.K, Hh = D.history;
        const hd = head(K, [
          K.tape("history kept", "var(--cobalt)"),
          K.cut(`${int(Hh.days)} ${Hh.days === 1 ? "day" : "days"}`, F(200), "var(--sky)"),
          K.note(Hh.firstDay ? ["of sessions AI Insights still has, back to ", h("b", {}, dshort(Hh.firstDay)), "."] : "of sessions AI Insights still has.", { size: 38 }),
        ]);
        // a day per square up to 150 days, then a week, then a month: never more than about 150 marks
        const [per, word] = Hh.days <= 150 ? [1, "day"] : Hh.days <= 150 * 7 ? [7, "week"] : [30, "month"];
        const items = [
          { main: true, ars: [1, 1.4, 1.8], wt: 3, make: markSheet(K, Math.max(1, Math.ceil(Hh.days / per)), "square") },
          Hh.cachedOnly > 0 ? { ar: 1, wt: 0.9, max: 340 * c.u, rmax: 9, make: (w, hg) => badge(K, w, hg, compact(Hh.cachedOnly), "only in its cache", { bg: "var(--pink)" }) } : null,
        ].filter(Boolean);
        return done(K, { head: hd, artMin: 0.3, split: 0.46, legend: `one square = one ${word}`, art: art(K, items, { start: 700 }) });
      } });

    // ================================================================ 21. outro: the maker's card
    add({ id: "outro", title: "Made with", dur: 3500, noFoot: true, squareSide: true, dark: true, bg: "var(--brand-deep)", fg: "var(--brand-lime)",
      build(c) {
        const K = kitFor(c, "outro"), F = (n) => n * K.K;
        const pill = (txt, bg, fg) => h("div", { class: "sk-tape", "data-fit": PX(34 * K.K), "data-min": 22, style: { fontSize: PX(34 * K.K) + "px", background: bg, color: fg, letterSpacing: "0.02em", textTransform: "none", border: "5px solid #fff", borderRadius: "999px", padding: "0.28em 0.8em 0.34em" } }, txt);
        const hd = head(K, [
          K.tape("made with", "#FCFCF5", { fg: "#0E3422" }),
          K.cut("AI Insights", F(170), "var(--brand-lime)"),
          K.cut("by Matrix OS", F(84), "#FCFCF5", { plain: true }),
          pill(SHARE.skill, "#0E3422", "#BED77B"),
          pill("matrix-os.com", "#BED77B", "#0E3422"),
        ], 500);
        return done(K, { head: hd, artFirst: true, artMin: 0.32, split: 0.42, art: (w, hg) => {
          const d = Math.min(hg, w * 1.294) * 0.86, rw = (d * 510) / 660;
          const back = rabbitSvg("#fff", d + "px"), front = rabbitSvg("var(--brand-lime)", d + "px");
          back.style.width = front.style.width = rw + "px";
          [...back.children].forEach((p) => { p.setAttribute("stroke", "#fff"); p.setAttribute("stroke-width", 34); p.setAttribute("stroke-linejoin", "round"); });
          const stack = h("div", { style: { position: "relative", width: rw + "px", height: d + "px" } });
          back.style.position = front.style.position = "absolute"; back.style.left = front.style.left = "0"; back.style.top = front.style.top = "0";
          back.style.overflow = "visible";
          stack.append(back, front);
          const wrap = h("div", { style: { width: w + "px", height: hg + "px", display: "flex", alignItems: "center", justifyContent: "center" } }, stack);
          K.slap(stack, 100, -4, { from: 1.6 });
          return wrap;
        } });
      } });

    return SPECS;
  },
});
