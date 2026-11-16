/* styles/pop.js: "Pop", the default card style. Each spec = data + build(ctx) for any W x H.
   build returns { head, extra?, art?(w, h, x, y), artFirst?, artMin?, split?, legend?, post? }.
   The contract every style follows is docs/card-styles.md. */
registerCardStyle({ id: "pop", name: "Pop", swatch: "linear-gradient(135deg,#ff7a2f 50%,#c9b8ff 50%)", specs(D, kit) {
const SH = kit.share;
/** How to make your own, readable in a screenshot: the command, the skill, the site and the tag. */
const cta = (c, color, size = 30) => h("div", { class: "mk", style: { fontSize: size * c.k * c.u + "px", color } },
  h("span", { class: "cmd" }, SH.command), h("span", { class: "cmd" }, SH.skill), h("span", {}, SH.site), h("span", { class: "mktag" }, SH.hashtag));
const T = D.totals, R = D.rhythm, V = D.voice;
const rangeLabel = `${dshort(D.range.from)} – ${dshort(D.range.to)}`;
const activeDay = (d) => d.prompts > 0 || d.minutes > 0;
const topWeekday = R.weekdays.slice().sort((a, b) => b.count - a.count)[0];
const wd = (k) => R.weekdays.find((d) => d.key === k)?.count ?? 0;
const PALETTE = ["var(--orange)", "var(--purple)", "var(--mint)", "var(--yellow)", "var(--coral)", "var(--sky)", "var(--pink)"];
const SPECS = [];
const add = (spec) => SPECS.push(spec);

// ---------- shared builders
const kick = (txt, st) => h("div", { class: "kick", style: st }, txt);
function head(...kids) { return h("div", {}, ...kids); }
function enter(c, els, start = 100, gap = 130) { els.filter(Boolean).forEach((el, i) => c.tl.in(el, start + i * gap, { y: 70 * c.u })); }
const svgText = (c, x, y, str, o = {}) => s("text", { x, y, "text-anchor": o.anchor || "middle", "font-family": "GeistM, monospace", "font-weight": o.weight || 700, "font-size": o.size, fill: o.fill || "var(--ink)" }, document.createTextNode(str));
const svgBox = (w, hgt) => s("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, style: "overflow:visible" });
function countHero(c, cls, to, fmt, unit, start = 220) {
  const num = h("span", {}, fmt(to));
  const el = h("div", { class: cls }, num, unit ? h("span", { class: "unit" }, unit) : null);
  el.dataset.fit = Math.round((cls === "huge" ? 330 : 200) * c.k * c.u); el.dataset.min = Math.round(90 * c.u);
  c.tl.count(num, start, 1400, to, fmt);
  return el;
}
/** Ranked list sized to the box: shows fewer rows rather than crushing them. */
function rankList(c, rows, w, hgt, o = {}) {
  const minRow = (c.square ? 92 : 80) * c.u, maxRow = (o.maxRow || 136) * c.u;
  const n = Math.max(1, Math.min(rows.length, Math.floor(hgt / minRow)));
  const rowh = Math.min(maxRow, hgt / n);
  const top = Math.max(...rows.map((r) => r.count), 1);
  const els = rows.slice(0, n).map((r, i) => {
    const bar = o.bars ? h("i", { class: "bar", style: { width: `${(r.count / top) * 100}%` } }) : null;
    const row = h("div", { class: "row" + (i === 0 && !o.noTop ? " top" : "") },
      h("span", { class: "n" }, (o.startN || 1) + i),
      h("span", { class: "l" + (o.mono ? " mono" : ""), "data-fit": Math.round(rowh * (o.mono ? 0.42 : 0.5)), "data-min": Math.round(rowh * 0.17) }, r.key),
      h("span", { class: "v" }, o.fmt ? o.fmt(r) : int(r.count)), bar);
    row._bar = bar;
    return row;
  });
  const wrap = h("div", { class: "list", style: { "--rowh": rowh + "px", width: w + "px" } }, els);
  c.tl.stagger(els, o.start || 800, 110, (row, st) => { c.tl.in(row, st, { x: -80 * c.u, y: 0, dur: 650 }); if (row._bar) c.tl.grow(row._bar, st + 150, { axis: "X", origin: "0 50%", dur: 900 }); });
  return wrap;
}
function blobPath(values, cx, cy, r0, k, grow = 1, wobble = 0, t = 0) {
  const max = Math.max(...values, 1), n = values.length;
  return smooth(values.map((v, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = r0 + k * Math.sqrt(v / max) * grow + wobble * Math.sin(t / 700 + i * 1.7);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }), true, 1.05);
}
function sigil(c, cx, cy, R, o = {}) { // R here is the radius
  const { fill = "var(--orange)", stroke = "var(--ink)", dayOn = "var(--ink)", sw = 8 } = o;
  const g = s("g");
  const blob = s("path", { d: blobPath(D.rhythm.hours, cx, cy, R * 0.34, R * 0.46), fill, stroke, "stroke-width": sw, "stroke-linejoin": "round" });
  g.append(blob);
  const dots = D.daily.map((d, i, arr) => {
    const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2, on = activeDay(d), sz = on ? R * 0.085 : R * 0.05;
    const px = cx + Math.cos(a) * R * 0.98, py = cy + Math.sin(a) * R * 0.98;
    const rc = s("rect", { x: px - sz / 2, y: py - sz / 2, width: sz, height: sz, fill: on ? dayOn : "transparent", stroke: dayOn, "stroke-width": on ? 0 : Math.max(2, R * 0.01), transform: `rotate(${(a * 180) / Math.PI} ${px} ${py})` });
    g.append(rc); return rc;
  });
  return { g, blob, dots };
}
function checker(x, y, cols, rows, size) {
  const g = s("g", { fill: "var(--ink)" }), cells = [];
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) if ((r + q) % 2 === 0) { const rc = s("rect", { x: x + q * size, y: y + r * size, width: size, height: size }); g.append(rc); cells.push(rc); }
  return { g, cells };
}
function waffle(c, alloc, colors, w, hgt) {
  const total = alloc.reduce((a, b) => a + b, 0);
  const g = (w / hgt < 0.45 ? [5, 10] : [10, 20, 25]).map((cols) => cellGrid(total, w, hgt, 0.18, cols)).sort((a, b) => b.size - a.size)[0];
  const svg = svgBox(g.cols * (g.size + g.gap) - g.gap, g.rows * (g.size + g.gap) - g.gap);
  const cells = []; let idx = 0;
  alloc.forEach((n, ci) => { for (let j = 0; j < n; j++, idx++) { const rc = s("rect", { x: (idx % g.cols) * (g.size + g.gap), y: Math.floor(idx / g.cols) * (g.size + g.gap), width: g.size, height: g.size, rx: g.size * 0.13, fill: colors[ci], stroke: "var(--ink)", "stroke-width": Math.max(2, g.size * 0.08) }); svg.append(rc); cells.push(rc); } });
  c.tl.stagger(cells, 600, 8, (rc, st) => c.tl.pop(rc, st, { dur: 450 }));
  return svg;
}

// 1. intro ---------------------------------------------------------------
add({ id: "intro", title: "Intro", bg: "var(--orange)", fg: "var(--ink)", dur: 5200, squareSide: false,
  build(c) {
    const k = kick(`${rangeLabel}, ${D.range.to.slice(0, 4)}`);
    const t1 = h("div", { class: "big", style: { fontSize: 176 * c.k * c.u + "px", marginTop: 0.5 * 34 * c.k + "px" } }, "Your last");
    const t2 = h("div", { class: "big", "data-fit": Math.round(176 * c.k * c.u), "data-min": Math.round(80 * c.u), style: { whiteSpace: "nowrap" } }, `${D.range.days} days, with AI.`);
    const names = T.harnesses.map((x) => harnessName(x.key));
    const who = names.length === 0 ? "Your coding agents" : names.length <= 2 ? names.join(" and ") : names.length === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : `${names.length} coding agents`;
    const p = h("div", { class: "p gap1" }, `${who}, looked back on. `, h("b", {}, `${T.activeDays} busy days`), ` out of ${D.range.days}.`);
    c.tl.in(k, 250).in(t1, 380, { y: 120 }).in(t2, 520, { y: 120 }).in(p, 900);
    return { head: head(k, t1, t2, p), artFirst: true, artMin: 0.32, split: 0.55, legend: "one square = one day",
      art(w, hgt) {
        // A month keeps the six-wide grid; a longer history picks the column count that keeps squares biggest.
        const nd = D.daily.length;
        const g = nd > 42 ? cellGrid(nd, w, hgt, 0.18) : cellGrid(nd, w, hgt, 0.14, c.wide ? 6 : c.tall && hgt > w ? 5 : 6);
        const svg = svgBox(w, hgt);
        const gw = g.cols * (g.size + g.gap) - g.gap, gh = g.rows * (g.size + g.gap) - g.gap;
        const ox = c.wide ? 0 : w - gw, oy = (hgt - gh) / 2;
        const cells = D.daily.map((d, i) => { const r = s("rect", { x: ox + (i % g.cols) * (g.size + g.gap), y: oy + Math.floor(i / g.cols) * (g.size + g.gap), width: g.size, height: g.size, rx: g.size * 0.08, fill: activeDay(d) ? "var(--ink)" : "none", stroke: "var(--ink)", "stroke-width": Math.max(3, g.size * 0.05) }); svg.append(r); return r; });
        c.tl.stagger(cells, 150, Math.min(28, 1400 / Math.max(1, nd)), (r, st) => c.tl.pop(r, st, { dur: 700 }));
        return svg;
      } };
  } });

// 2. hours ----------------------------------------------------------------
add({ id: "hours", title: "Time", bg: "var(--lilac)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const k = kick("time with your agents");
    const big = countHero(c, "huge", T.wallHours, int, " hrs");
    const p = h("div", { class: "p gap1" }, "with at least one agent at work. Side by side, they logged ", h("b", {}, `${int(T.agentHours)} agent-hours`), ".");
    const pills = h("div", { class: "pills gap1" }, h("span", { class: "pill" }, `${int(T.sessions)} sessions`), h("span", { class: "pill" }, `${int(T.prompts)} prompts`));
    enter(c, [k, big, p, pills], 100, 200);
    return { head: head(k, big, p, pills), artMin: 0.28, split: 0.48, legend: "ribbon = agent time per day",
      art(w, hgt) {
        const svg = svgBox(w, hgt);
        const mins = D.daily.map((d) => d.minutes);
        const sm = mins.map((v, i) => (v + (mins[i - 1] ?? v) + (mins[i + 1] ?? v)) / 3);
        const max = Math.max(...sm, 1), bands = 5, bw = Math.max(16, Math.min(44 * c.u, hgt / 14));
        const amp = hgt - bw * bands - 10;
        ["var(--orange)", "var(--purple)", "var(--mint)", "var(--yellow)", "var(--coral)"].forEach((col, b) => {
          const off = (b - 2) * (bw - 2);
          const pts = sm.map((v, i) => [lerp(-c.P, w + c.P, i / (sm.length - 1)), hgt - bw * 2.6 - amp * Math.sqrt(v / max) + off]);
          const p = s("path", { d: smooth(pts), stroke: col, "stroke-width": bw, fill: "none", "stroke-linecap": "round" });
          svg.append(p); c.tl.draw(p, 500 + b * 90, 1600);
        });
        return svg;
      } };
  } });

// 3. clock ----------------------------------------------------------------
add({ id: "clock", title: "Clock", bg: "var(--yellow)", fg: "var(--ink)", dur: 7000, squareSide: false,
  build(c) {
    const kk = kick("when you prompt");
    const v = h("div", { class: "big", "data-fit": Math.round(200 * c.k * c.u), "data-min": Math.round(90 * c.u), style: { whiteSpace: "nowrap" } }, `${R.verdict.label}.`);
    const quiet = R.quiet.len >= 3 ? [" Never between ", h("b", {}, `${hh(R.quiet.start)}–${hh((R.quiet.start + R.quiet.len) % 24)}`), "."] : "";
    const p = h("div", { class: "p gap1" }, h("b", {}, pct(R.nightShare)), " of your prompts came after 22:00. Golden hour: ", h("b", {}, hh(R.peakHour)), ".", quiet);
    const shifts = R.harnessPeaks.length > 1 ? h("div", { class: "pills" }, R.harnessPeaks.map((hp) => h("span", { class: "pill solid", style: { color: "var(--yellow)" } }, `${harnessName(hp.key)} peaks ${hh(hp.peak)}`))) : null;
    c.tl.in(kk, 100).in(v, 250, { y: 100 }).in(p, 1200);
    if (shifts) c.tl.stagger([...shifts.children], 1500, 140, (el, st) => c.tl.pop(el, st, { dur: 600 }));
    return { head: head(kk, v, c.mode === "side" ? null : p), extra: c.mode === "side" ? h("div", {}, p, shifts && h("div", { class: "gap1" }, shifts)) : shifts, artMin: c.square ? 0.46 : 0.34, split: 0.52, legend: "blob = prompts per hour",
      art(w, hgt) {
        const svg = svgBox(w, hgt), cx = w / 2, cy = hgt / 2, Rr = Math.min(w, hgt) / 2 * 0.96;
        const r0 = Rr * 0.48, kk2 = Rr * 0.52, dr = Rr * 0.41, sw = Math.max(3, Rr * 0.018);
        const dial = s("g");
        dial.append(s("circle", { cx, cy, r: dr, fill: "var(--paper)", stroke: "var(--ink)", "stroke-width": sw }));
        if (R.quiet.len >= 3) {
          const a0 = (R.quiet.start / 24) * Math.PI * 2 - Math.PI / 2, a1 = ((R.quiet.start + R.quiet.len) / 24) * Math.PI * 2 - Math.PI / 2;
          dial.append(s("path", { d: `M${cx},${cy}L${cx + Math.cos(a0) * dr},${cy + Math.sin(a0) * dr}A${dr},${dr} 0 0 1 ${cx + Math.cos(a1) * dr},${cy + Math.sin(a1) * dr}Z`, fill: "var(--lilac)", opacity: 0.9 }));
        }
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2 - Math.PI / 2, major = i % 6 === 0, r2 = dr - (major ? Rr * 0.087 : Rr * 0.043);
          dial.append(s("line", { x1: cx + Math.cos(a) * dr, y1: cy + Math.sin(a) * dr, x2: cx + Math.cos(a) * r2, y2: cy + Math.sin(a) * r2, stroke: "var(--ink)", "stroke-width": major ? sw : sw / 2, "stroke-linecap": "round" }));
        }
        for (const i of [0, 6, 12, 18]) { const a = (i / 24) * Math.PI * 2 - Math.PI / 2, rr = dr * 0.6; dial.append(svgText(c, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + Rr * 0.028, String(i).padStart(2, "0"), { size: Rr * 0.078 })); }
        const blob = s("path", { fill: "var(--orange)", stroke: "var(--ink)", "stroke-width": sw * 1.1, "stroke-linejoin": "round" });
        const pa = (R.peakHour / 24) * Math.PI * 2 - Math.PI / 2;
        const hand = s("line", { x1: cx, y1: cy, x2: cx + Math.cos(pa) * dr * 0.74, y2: cy + Math.sin(pa) * dr * 0.74, stroke: "var(--ink)", "stroke-width": sw * 1.7, "stroke-linecap": "round" });
        svg.append(blob, dial, hand, s("circle", { cx, cy, r: Rr * 0.045, fill: "var(--ink)" }));
        let grow = 0;
        c.tl.at(200, 1700, "out5", (p2) => { grow = p2; });
        c.tl.idle((t) => blob.setAttribute("d", blobPath(R.hours, cx, cy, r0, kk2, grow, Rr * 0.016 * clamp((t - 1900) / 800), t)));
        c.tl.pop(dial, 100, { dur: 900 });
        c.tl.at(900, 900, "spring", (p2) => { hand.setAttribute("transform", `rotate(${(1 - p2) * -200} ${cx} ${cy})`); hand.style.opacity = clamp(p2 * 3); });
        return svg;
      } };
  } });

// 4. weekday --------------------------------------------------------------
add({ id: "weekday", title: "Weekdays", bg: "var(--mint)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const k = kick("favourite day");
    const big = h("div", { class: "big", "data-fit": Math.round(210 * c.k * c.u), "data-min": Math.round(90 * c.u), style: { whiteSpace: "nowrap" } }, `${DAYNAME[topWeekday.key]}.`);
    const fri = wd("Fri") / Math.max(1, T.prompts);
    const p = h("div", { class: "p gap1" }, h("b", {}, pct(topWeekday.count / T.prompts)), " of your prompts. ", fri < 0.08 ? ["Fridays? Just ", h("b", {}, pct(fri)), ". TGIF, apparently."] : "");
    c.tl.in(k, 100).in(big, 220, { y: 100 }).in(p, 700);
    return { head: head(k, big, p), artMin: 0.36, split: 0.46, legend: "prompts by weekday",
      art(w, hgt) {
        const svg = svgBox(w, hgt), max = Math.max(...R.weekdays.map((d) => d.count), 1);
        const slot = w / 7, bw = slot * 0.8, fs = Math.min(34 * c.u, bw * 0.3), base = hgt - fs * 2.2, hmax = base - fs * 2;
        R.weekdays.forEach((d, i) => {
          const hg = Math.max(bw * 0.24, (d.count / max) * hmax), x = i * slot + (slot - bw) / 2;
          const r = s("rect", { x, y: base - hg, width: bw, height: hg, rx: bw / 2, fill: d.key === topWeekday.key ? "var(--ink)" : "var(--paper)", stroke: "var(--ink)", "stroke-width": Math.max(3, bw * 0.06) });
          const val = svgText(c, x + bw / 2, base - hg - fs * 0.6, int(d.count), { size: fs });
          svg.append(r, svgText(c, x + bw / 2, hgt - fs * 0.2, d.key.slice(0, 2).toUpperCase(), { size: fs }), val);
          c.tl.grow(r, 500 + i * 90, { dur: 1000, ease: "spring" }); c.tl.in(val, 900 + i * 90, { y: 20, dur: 400 });
        });
        return svg;
      } };
  } });

// 5. streak ---------------------------------------------------------------
add({ id: "streak", title: "Streak", bg: "var(--coral)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const k = kick("longest streak");
    const big = countHero(c, "huge", D.streak.days, int, " days", 200);
    const p = h("div", { class: "p gap1" }, `in a row, ${dshort(D.streak.start)} to ${dshort(D.streak.end)}. `, h("b", {}, `${T.activeDays} active days`), ` out of ${D.range.days}.`);
    const bd = D.bigDay ? h("div", { style: { display: "flex", alignItems: "center", gap: 26 * c.k + "px" } }, h("span", { style: { width: 60 * c.k + "px", height: 60 * c.k + "px", borderRadius: "50%", background: "var(--yellow)", border: `${5 * c.k}px solid var(--ink)`, flex: "none" } }), h("span", { class: "h3" }, `Biggest day: ${int(D.bigDay.prompts)} prompts on a ${DAYNAME[D.bigDay.weekday].slice(0, -1)}.`)) : null;
    c.tl.in(k, 100).in(big, 200).in(p, 700);
    if (bd) c.tl.in(bd, 1800);
    return { head: head(k, big, p), extra: bd, artMin: c.square ? 0.44 : 0.3, split: 0.5, legend: "dark = the streak",
      art(w, hgt) {
        const firstDow = (new Date(D.range.from + "T12:00:00Z").getUTCDay() + 6) % 7;
        const weeks = Math.ceil((D.daily.length + firstDow) / 7);
        const inS = (day) => D.streak.start && day >= D.streak.start && day <= D.streak.end;
        const svg = svgBox(w, hgt);
        let pos, size, labels;
        if (weeks <= 6) {
          // A month or so: the calendar as you know it, one row per week.
          const fs = Math.min(32 * c.u, w / 7 * 0.3), hdr = fs * 1.8;
          const g = cellGrid(weeks * 7, w, hgt - hdr, 0.17, 7);
          const ox = c.mode === "side" ? (w - (7 * (g.size + g.gap) - g.gap)) / 2 : 0;
          size = g.size;
          pos = (j) => [ox + (j % 7) * (g.size + g.gap), hdr + Math.floor(j / 7) * (g.size + g.gap)];
          labels = () => ["M", "T", "W", "T", "F", "S", "S"].forEach((l, i) => svg.append(svgText(c, ox + i * (g.size + g.gap) + g.size / 2, fs, l, { size: fs })));
        } else {
          // Months: weeks run left to right in bands of seven rows (Mon..Sun), as many bands as keep squares biggest.
          const lab = Math.min(34 * c.u, w * 0.04), bandGap = 18 * c.u;
          let best = null;
          for (let bands = 1; bands <= 6; bands++) {
            const per = Math.ceil(weeks / bands), pitch = Math.min((w - lab * 1.6) / per, (hgt - (bands - 1) * bandGap) / (7 * bands));
            if (!best || pitch > best.pitch) best = { bands, per, pitch };
          }
          const pitch = best.pitch, gap = Math.max(1.5, pitch * 0.16), bandH = 7 * pitch + bandGap, ox = lab * 1.6;
          size = pitch - gap;
          pos = (j) => { const wk = Math.floor(j / 7), band = Math.floor(wk / best.per); return [ox + (wk % best.per) * pitch, band * bandH + (j % 7) * pitch]; };
          const fs = Math.min(lab, pitch * 0.9);
          labels = () => { for (let band = 0; band < best.bands; band++) ["M", "W", "F"].forEach((l, i) => svg.append(svgText(c, lab * 0.6, band * bandH + i * 2 * pitch + size / 2 + fs * 0.35, l, { size: fs }))); };
        }
        labels();
        const sw = Math.max(1.5, Math.min(6, size * 0.055));
        const cells = D.daily.map((d, i) => {
          const [x, y] = pos(i + firstDow);
          const r = s("rect", { x, y, width: size, height: size, rx: size * 0.08, fill: inS(d.day) ? "var(--ink)" : activeDay(d) ? "var(--paper)" : "none", stroke: "var(--ink)", "stroke-width": sw });
          svg.append(r);
          if (D.bigDay && d.day === D.bigDay.day) { const star = s("circle", { cx: x + size / 2, cy: y + size / 2, r: Math.max(size * 0.3, 7 * c.u), fill: "var(--yellow)", stroke: size < 30 ? "var(--ink)" : "none", "stroke-width": 3 * c.u }); svg.append(star); c.tl.pop(star, 1700, { dur: 700 }); }
          return r;
        });
        c.tl.stagger(cells, 300, Math.min(30, 1300 / Math.max(1, cells.length)), (r, st) => c.tl.pop(r, st, { dur: 650 }));
        return svg;
      } };
  } });

// 6. words ----------------------------------------------------------------
add({ id: "words", title: "Words", bg: "var(--paper)", fg: "var(--ink)", dur: 7000, squareSide: false,
  insets: (c) => ({ top: Math.round(c.P * 0.3), bottom: 0 }),
  build(c) {
    const sz = c.P * 0.42, ch = checker(0, 0, Math.ceil(c.W / sz), 2, sz);
    c.art.append(ch.g); c.tl.stagger(ch.cells, 50, 12, (r, st) => c.tl.pop(r, st, { dur: 500 }));
    const w0 = V.words[0];
    const k = kick("your favourite word", { color: "var(--red)" });
    const word = h("span", { style: { display: "inline-block", position: "relative" } }, w0.key);
    const big = h("div", { class: "huge", "data-fit": Math.round(320 * c.k * c.u), "data-min": Math.round(120 * c.u), style: { marginTop: 30 * c.k + "px" } }, word);
    const p = h("div", { class: "p gap1" }, "Showed up in ", h("b", {}, `${int(w0.count)} prompts`), ".");
    const op = V.openers[0];
    const opener = op ? h("div", {}, kick("how you open", { color: "var(--red)" }), h("div", { class: "h2", style: { marginTop: 18 * c.k + "px" } }, `“${op.key}…”`), h("div", { class: "p", style: { marginTop: 12 * c.k + "px" } }, `${int(op.count)} prompts start this way.`)) : null;
    c.tl.in(k, 150).in(big, 250, { y: 100 }).in(p, 600);
    if (opener) c.tl.in(opener, 1400);
    return { head: head(k, big, p), extra: opener, artMin: 0.22, split: 0.52, legend: "from a fixed dev vocabulary",
      art(w, hgt) { return rankList(c, V.words.slice(1, 5), w, hgt, { startN: 2, noTop: true, fmt: (r) => `×${int(r.count)}` }); },
      post(rect) {
        const b = rect(word);
        const rx = b.w / 2 + 40 * c.k, ry = b.h / 2 + 18 * c.k, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const r = rng(w0.count), pts = [];
        for (let i = 0; i <= 41; i++) { const a = (i / 36) * Math.PI * 2 - 2.4, j = 1 + (r() - 0.5) * 0.07 + i * 0.0025; pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]); }
        const scr = s("path", { d: smooth(pts), fill: "none", stroke: "var(--red)", "stroke-width": 12 * c.k, "stroke-linecap": "round" });
        c.art.append(scr); c.tl.draw(scr, 700, 900);
      } };
  } });

// 7. manners --------------------------------------------------------------
add({ id: "manners", title: "Manners", bg: "var(--pink)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const plz = V.polite.please, ty = V.polite.thanks;
    const k = kick("manners check");
    const line = (n, word) => h("div", { style: { display: "flex", alignItems: "baseline", gap: 30 * c.k + "px" } }, h("span", { class: "huge", style: { fontSize: 250 * c.k * c.u + "px" } }, int(n)), h("span", { class: "h2" }, word));
    const a = line(plz, plz === 1 ? "please" : "pleases"), b = line(ty, ty === 1 ? "thank you" : "thank-yous");
    const quip = ty === 0 ? "The agents will live." : plz > ty ? "Polite, mostly." : "Very gracious.";
    const q = h("div", { class: "gap1" }, h("div", { class: "h3" }, quip), h("div", { class: "p", style: { marginTop: 12 * c.k + "px" } }, h("b", {}, pct(V.questionShare)), " of your prompts were questions."));
    c.tl.in(k, 100).pop(a, 250).pop(b, 550).in(q, 950);
    const L = V.leverage;
    let lev = null, sparkleArea = null;
    return { head: head(k, h("div", { style: { marginTop: 20 * c.k + "px" } }, a), h("div", { style: { marginTop: 10 * c.k + "px" } }, b), q), artMin: 0.24, split: 0.5, legend: `${int(V.prompts)} prompts you typed`,
      art: L ? (w, hgt, x, y) => {
        const box = lev = h("div", { class: "boxed", style: { maxWidth: w + "px" } },
          kick("shortest prompt, biggest job"),
          h("div", { class: "h1", style: { marginTop: 20 * c.k + "px" } }, `${L.words} word${L.words === 1 ? "" : "s"} →`),
          h("div", { class: "h1", "data-fit": Math.round(124 * c.k * c.u), "data-min": Math.round(50 * c.u), style: { color: "var(--red)", whiteSpace: "nowrap" } }, `${int(L.toolCalls)} tool calls`),
          h("div", { class: "p", style: { marginTop: 14 * c.k + "px" } }, "before you said anything else."));
        c.tl.in(box, 1250, { y: 120, rot: -3 });
        sparkleArea = { x, y, w, h: hgt };
        return box;
      } : null,
      // Sparkles go where the box is not: tried in a seeded order, dropped when they would touch the box or text.
      post: L ? (rect) => {
        const bx = rect(lev), keep = [rect(a), rect(b), rect(q), bx].map((r0) => ({ x: r0.x - 20 * c.u, y: r0.y - 20 * c.u, w: r0.w + 40 * c.u, h: r0.h + 40 * c.u }));
        const A = sparkleArea, r = rng(plz * 31 + 5);
        let placed = 0;
        for (let tries = 0; tries < 60 && placed < 7; tries++) {
          const sz = (20 + r() * 26) * c.u, sx = A.x - c.P * 0.4 + r() * (A.w + c.P * 0.8), sy = A.y - c.P * 0.3 + r() * (A.h + c.P * 0.6);
          if (sx - sz < 8 || sx + sz > c.W - 8 || sy - sz < 8 || sy + sz > c.H - 8 - 90 * c.u) continue;
          if (keep.some((k2) => sx + sz > k2.x && sx - sz < k2.x + k2.w && sy + sz > k2.y && sy - sz < k2.y + k2.h)) continue;
          const i = placed++;
          const st = s("path", { d: `M${sx},${sy - sz}L${sx + sz * 0.28},${sy - sz * 0.28}L${sx + sz},${sy}L${sx + sz * 0.28},${sy + sz * 0.28}L${sx},${sy + sz}L${sx - sz * 0.28},${sy + sz * 0.28}L${sx - sz},${sy}L${sx - sz * 0.28},${sy - sz * 0.28}Z`, fill: i % 2 ? "var(--ink)" : "var(--red)" });
          c.art.append(st); c.tl.pop(st, 400 + i * 120, { dur: 700 });
          c.tl.idle((t) => st.setAttribute("transform", `rotate(${Math.sin(t / 900 + i) * 8} ${sx} ${sy})`));
          keep.push({ x: sx - sz, y: sy - sz, w: sz * 2, h: sz * 2 });
        }
      } : null };
  } });

// 8. slash ----------------------------------------------------------------
add({ id: "slash", title: "Slash commands", bg: "var(--sky)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const top = D.slash[0];
    const k = kick("most-typed slash command");
    const cur = h("span", { style: { display: "inline-block", width: "0.5em", height: "0.8em", background: "var(--ink)", marginLeft: "0.08em", verticalAlign: "-0.05em" } });
    const big = h("div", { class: "big mono", "data-fit": Math.round(210 * c.k * c.u), "data-min": Math.round(80 * c.u), style: { fontWeight: 700, whiteSpace: "nowrap", marginTop: 20 * c.k + "px" } }, top.key, cur);
    const p = h("div", { class: "p gap1" }, h("b", {}, `${int(top.count)} times`), `, out of ${int(D.slashTotal)} slash commands you typed.`);
    c.tl.in(k, 100).in(big, 220, { x: -60, y: 0 }).in(p, 600);
    c.tl.idle((t) => { cur.style.opacity = t < 1000 ? 1 : Math.floor(t / 530) % 2 ? 0 : 1; });
    return { head: head(k, big, p), artMin: 0.3, split: 0.5, legend: "built-ins by name",
      art(w, hgt) { return rankList(c, D.slash, w, hgt, { mono: true, bars: true, fmt: (r) => `×${int(r.count)}` }); } };
  } });

// 9. shell hall of fame ---------------------------------------------------
add({ id: "shell", title: "Hall of fame", bg: "var(--purple)", fg: "var(--paper)", dur: 6500, dark: true, squareSide: false,
  build(c) {
    const k = kick("bash hall of fame");
    const big = countHero(c, "huge", D.shell.calls, int, null, 200);
    big.dataset.fit = Math.round(240 * c.k * c.u);
    const p = h("div", { class: "p gap1" }, "shell commands your agents ran. ", h("b", {}, `${int(T.toolsPerPrompt)} tool calls`), " for every prompt you typed.");
    c.tl.in(k, 100).in(big, 200).in(p, 700);
    return { head: head(k, big, p), artMin: 0.3, split: 0.5, legend: "first program per command",
      art(w, hgt) { return rankList(c, D.shell.programs, w, hgt, { mono: true, bars: true, fmt: (r) => compact(r.count), start: 900 }); } };
  } });

// 10. tests + commits -----------------------------------------------------
add({ id: "tests", title: "Tests", bg: "var(--lime)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const S = D.shell;
    const k = kick("test runs");
    const big = countHero(c, "huge", S.tests, int, null, 200);
    const p = h("div", { class: "p gap1" }, "times your agents ran the tests. ", h("b", {}, `${pct(S.testPass ?? 0)} passed`), ".");
    const cm = h("div", { style: { borderTop: `${6 * c.k}px solid var(--ink)`, paddingTop: 34 * c.k + "px" } },
      kick("then they shipped"),
      h("div", { style: { display: "flex", alignItems: "baseline", gap: 26 * c.k + "px", marginTop: 14 * c.k + "px" } }, h("span", { class: "big", style: { fontSize: 170 * c.k * c.u + "px" } }, int(T.commits)), h("span", { class: "h2" }, "commits")),
      h("div", { class: "p", style: { marginTop: 14 * c.k + "px" } }, h("b", {}, pct(T.commitShare)), " of your sessions ended with at least one."));
    c.tl.in(k, 100).in(big, 200).in(p, 600).in(cm, 1500);
    const pass = Math.round((S.testPass ?? 0) * 100);
    return { head: head(k, big, p), extra: cm, artMin: 0.16, split: 0.5, legend: "one square = 1% of runs",
      art(w, hgt) { return waffle(c, [pass, 100 - pass], ["var(--ink)", "var(--coral)"], w, hgt); } };
  } });

// 11. danger --------------------------------------------------------------
add({ id: "danger", title: "Danger", bg: "var(--paper)", fg: "var(--ink)", dur: 6500, squareSide: false,
  insets: (c) => ({ top: Math.round(c.P * 0.9), bottom: Math.round(c.P * 0.9) }),
  build(c) {
    const S = D.shell, sh = c.P * 1.45, step = sh * 0.86;
    const mk = () => { const g = s("g"); for (let i = -2; i < c.W / step + 3; i++) g.append(s("path", { d: `M${i * step},0l${step / 2},0l${-step},${sh}l${-step / 2},0z`, fill: "var(--ink)" })); return g; };
    const top = mk(), bot = mk();
    c.art.append(top, bot);
    c.tl.idle((t) => { top.setAttribute("transform", `translate(${(t / 25) % step},${-sh * 0.35})`); bot.setAttribute("transform", `translate(${-((t / 25) % step)},${c.H - sh * 0.65})`); });
    const k = kick("living dangerously", { color: "var(--red)" });
    const p = h("div", { class: "p gap1" }, "Nothing caught fire. Probably.", S.sleeps ? [" Also: ", h("b", {}, `${int(S.sleeps)} naps`), " while waiting on something."] : "");
    c.tl.pop(k, 100).in(p, 1200);
    return { head: head(k), extra: p, artMin: 0.4, split: 0.36, legend: "run by your agents",
      art(w, hgt) {
        const row = w / hgt > 1.25, gap = (row ? 70 : 40) * c.u;
        const bw = row ? (w - gap) / 2 : w, bh = row ? hgt : (hgt - gap) / 2;
        const numSize = (n) => Math.min(330 * c.u, bh * 0.62, bw / (String(int(n)).length * 0.62));
        const chipSize = (txt) => Math.min(84 * c.u, bh * 0.16, bw / (txt.length * 0.66));
        const chip = (txt, bg, fg) => h("div", { class: "mono", style: { fontWeight: 700, marginTop: 14 * c.u + "px", fontSize: chipSize(txt) + "px", whiteSpace: "nowrap" } }, h("span", { style: { display: "inline-block", background: bg, color: fg, borderRadius: "0.25em", padding: "0.05em 0.35em 0.15em" } }, txt));
        const big = (n, col) => h("div", { class: "huge", style: { color: col, fontSize: numSize(n) + "px" } }, int(n));
        const a = h("div", {}, big(S.rmrf), chip("rm -rf", "var(--ink)", "var(--paper)"));
        const b = h("div", {}, big(S.forcePush, "var(--red)"), chip("git push --force", "var(--red)", "var(--paper)"));
        c.tl.in(a, 250, { sc: 1.4, y: 0, dur: 700 }).in(b, 700, { sc: 1.4, y: 0, dur: 700 });
        c.tl.at(1050, 450, "lin", (pp) => { b.style.translate = `${Math.sin(pp * Math.PI * 8) * (1 - pp) * 16}px 0`; });
        return h("div", { style: { display: "flex", flexDirection: row ? "row" : "column", justifyContent: "space-around", gap: gap + "px", width: w + "px", height: hgt + "px" } }, a, b);
      }, artAlign: "start" };
  } });

// 12. parallel ------------------------------------------------------------
add({ id: "parallel", title: "Parallel", bg: "var(--orange)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const n = D.parallel.max;
    const k = kick("most agents at once");
    const big = h("div", { class: "huge", style: { fontSize: 460 * c.k * c.u + "px" } }, int(n));
    const p = h("div", { class: "p gap1" }, "sessions running side by side. Plus ", h("b", {}, `${int(D.parallel.subagents)} subagents`), " launched along the way.");
    c.tl.in(k, 100).pop(big, 200, { dur: 1000 }).in(p, 700);
    // Lanes are drawn from the recap's real start and end shares when it has them; otherwise N identical
    // bars, a plain picture of N sessions with no time axis, so nothing looks like data that is not.
    const lanes = D.parallel.lanes;
    return { head: head(k, big, p), artMin: 0.3, split: 0.46, legend: lanes ? "one lane = one session, around the peak" : "one bar = one session",
      art(w, hgt) {
        const svg = svgBox(w, hgt), m = Math.min(n, lanes ? lanes.length : 40);
        const lh = Math.min(48 * c.u, (hgt - 40) / m * 0.8), gap = Math.min(14 * c.u, (hgt - 40) / m * 0.2);
        const y0 = (hgt - m * (lh + gap)) / 2, nowX = w * 0.5;
        for (let i = 0; i < m; i++) {
          const a = lanes ? lanes[i][0] * w : 0, b = lanes ? lanes[i][1] * w : w, y = y0 + i * (lh + gap) + lh / 2;
          const ln = s("line", { x1: a + lh / 2, y1: y, x2: b - lh / 2, y2: y, stroke: ["var(--ink)", "var(--paper)", "var(--purple)"][i % 3], "stroke-width": lh, "stroke-linecap": "round" });
          svg.append(ln); c.tl.draw(ln, 400 + i * 70, 900, "out5");
        }
        if (lanes) { const now = s("line", { x1: nowX, y1: y0 - 20, x2: nowX, y2: y0 + m * (lh + gap) + 10, stroke: "var(--ink)", "stroke-width": 6 * c.u, "stroke-dasharray": "14 12" }); svg.append(now); c.tl.in(now, 1300, { y: 0, dur: 400 }); }
        return svg;
      } };
  } });

// 13. marathon ------------------------------------------------------------
add({ id: "marathon", title: "Marathon", bg: "var(--sky)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const L = D.longestSession, days = L.wallMinutes / 1440;
    const k = kick("longest session");
    const big = countHero(c, "huge", L.activeMinutes / 60, one, " hrs", 200);
    const p = h("div", { class: "p gap1" }, `of active work in one ${harnessName(L.harness)} session`, days >= 1 ? [", spread over ", h("b", {}, `${one(days)} days`), "."] : ".");
    c.tl.in(k, 100).in(big, 200).in(p, 700);
    return { head: head(k, big, p), artMin: 0.3, split: 0.48, legend: "active = gaps under 10 min",
      art(w, hgt, x, y) {
        const stats = [[int(L.prompts), "prompts from you"], [L.toolCallsCapped ? `${int(L.toolCalls)}+` : capped(L.toolCalls), "tool calls"], [int(L.compactions), "context resets"]];
        const rowH = Math.min(150 * c.u, hgt / 3.2);
        const rows = stats.map(([v, l]) => h("div", { style: { display: "flex", alignItems: "baseline", gap: 26 * c.k + "px", borderTop: `${4 * c.k + 1}px solid var(--ink)`, height: rowH + "px", paddingTop: rowH * 0.14 + "px" } },
          h("span", { style: { fontWeight: 800, fontSize: rowH * 0.62 + "px", letterSpacing: "-0.045em", minWidth: rowH * 2.3 + "px", lineHeight: 1 } }, v), h("span", { class: "h3", style: { fontSize: rowH * 0.3 + "px", whiteSpace: "nowrap" } }, l)));
        c.tl.stagger(rows, 900, 130, (el, st) => c.tl.in(el, st, { x: 60, y: 0 }));
        const used = rowH * 3;
        if (hgt - used > 140 * c.u) {
          const bh = Math.min(170 * c.u, (hgt - used) * 0.6), by = y + hgt - bh;
          const g = s("g"), step = 46 * c.u;
          for (let i = 0; i < (w + c.P * 2) / step + 2; i++) { const rc = s("rect", { x: x - c.P + i * step, y: by, width: step / 2, height: bh, fill: "var(--ink)" }); g.append(rc); c.tl.grow(rc, 1100 + i * 25, { dur: 500 }); }
          const clip = s("clipPath", { id: "mclip" + c.W }, s("rect", { x: 0, y: by, width: c.W, height: bh }));
          c.art.append(clip, s("g", { "clip-path": `url(#mclip${c.W})` }, g));
          c.tl.idle((t) => g.setAttribute("transform", `translate(${-((t / 30) % step)},0)`));
        }
        return h("div", { style: { width: w + "px" } }, rows);
      }, artAlign: "start" };
  } });

// 14. failures ------------------------------------------------------------
add({ id: "failures", title: "Failures", bg: "var(--mint)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const F = D.failures;
    const k = kick("where things broke");
    const big = countHero(c, "huge", F.total, int, null, 200);
    big.dataset.fit = Math.round(270 * c.k * c.u);
    const p = h("div", { class: "p gap1" }, "failed tool calls. Only ", h("b", {}, `${one(F.rate * 100)}%`), ` of ${int(F.calls)}.`);
    const esc = h("div", { class: "slab", style: { color: "var(--mint)" } }, kick("the Esc key", { color: "var(--paper)" }), h("div", { class: "h2", style: { marginTop: 12 * c.k + "px", fontSize: 66 * c.k * c.u + "px" } }, `You interrupted or steered ${int(D.interrupted)} times.`));
    c.tl.in(k, 100).in(big, 200).in(p, 650).in(esc, 1800, { y: 80, rot: 2 });
    const named = F.categories.filter((x) => x.key !== "other");
    const cats = named.slice(0, 4);
    const rest = named.slice(4).reduce((n, x) => n + x.count, 0) + F.categories.filter((x) => x.key === "other").reduce((n, x) => n + x.count, 0);
    if (rest) cats.push({ key: "other", label: "Everything else", count: rest });
    const tot = cats.reduce((n, b) => n + b.count, 0);
    const colors = ["var(--ink)", "var(--purple)", "var(--orange)", "var(--yellow)", "var(--paper)"];
    const alloc = cats.map((cc) => Math.floor((cc.count / tot) * 100));
    const rem = 100 - alloc.reduce((n, b) => n + b, 0);
    cats.map((cc, i) => [((cc.count / tot) * 100) % 1, i]).sort((x, y) => y[0] - x[0]).slice(0, rem).forEach(([, i]) => alloc[i]++);
    const sideLegend = c.mode !== "side" && c.square;
    return { head: head(k, big, p), extra: c.tall ? esc : null, artMin: 0.3, split: 0.44, legend: "one square = 1% of failures",
      art(w, hgt) {
        const row = w / hgt > 1.15;
        const lg = h("div", { style: { display: "flex", flexDirection: "column", gap: 12 * c.k + "px", flex: "none" } }, cats.map((cc, i) => h("div", { style: { display: "flex", alignItems: "center", gap: 18 * c.k + "px" } },
          h("i", { style: { width: 38 * c.k + "px", height: 38 * c.k + "px", borderRadius: 8 * c.k + "px", background: colors[i], border: `${4 * c.k}px solid var(--ink)`, flex: "none" } }),
          h("span", { class: "h3", style: { fontSize: 42 * c.k * c.u + "px", flex: 1, whiteSpace: "nowrap" } }, cc.label),
          h("span", { class: "mono", style: { fontSize: 34 * c.k * c.u + "px", fontWeight: 600 } }, pct(cc.count / tot)))));
        c.tl.stagger([...lg.children], 1300, 90, (el, st) => c.tl.in(el, st, { x: -50, y: 0 }));
        const wf = row ? waffle(c, alloc, colors, w * 0.42, hgt) : waffle(c, alloc, colors, w, hgt * 0.5);
        return h("div", { style: { display: "flex", flexDirection: row ? "row" : "column", gap: 44 * c.k + "px", alignItems: row ? "center" : "stretch", width: row ? "max-content" : w + "px" } }, wf, lg);
      } };
  } });

// 15. nemesis -------------------------------------------------------------
add({ id: "nemesis", title: "Nemesis", bg: "var(--coral)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const nm = D.failures.nemesis[0];
    const k = kick("your agent's nemesis");
    const big = h("div", { class: "big mono", "data-fit": Math.round(230 * c.k * c.u), "data-min": Math.round(80 * c.u), style: { fontWeight: 700, whiteSpace: "nowrap", marginTop: 20 * c.k + "px" } }, nm.key);
    const p = h("div", { class: "p gap1" }, "failed ", h("b", {}, `${int(nm.count)} times`), ` in ${int(nm.runs)} runs. The agents kept calling it anyway.`);
    c.tl.in(k, 100).in(big, 220, { y: 0, sc: 1.6, dur: 900 }).in(p, 700);
    c.tl.at(1000, 500, "lin", (pp) => { big.style.translate = `${Math.sin(pp * Math.PI * 8) * (1 - pp) * 18}px 0`; });
    return { head: head(k, big, p), artMin: 0.28, split: 0.52, legend: "failed shell runs",
      art(w, hgt) {
        const hd = kick("runners-up");
        c.tl.in(hd, 850);
        const lst = rankList(c, D.failures.nemesis.slice(1, 4), w, hgt - 70 * c.k, { mono: true, startN: 2, noTop: true, fmt: (r) => `${int(r.count)} fails`, start: 950 });
        return h("div", { style: { width: w + "px" } }, hd, h("div", { style: { marginTop: 26 * c.k + "px" } }, lst));
      }, artAlign: "start" };
  } });

// 16. model ---------------------------------------------------------------
add({ id: "model", title: "Model", bg: "var(--yellow)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const M = D.models;
    const k = kick("top model");
    const big = h("div", { class: "big", "data-fit": Math.round(160 * c.k * c.u), "data-min": Math.round(70 * c.u), style: { whiteSpace: "nowrap", lineHeight: 0.95, marginTop: 20 * c.k + "px" } }, M[0].key);
    const p = h("div", { class: "p gap1" }, "answered ", h("b", {}, pct(M[0].share)), ` of ${int(D.usage.requests)} model requests.`);
    c.tl.in(k, 100).in(big, 200, { y: 100 }).in(p, 600);
    const cols = ["var(--ink)", "var(--orange)", "var(--purple)", "var(--paper)"];
    return { head: head(k, big, p), artMin: 0.36, split: 0.48, legend: "share of requests",
      art(w, hgt) {
        const row = w / hgt > 1.1;
        const lg = h("div", { style: { display: "flex", flexDirection: "column", gap: 14 * c.k + "px", flex: "none" } }, M.slice(1).map((m, i) => h("div", { style: { display: "flex", alignItems: "center", gap: 20 * c.k + "px" } },
          h("i", { style: { width: 42 * c.k + "px", height: 42 * c.k + "px", borderRadius: "50%", background: cols[i + 1], border: `${4 * c.k}px solid var(--ink)`, flex: "none" } }),
          h("span", { class: "h3", style: { flex: 1, whiteSpace: "nowrap", fontSize: 50 * c.k * c.u + "px" } }, m.key),
          h("span", { class: "mono", style: { fontSize: 36 * c.k * c.u + "px", fontWeight: 600 } }, m.share < 0.01 ? "<1%" : pct(m.share)))));
        c.tl.stagger([...lg.children], 1300, 100, (el, st) => c.tl.in(el, st, { x: -50, y: 0 }));
        const lgH = row ? 0 : M.length * 70 * c.k + 30;
        const D2 = Math.min(row ? w * 0.5 : w, hgt - lgH), Rr = D2 / 2 * 0.78, sw = Rr * 0.46;
        const svg = svgBox(D2, D2), cx = D2 / 2, cy = D2 / 2;
        let acc = 0; const arcs = [];
        M.forEach((m, i) => { const ci = s("circle", { cx, cy, r: Rr, fill: "none", "stroke-width": sw, stroke: cols[i], "stroke-dasharray": `0 ${Math.PI * 2 * Rr}`, transform: `rotate(${-90 + acc * 360} ${cx} ${cy})` }); ci._share = m.share; acc += m.share; svg.append(ci); arcs.push(ci); });
        svg.append(s("circle", { cx, cy, r: Rr + sw / 2, fill: "none", stroke: "var(--ink)", "stroke-width": Math.max(3, Rr * 0.024) }), s("circle", { cx, cy, r: Rr - sw / 2, fill: "none", stroke: "var(--ink)", "stroke-width": Math.max(3, Rr * 0.024) }));
        c.tl.at(500, 1400, "inOut", (pp) => arcs.forEach((a) => a.setAttribute("stroke-dasharray", `${Math.max(0.01, a._share * pp * Math.PI * 2 * Rr - 4)} ${Math.PI * 2 * Rr}`)));
        return h("div", { style: { display: "flex", flexDirection: row ? "row" : "column", alignItems: "center", gap: 40 * c.k + "px", width: row ? "max-content" : w + "px" } }, svg, lg);
      } };
  } });

// 17. tokens --------------------------------------------------------------
add({ id: "tokens", title: "Tokens", bg: "var(--lilac)", fg: "var(--ink)", dur: 6500, squareSide: false,
  build(c) {
    const U = D.usage;
    const k = kick("tokens processed");
    const big = countHero(c, "huge", U.tokens, compact, null, 200);
    const p = h("div", { class: "p gap1" }, U.cacheHitRate != null ? [h("b", {}, pct(U.cacheHitRate)), " of input came straight from cache."] : `in ${int(U.requests)} model requests.`);
    // No cost claim unless the recap has a priced total; tools without token counts are named instead of guessed.
    const names = U.pricedHarnesses.map(harnessName);
    const money = U.priced ? h("div", { class: "boxed" }, kick(names.length && names.length < T.harnesses.length ? `at list prices · ${names.join(" + ")}` : "at list prices"),
      h("div", { style: { display: "flex", alignItems: "baseline", gap: 24 * c.k + "px", flexWrap: "wrap", marginTop: 10 * c.k + "px" } }, h("span", { class: "big", style: { fontSize: 140 * c.k * c.u + "px" } }, `$${int(U.usd)}`), U.usdPerCommit ? h("span", { class: "h3" }, `$${one(U.usdPerCommit)} a commit`) : null)) : null;
    c.tl.in(k, 100).in(big, 200).in(p, 650);
    if (money) c.tl.in(money, 1800, { y: 100, rot: 2 });
    // One spine per novel (about 90,000 words) of output, up to 150 spines; past that one spine stands for several.
    const nNovels = Math.round(U.novels), perSpine = nNovels > 150 ? Math.ceil(nNovels / 150) : 1, nBooks = Math.max(1, Math.ceil(nNovels / perSpine));
    return { head: head(k, big, p), extra: money, artMin: 0.2, split: 0.5, legend: U.priced && U.unpriced ? `${int(U.unpriced)} requests unpriced` : "",
      art(w, hgt) {
        const capH = 70 * c.k * c.u + 30;
        const sh = hgt - capH;
        let best = null;
        for (let rows = 1; rows <= 8; rows++) {
          const rowH = Math.min(130 * c.u, sh / rows - 16 * c.u), per = Math.ceil(nBooks / rows), bw = w / per;
          if (rowH < 30) break;
          const score = Math.abs(Math.log((rowH / bw) / 3.6));
          if (!best || score < best.score) best = { rows, rowH, per, bw, score };
        }
        const svg = svgBox(w, best.rows * (best.rowH + 16 * c.u));
        const r = rng(nBooks), spines = [];
        for (let i = 0; i < nBooks; i++) {
          const row = Math.floor(i / best.per), col = i % best.per, hg = best.rowH * (0.64 + r() * 0.36), y0 = row * (best.rowH + 16 * c.u);
          const rc = s("rect", { x: col * best.bw, y: y0 + best.rowH - hg, width: Math.max(2, best.bw - 3), height: hg, rx: 2, fill: PALETTE[Math.floor(r() * 5)], stroke: "var(--ink)", "stroke-width": Math.max(1.5, best.bw * 0.1) });
          svg.append(rc); spines.push(rc);
        }
        for (let row = 0; row < best.rows; row++) svg.append(s("rect", { x: -6, y: row * (best.rowH + 16 * c.u) + best.rowH, width: w + 12, height: 7 * c.u, fill: "var(--ink)" }));
        c.tl.stagger(spines, 600, Math.max(2, 900 / nBooks), (rc, st) => c.tl.grow(rc, st, { dur: 400 }));
        const cap = h("div", { class: "h3", style: { marginTop: 20 * c.k + "px", fontSize: 52 * c.k * c.u + "px" } }, "The agents wrote about ", h("span", { class: "chip", style: { background: "var(--ink)", color: "var(--lilac)" } }, nNovels >= 1 ? `${int(nNovels)} novel${nNovels === 1 ? "" : "s"}` : "a short story"), perSpine > 1 ? ` of output. One spine = ${perSpine}.` : " of output.");
        c.tl.in(cap, 1500);
        return h("div", { style: { width: w + "px" } }, svg, cap);
      }, artAlign: "start" };
  } });

// 18. persona -------------------------------------------------------------
add({ id: "persona", title: "Persona", bg: "var(--purple)", fg: "var(--paper)", dur: 7500, dark: true, squareSide: false,
  build(c) {
    const P = D.persona;
    const k = kick("you are");
    const t1 = h("div", { class: "big", "data-fit": Math.round(170 * c.k * c.u), "data-min": Math.round(70 * c.u), style: { whiteSpace: "nowrap", marginTop: 20 * c.k + "px" } }, `The ${P.time}`);
    const t2 = h("div", { class: "big", "data-fit": Math.round(170 * c.k * c.u), "data-min": Math.round(70 * c.u), style: { whiteSpace: "nowrap", color: "var(--lime)" } }, P.role + ".");
    const p = h("div", { class: "p gap1", style: { fontSize: 40 * c.k * c.u + "px" } }, P.reason.charAt(0).toUpperCase() + P.reason.slice(1));
    c.tl.in(k, 1100).in(t1, 1250, { y: 100 }).in(t2, 1400, { y: 100 }).in(p, 1800);
    return { head: head(k, t1, t2, p), artFirst: true, artMin: 0.3, split: 0.5,
      art(w, hgt) {
        const svg = svgBox(w, hgt), Rr = Math.min(w, hgt) / 2 * 0.92, cx = w / 2, cy = hgt / 2;
        const sg = sigil(c, cx, cy, Rr, { stroke: "var(--paper)", dayOn: "var(--lime)", sw: Math.max(4, Rr * 0.025) });
        svg.append(sg.g);
        c.tl.pop(sg.blob, 200, { dur: 1300 });
        c.tl.idle((t) => sg.blob.setAttribute("d", blobPath(R.hours, cx, cy, Rr * 0.34, Rr * 0.46, 1, Rr * 0.015 * clamp((t - 1500) / 600), t)));
        c.tl.stagger(sg.dots, 500, 25, (r, st) => c.tl.pop(r, st, { dur: 500 }));
        return svg;
      } };
  } });

// 19. tips ----------------------------------------------------------------
add({ id: "tips", title: "Try next", bg: "var(--paper)", fg: "var(--ink)", dur: 8000, squareSide: false,
  insets: (c) => ({ top: 0, bottom: Math.round(c.P * 0.5) }),
  build(c) {
    // One line of why per finding kind, from the number alone: never the finding's own text.
    const TIP_WHY = {
      context_resets: (m) => `${int(m.value)} context compactions in ${D.range.days} days.`,
      slow_correction: (m) => `You usually step in after ${one(m.value)} minutes.`,
      repeated_failed_command: (m) => `One command failed ${int(m.value)} times running.`,
      long_sessions: (m) => `${int(m.value)} sessions ran very long.`,
      frequent_interruptions: (m) => (/%|percent|share/i.test(m.unit + m.label) ? `${one(m.value)}% of your prompts interrupted the agent.` : `${int(m.value)} interruptions.`),
      repeated_instruction: (m) => `The same instruction in ${int(m.value)} sessions.`,
      unused_feature: (m) => `${int(m.value)} sessions looked like a good fit.`,
      permission_prompt_load: (m) => `${int(m.value)} tool calls blocked or refused.`,
      tool_error_hotspot: (m) => `One tool fails ${one(m.value)}% of the time.`,
      cache_miss_cost: (m) => `About $${int(m.value)} went on cache misses.`,
      expensive_model_for_simple_work: (m) => `${int(m.value)} quick sessions on a top-tier model.`,
      no_tests_before_done: (m) => `${int(m.value)} sessions ended without a test run.`,
      single_harness_only: () => "Every session ran in one tool.",
      short_history: (m) => `Only ${int(m.value)} days of history kept.`,
      history_disk_usage: (m) => `${int(m.value)} ${m.unit || "MB"} of history on disk.`,
    };
    const sz = c.P * 0.5, ch = checker(0, c.H - sz, Math.ceil(c.W / sz), 1, sz);
    c.art.append(ch.g); c.tl.stagger(ch.cells, 1200, 15, (r, st) => c.tl.pop(r, st, { dur: 400 }));
    const k = kick(`${D.tips.length} things to try next`, { color: "var(--red)" });
    const tt = h("div", { class: "h1", style: { marginTop: 20 * c.k + "px" } }, "Your next level.");
    c.tl.in(k, 100).in(tt, 200, { y: 80 });
    return { head: head(k, tt), artMin: 0.45, split: 0.38, legend: "from your findings", center: false,
      art(w, hgt) {
        const rowH = Math.min(300 * c.u, hgt / D.tips.length);
        const items = D.tips.map((tip, i) => h("div", { style: { display: "grid", gridTemplateColumns: `${rowH * 0.45}px 1fr`, gap: 22 * c.k + "px", alignItems: "start", borderTop: `${5 * c.k}px solid var(--ink)`, height: rowH + "px", paddingTop: rowH * 0.12 + "px" } },
          h("span", { class: "huge", style: { fontSize: rowH * 0.5 + "px", color: ["var(--orange)", "var(--purple)", "var(--red)"][i] } }, i + 1),
          h("div", {}, h("div", { class: "h2", style: { fontSize: Math.min(68 * c.u, rowH * 0.27) + "px" } }, tip.title), h("div", { class: "p", style: { marginTop: rowH * 0.05 + "px", opacity: 0.75, fontSize: Math.min(40 * c.u, rowH * 0.15) + "px" } }, TIP_WHY[tip.kind] && (tip.metric || tip.kind === "single_harness_only") ? TIP_WHY[tip.kind](tip.metric || {}) : ""))));
        c.tl.stagger(items, 600, 260, (el, st) => c.tl.in(el, st, { x: 0, y: 80, rot: -1.5 }));
        return h("div", { style: { width: w + "px" } }, items);
      }, artAlign: "start" };
  } });

// 20. summary -------------------------------------------------------------
add({ id: "summary", title: "Summary", bg: "var(--orange)", fg: "var(--ink)", dur: 9000, bigMark: true, summary: true, squareSide: false,
  build(c) {
    const sigR = (c.wide ? 150 : c.tall ? 160 : 130) * c.u * c.k;
    const k = kick(`${rangeLabel}, ${D.range.to.slice(0, 4)}`);
    // Three-digit day counts get a smaller title so "My last 287" still fits beside the sigil.
    const tsz = (c.wide ? 124 : c.tall ? 112 : 104) * (D.range.days >= 100 ? 0.86 : 1);
    const tt = h("div", { class: "h1", style: { fontSize: tsz * c.k * c.u + "px", marginTop: 18 * c.k + "px" } }, `My last ${D.range.days}`, h("br"), "days with AI");
    const make = cta(c, "var(--ink)", c.wide ? 34 : 28);
    const hd = head(k, tt);
    if (!c.wide) hd.style.paddingRight = sigR * 2.2 + "px";
    c.tl.in(k, 100).in(tt, 200, { y: 80 });
    const tile = (title, body) => h("div", { style: { minWidth: 0 } }, kick(title, { fontSize: 28 * c.k * c.u + "px" }), body);
    const colList = (rows, mono, n) => h("ol", { style: { listStyle: "none", padding: 0, margin: 18 * c.k + "px 0 0" } }, rows.slice(0, n).map((r, i) => h("li", { style: { display: "flex", gap: 16 * c.k + "px", alignItems: "baseline", padding: 10 * c.k + "px 0", borderTop: `${4 * c.k}px solid var(--ink)` } },
      h("span", { class: "mono", style: { fontSize: 30 * c.k * c.u + "px", fontWeight: 700, width: 30 * c.k + "px", flex: "none" } }, i + 1),
      h("span", { class: mono ? "mono" : "", "data-fit": Math.round((mono ? 44 : 52) * c.k * c.u), "data-min": Math.round(24 * c.u), style: { fontWeight: mono ? 600 : 750, whiteSpace: "nowrap", lineHeight: 1.15, minWidth: 0, flex: 1 } }, r))));
    c.tl.in(make, 1500, { y: 30 });
    return { head: hd, extra: make, artMin: 0.5, split: 0.36, artGrow: 1.7, center: false, artAlign: c.wide ? "center" : "start",
      art(w, hgt) {
        const n = (c.tall && hgt > 1000 * c.u) || c.wide ? 5 : 3;
        const words = tile("top words", colList(V.words.map((x) => x.key), false, n));
        const bash = tile("bash hall of fame", colList(D.shell.programs.map((x) => x.key), true, n));
        const hsz = (c.tall ? 230 : c.wide ? 210 : 170) * c.k * c.u;
        const hours = tile("hours with agents", h("div", { class: "huge", "data-fit": Math.round(hsz), "data-min": Math.round(60 * c.u), style: { fontSize: hsz + "px", marginTop: 16 * c.k + "px" } }, int(T.wallHours)));
        const model = tile("top model", h("div", { class: "h2", "data-fit": Math.round(78 * c.k * c.u), "data-min": Math.round(20 * c.u), style: { marginTop: 18 * c.k + "px", whiteSpace: "nowrap" } }, D.models[0].key));
        const per = h("div", { class: "slab", style: { color: "var(--orange)" } }, kick("persona", { color: "var(--paper)", fontSize: 28 * c.k * c.u + "px" }), h("div", { class: "h1", "data-fit": Math.round(96 * c.k * c.u), "data-min": Math.round(40 * c.u), style: { marginTop: 12 * c.k + "px", whiteSpace: "nowrap" } }, D.persona.title));
        const G = 48 * c.k;
        const grid = h("div", { style: { display: "grid", gridTemplateColumns: c.wide ? "1fr 1fr 1fr" : "1fr 1fr", columnGap: G + "px", rowGap: G * 0.9 + "px", width: w + "px", alignItems: "end" } });
        const mid = !c.wide && c.r >= 0.7; // square and 4:5: three columns, so the grid fills the width
        if (c.wide) { grid.append(words, bash, hours); per.style.gridColumn = "1 / span 2"; grid.append(per, model); }
        else if (mid) { grid.style.gridTemplateColumns = "minmax(0,1fr) minmax(0,1fr) minmax(0,0.8fr)"; hours.lastChild.style.fontSize = 160 * c.k * c.u + "px"; hours.lastChild.dataset.fit = Math.round(160 * c.k * c.u); grid.style.alignItems = "start"; model.style.marginTop = G * 0.8 + "px"; grid.append(words, bash, h("div", {}, hours, model)); per.style.gridColumn = "1 / span 3"; grid.append(per); }
        else { grid.append(words, bash, hours, model); per.style.gridColumn = "1 / span 2"; grid.append(per); }
        [...grid.children].forEach((el, i) => c.tl.in(el, 600 + i * 150, { y: 60, rot: el === per ? -2 : 0 }));
        if (mid) per.querySelector(".h1").dataset.fit = Math.round(120 * c.k * c.u);
        return grid;
      },
      // 16:9 gives the left column to the title and the make-your-own line; the sigil would crowd them.
      post: c.wide ? null : (rect) => {
        const b = rect(hd);
        const cx = c.wide ? b.x + sigR * 1.1 : c.W - c.P - sigR * 1.05, cy = c.wide ? b.y + b.h + sigR * 1.35 : b.y + sigR * 1.05;
        const sg = sigil(c, cx, cy, sigR, { fill: "var(--yellow)", dayOn: "var(--ink)", sw: Math.max(3, sigR * 0.04) });
        c.art.append(sg.g); c.tl.pop(sg.g, 300, { dur: 1100 });
      } };
  } });

// 21. outro: the maker's card (brand colours in every theme) -------------
add({ id: "outro", title: "Made with", bg: "var(--brand-deep)", fg: "var(--brand-lime)", dur: 3500, noFoot: true, dark: true, outro: true, squareSide: false,
  build(c) {
    const lines = [
      h("div", { class: "kick", style: { color: "#FCFCF5" } }, "made with"),
      h("div", { class: "big", "data-fit": Math.round(170 * c.k * c.u), "data-min": Math.round(60 * c.u), style: { marginTop: 16 * c.k + "px", whiteSpace: "nowrap" } }, "AI Insights"),
      h("div", { class: "h3", style: { color: "#FCFCF5", marginTop: 20 * c.k + "px" } }, "by Matrix OS"),
      h("div", { class: "kick", style: { color: "#FCFCF5", marginTop: 40 * c.k + "px", fontSize: 28 * c.k * c.u + "px" } }, "make your own"),
      h("div", { class: "pills", style: { marginTop: 16 * c.k + "px" } }, h("span", { class: "pill", style: { fontSize: 36 * c.k * c.u + "px" } }, SH.command), h("span", { class: "pill", style: { fontSize: 36 * c.k * c.u + "px" } }, SH.skill)),
      h("div", { class: "mono", style: { color: "#FCFCF5", marginTop: 22 * c.k + "px", fontSize: 32 * c.k * c.u + "px", fontWeight: 600, whiteSpace: "nowrap" }, "data-fit": Math.round(32 * c.k * c.u), "data-min": Math.round(16 * c.u) }, `${SH.site}  ${SH.hashtag}`),
    ];
    enter(c, lines, 500, 140);
    return { head: head(...lines), artFirst: true, artMin: 0.32, split: 0.42,
      art(w, hgt) {
        const hg = Math.min(hgt, w * 1.294) * 0.92;
        const svg = rabbitSvg("var(--brand-lime)", hg + "px");
        svg.style.width = (hg * 510) / 660 + "px";
        const paths = [...svg.children];
        c.tl.stagger(paths, 0, 45, (p, st) => c.tl.pop(p, st, { dur: 700 }));
        paths.forEach((p) => { p.style.transformBox = "fill-box"; p.style.transformOrigin = "50% 50%"; });
        return h("div", { style: { width: w + "px", height: hgt + "px", display: "flex", alignItems: "center", justifyContent: c.mode === "side" ? "center" : "center" } }, svg);
      } };
  } });

// optional: how much history the tools keep ----------------------------
if (D.history) add({ id: "history", title: "History kept", bg: "var(--sky)", fg: "var(--ink)", dur: 6000, squareSide: false,
  build(c) {
    const Hh = D.history;
    const k = kick("history on this machine");
    const big = countHero(c, "huge", Hh.days, int, Hh.days === 1 ? " day" : " days", 200);
    const p = h("div", { class: "p gap1" }, Hh.firstDay ? ["of transcripts kept, back to ", h("b", {}, dshort(Hh.firstDay)), ". "] : "of transcripts kept. ", "Older ones are deleted by default; keep them and next year's look back covers the whole year.");
    c.tl.in(k, 100).in(p, 700);
    return { head: head(k, big, p), artMin: 0.3, split: 0.5, legend: "one square = one day kept",
      art(w, hgt) {
        const n = Math.min(Hh.days, 400), g = cellGrid(n, w, hgt, 0.2), svg = svgBox(w, hgt);
        const cells = Array.from({ length: n }, (_, i) => { const r = s("rect", { x: (i % g.cols) * (g.size + g.gap), y: Math.floor(i / g.cols) * (g.size + g.gap), width: g.size, height: g.size, rx: g.size * 0.12, fill: "var(--ink)" }); svg.append(r); return r; });
        c.tl.stagger(cells, 300, Math.min(25, 1300 / n), (r, st) => c.tl.pop(r, st, { dur: 500 }));
        return svg;
      } };
  } });

return SPECS;
} });
