/**
 * Hindsight's look: a near-black canvas (or warm paper in light mode), one ember
 * accent, and the pixel as the motif. Every colour is a token; the light theme is
 * its own palette, not an inversion. Text tokens hold at least 4.5:1 on their
 * surfaces. Motion is CSS only, off for reduced motion and print.
 */

const DARK = `
  --bg:#0b0b0c;--panel:#131315;--panel-2:#18181b;--line:#242428;--line-strong:#36363c;
  --text:#f3efe8;--text-2:#cbc6bd;--muted:#948f86;
  --accent:#ff7a2f;--accent-ink:#1a0b02;--accent-soft:rgba(255,122,47,.12);
  --p0:#1e1e22;--p1:#3e2416;--p2:#7b3b18;--p3:#c8581c;--p4:#ff7a2f;--p5:#ffc49c;
  --s0:#ff7a2f;--s1:#e9e3d8;--s2:#8a857c;--s3:#4a4843;
  --w0:#ff7a2f;--w1:#ffb27d;--w2:#e9e3d8;--w3:#8a857c;--w4:#3b3a37;
  --f0:#6c675f;--f1:#ffb27d;--f2:#c8581c;--f3:#ff7a2f;
  --c1:#3b3a37;--c2:#a5501f;--c3:#ff7a2f;
  --q0:#ff7a2f;--q1:#c8581c;--q2:#7b3b18;--q3:#4a2b1b;--q4:#2e2e33;--q5:#1e1e22;
  --dot:rgba(255,255,255,.06);
`;

const LIGHT = `
  --bg:#f3f0e8;--panel:#faf8f3;--panel-2:#f0ece2;--line:#e0dacd;--line-strong:#cbc3b2;
  --text:#17140f;--text-2:#3c372e;--muted:#69635a;
  --accent:#c2410c;--accent-ink:#ffffff;--accent-soft:rgba(194,65,12,.08);
  --p0:#e5e0d4;--p1:#f6d2b6;--p2:#f0a26c;--p3:#df6a2c;--p4:#c2410c;--p5:#7a2905;
  --s0:#c2410c;--s1:#3c372e;--s2:#9b9385;--s3:#cfc7b7;
  --w0:#c2410c;--w1:#f0a26c;--w2:#3c372e;--w3:#a39b8c;--w4:#dcd5c6;
  --f0:#bcb3a2;--f1:#f0a26c;--f2:#df6a2c;--f3:#c2410c;
  --c1:#d8d0c0;--c2:#f0a26c;--c3:#c2410c;
  --q0:#c2410c;--q1:#df6a2c;--q2:#f0a26c;--q3:#f6d2b6;--q4:#e0dacd;--q5:#ece7dc;
  --dot:rgba(23,20,15,.07);
`;

export const STYLES = `
:root{color-scheme:dark light;${DARK}
  --font:"Inter","Inter Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --radius:14px;
}
@media (prefers-color-scheme:light){:root{${LIGHT}}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:400 16px/1.6 var(--font);font-feature-settings:"tnum" 1,"ss01" 1;-webkit-font-smoothing:antialiased}
main{max-width:1180px;margin:0 auto;padding:0 40px 40px}
h1,h2,h3{margin:0;font-weight:600;letter-spacing:-.02em;line-height:1.15}
h3{font-size:1.125rem}
p{margin:0}
a{color:var(--accent);text-underline-offset:3px}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
code,pre{font-family:var(--mono);font-size:.88em}
code{background:var(--panel-2);border:1px solid var(--line);padding:.05em .35em;border-radius:5px;overflow-wrap:anywhere}
.micro{font:500 12px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.muted{color:var(--muted)}
em{font-style:normal;color:var(--accent)}

/* ---------- brand ---------- */
.brand{display:inline-flex;align-items:center;gap:10px;font:600 18px/1 var(--font);letter-spacing:-.02em;color:var(--text)}
.mark{width:22px;height:22px;flex:none}
.mark .p1{fill:var(--p2)}.mark .p2{fill:var(--p3)}.mark .p3{fill:var(--p3)}.mark .p4{fill:var(--p4)}.mark .p5{fill:var(--p5)}

/* ---------- pixels ---------- */
.p0{fill:var(--p0)}.p1{fill:var(--p1)}.p2{fill:var(--p2)}.p3{fill:var(--p3)}.p4{fill:var(--p4)}.p5{fill:var(--p5)}
svg .lbl{fill:var(--muted);font:500 11px var(--mono);letter-spacing:.04em}

/* ---------- hook ---------- */
.hook{position:relative;min-height:min(100vh,900px);display:flex;flex-direction:column;padding-bottom:32px}
.hook::before{content:"";position:absolute;inset:0 -40px;z-index:-1;background-image:radial-gradient(var(--dot) 1px,transparent 1.4px);background-size:22px 22px;-webkit-mask-image:linear-gradient(180deg,#000 30%,transparent 95%);mask-image:linear-gradient(180deg,#000 30%,transparent 95%)}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:28px 0}
.hook-grid{flex:1;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:64px;align-items:center;padding:4vh 0 40px}
.hook-grid.no-art{grid-template-columns:minmax(0,1fr)}
.hook.empty{min-height:0}
.eyebrow{display:flex;align-items:center;gap:10px;margin-bottom:22px}
.eyebrow::before{content:"";width:8px;height:8px;background:var(--accent)}
.headline{font-size:clamp(2.3rem,1.2rem + 2.9vw,3.6rem);line-height:1.04;letter-spacing:-.04em;font-weight:600;max-width:17ch;text-wrap:balance}
.headline em{white-space:nowrap}
.subline{font-size:clamp(1.05rem,.95rem + .35vw,1.25rem);color:var(--text-2);margin-top:20px;max-width:46ch}
.subline b{color:var(--text);font-weight:600}
.agent-quote{margin:24px 0 0;font-size:15px;padding-left:16px;border-left:2px solid var(--accent);color:var(--text-2);max-width:56ch}
.agent-quote .micro{display:block;margin-bottom:4px}
.numbers{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.8fr) minmax(0,.95fr) minmax(0,1.35fr);margin-top:32px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.number{padding:18px 18px 18px 0;display:flex;flex-direction:column;gap:2px;min-width:0}
.number+.number{padding-left:18px;border-left:1px solid var(--line)}
.n-value{font-size:clamp(1.5rem,1.1rem + 1vw,2.1rem);font-weight:600;letter-spacing:-.03em;line-height:1.1;white-space:nowrap}
.n-label{font-size:13px;color:var(--text-2);line-height:1.35}
.n-note{font-size:12px;color:var(--muted);line-height:1.35;margin-top:2px}
.sources{margin-top:22px;text-transform:none;letter-spacing:.02em}
.sources b{color:var(--text-2);font-weight:500}
.hook-art{display:flex;justify-content:center}
.hero-art{margin:0;max-width:440px}
.px-hero{display:block;max-width:100%;height:auto}
.hero-art figcaption{margin-top:14px}
.chapter-nav{display:flex;flex-wrap:wrap;gap:6px 22px;padding:16px 0;border-top:1px solid var(--line)}
.chapter-nav a{color:var(--muted);text-decoration:none;display:inline-flex;gap:8px}
.chapter-nav a span{color:var(--accent)}
.chapter-nav a:hover{color:var(--text)}

/* ---------- chapters ---------- */
.chapter{padding-top:128px}
.chapter.compact{padding-top:96px}
.ch-head{max-width:920px}
.ch-index{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.ch-index span:first-child{color:var(--accent)}
.ch-index::after{content:"";flex:1;max-width:120px;height:1px;background:var(--line-strong)}
.statement{font-size:clamp(1.65rem,1.05rem + 2.1vw,2.7rem);line-height:1.14;letter-spacing:-.03em;font-weight:550;max-width:28ch;text-wrap:balance}
.statement.second{font-size:clamp(1.15rem,1rem + .7vw,1.5rem);line-height:1.35;letter-spacing:-.015em;color:var(--text-2);font-weight:450;margin-top:18px;max-width:46ch}
.ch-body{margin-top:48px;display:grid;gap:20px}
.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.row.one{grid-template-columns:minmax(0,1fr)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:24px;min-width:0}
.panel-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.panel-aside{text-transform:none;letter-spacing:.02em}
.sub-head{font-size:1.25rem;margin-top:28px}
.quiet{color:var(--text-2)}
.note{font-size:14px;color:var(--muted);margin-top:16px;max-width:76ch}
.note b{color:var(--text-2);font-weight:600}

.tip{margin-top:24px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:18px;align-items:baseline;padding:18px 22px;border:1px dashed var(--line-strong);border-radius:12px;background:var(--accent-soft)}
.tip-label{color:var(--accent)}
.tip-body b{display:block;font-weight:600}
.tip-body span{color:var(--text-2);font-size:15px}
.tip-link{text-decoration:none;color:var(--accent);white-space:nowrap}

/* ---------- visuals ---------- */
.viz{margin:0}
.viz figcaption{margin-top:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.flow-viz .flow-def{grid-column:1/-1;margin:16px 0 0}
.fan-def,.flow-def{flex-basis:100%;text-transform:none;letter-spacing:0;color:var(--text-2)}
.clock svg{display:block;width:100%;max-width:330px;margin:0 auto}
.clock .ring{fill:none;stroke:var(--line);stroke-width:1}
.clock .clock-big{fill:var(--text);font:600 26px var(--font);letter-spacing:-.02em}
.week svg{display:block;width:100%;max-width:300px;height:auto;margin:0 auto}
.fan-viz svg{display:block;width:100%;max-width:420px;height:auto;margin:0 auto}
.fan{fill:none;stroke:var(--line-strong);stroke-width:1.2}
.waffle{display:grid;grid-template-columns:minmax(120px,177px) minmax(0,1fr);gap:24px;align-items:center}
.waffle svg{display:block;width:100%;height:auto}
.w0{fill:var(--w0);background:var(--w0)}.w1{fill:var(--w1);background:var(--w1)}.w2{fill:var(--w2);background:var(--w2)}.w3{fill:var(--w3);background:var(--w3)}.w4{fill:var(--w4);background:var(--w4)}
.legend-list{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:14px}
.legend-list li{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center}
.legend-list b{font-weight:600}
.legend-list.inline{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:14px}
.legend-list.inline li{display:inline-flex}
.sw{display:inline-block;width:10px;height:10px;flex:none}
.dots svg{display:block;width:100%;height:auto}
.day-stacks{overflow-x:auto}
.stack-wrap{position:relative;max-width:100%}
.stack-wrap svg{display:block;max-width:100%;height:auto}
.stack-axis{position:relative;height:22px;font:500 11px var(--mono);color:var(--muted)}
.stack-axis span{position:absolute;top:8px;white-space:nowrap}
.dot-labels{display:grid;margin-top:10px;font:500 11px var(--mono);color:var(--muted);text-align:center}
.parallel-viz{display:flex;flex-wrap:wrap;gap:40px 64px;align-items:flex-end}
.field svg{display:block;max-width:100%;height:auto}
.tower{text-align:center}
.parallel-facts{flex:1;min-width:220px;max-width:340px;align-self:center}
.tower svg{display:block;width:40px;height:auto;margin:0 auto}
.tower figcaption{display:block;max-width:9ch;margin:12px auto 0}
.tower b{color:var(--text);font:600 22px var(--font);display:block;letter-spacing:-.02em}
.timeline-panel+.parallel-facts{margin-top:24px;max-width:420px}
.tl-legend{margin:0 0 18px}
.tl-plot{position:relative;padding:30px 0 0}
.tl-plot svg{display:block;width:100%;overflow:visible}
.tl-plot rect{stroke:none}
.tl-plot rect.hz0,.sw.hz0{fill:var(--s0);background:var(--s0)}
.tl-plot rect.hz1,.sw.hz1{fill:var(--s1);background:var(--s1)}
.tl-plot rect.hz2,.sw.hz2{fill:var(--s2);background:var(--s2)}
.tl-plot rect.hz3,.sw.hz3{fill:var(--s3);background:var(--s3)}
.tl-plot rect.ad{fill-opacity:.22;stroke:currentColor;stroke-width:1.5;stroke-dasharray:3 2}
.tl-plot rect.hz0.ad{color:var(--s0)}.tl-plot rect.hz1.ad{color:var(--s1)}.tl-plot rect.hz2.ad{color:var(--s2)}.tl-plot rect.hz3.ad{color:var(--s3)}
.sw.ad{background:transparent;border:1.5px dashed var(--text-2)}
.tl-grid{stroke:var(--line);stroke-width:1}
.tl-grid.major{stroke:var(--line-strong)}
.tl-peak{stroke:var(--p5);stroke-width:2}
.tl-peak-label{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap;color:var(--text-2)}
.tl-peak-label b{color:var(--p5);font-size:15px}
.tl-peak-label.end{transform:translateX(-100%)}
.tl-peak-label.start{transform:none}
.tl-axis{position:relative;height:26px;border-top:1px solid var(--line-strong);margin-top:8px}
.tl-axis span{position:absolute;top:8px;transform:translateX(-50%);white-space:nowrap}
.tl-axis span.major{color:var(--text-2)}
.tl-axis span.first{transform:none}
.tl-axis span.last{transform:translateX(-100%)}
.tl-idle{flex-basis:100%;color:var(--text-2)}
.tl-list{margin-top:16px}
.also-covers{margin:10px 0 0;color:var(--text-2);font-size:14px;padding-left:12px;border-left:2px solid var(--line-strong)}
.micro.agreed,.action-body .micro.agreed{color:var(--accent);margin:2px 0 0}
.copy-label{margin:14px 0 -4px;color:var(--muted)}
.copy-label code{font-size:12px;text-transform:none;letter-spacing:0}
.tl-list summary{cursor:pointer;color:var(--text-2)}
.tl-list table{margin-top:12px}
.tl-list td.mono{font:13px var(--mono);overflow-wrap:anywhere;white-space:normal}
.px-label.noted{display:flex;flex-direction:column;min-width:0;line-height:1.3}
.px-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.px-note{color:var(--muted);font:11px var(--mono)}
.versus{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:24px;align-items:center;padding:24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.versus b{display:block;font-size:1.9rem;font-weight:600;letter-spacing:-.03em;line-height:1.1}
.versus div:last-child{text-align:right}
.versus div:last-child b{color:var(--accent)}
.vs-bar{position:relative;height:18px;background:repeating-linear-gradient(90deg,var(--p4) 0 9px,transparent 9px 12px)}
.vs-bar .you{position:absolute;inset:0 auto 0 0;background:repeating-linear-gradient(90deg,var(--text) 0 9px,transparent 9px 12px)}
.vs-bar .agents{display:none}

.px-bars{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.px-bars li{display:grid;grid-template-columns:minmax(0,11rem) minmax(0,1fr) auto;gap:14px;align-items:center;font-size:14px}
.px-bars.mono .px-label{font:13px var(--mono)}
.px-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-2)}
.px-track{height:12px;background:repeating-linear-gradient(90deg,var(--p0) 0 9px,transparent 9px 12px)}
.px-run{display:block;height:100%;background:repeating-linear-gradient(90deg,var(--p3) 0 9px,transparent 9px 12px)}
.px-run.lead{background:repeating-linear-gradient(90deg,var(--p4) 0 9px,transparent 9px 12px)}
.px-value{font:500 12px var(--mono);color:var(--muted);text-align:right;min-width:4.5em}
.more{margin-top:12px}
.split-bar{display:flex;height:22px;gap:6px}
.split-bar .px-run{min-width:12px}
.px-run.s0,.sw.s0{background:repeating-linear-gradient(90deg,var(--s0) 0 9px,transparent 9px 12px)}
.px-run.s1,.sw.s1{background:repeating-linear-gradient(90deg,var(--s1) 0 9px,transparent 9px 12px)}
.px-run.s2,.sw.s2{background:repeating-linear-gradient(90deg,var(--s2) 0 9px,transparent 9px 12px)}
.px-run.s3,.sw.s3{background:repeating-linear-gradient(90deg,var(--s3) 0 9px,transparent 9px 12px)}
.sources-list{list-style:none;margin:22px 0 0;padding:0;border-top:1px solid var(--line)}
.sources-list li{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr) minmax(0,1.6fr) minmax(0,1fr) auto;gap:14px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px;color:var(--text-2)}
.sources-list b{color:var(--text);font-weight:600}
.not-found{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}
.chip{display:inline-flex;align-items:center;gap:6px;font:500 12px var(--mono);color:var(--text-2);background:var(--panel-2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;text-transform:none;letter-spacing:0}
.chip b{color:var(--text);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
dl.facts{display:grid;grid-template-columns:1fr auto;gap:8px 16px;margin:0;font-size:14px}
dl.facts dt{color:var(--text-2)}
dl.facts dd{margin:0;text-align:right;font-weight:600}
dl.facts dd span{color:var(--muted);font-weight:400}

.flow-viz{display:grid;grid-template-columns:150px minmax(60px,1fr) minmax(170px,300px);align-items:stretch}
.flow-total{display:flex;align-items:center;gap:14px}
.flow-bar{width:10px;background:var(--accent);flex:none}
.flow-total b{display:block;font-size:2rem;font-weight:600;letter-spacing:-.03em;line-height:1}
.flow-total .micro{display:block;margin-top:4px}
.flow-cost{display:block;margin-top:10px;font-size:13px;color:var(--text-2);line-height:1.35}
.flow-bands{display:block;width:100%;height:calc(var(--rows) * 72px)}
.flow{opacity:.92}
.f0{fill:var(--f0);background:var(--f0)}.f1{fill:var(--f1);background:var(--f1)}.f2{fill:var(--f2);background:var(--f2)}.f3{fill:var(--f3);background:var(--f3)}
.flow-rows{list-style:none;margin:0;padding:0 0 0 14px}
.flow-rows li{display:flex;align-items:center;gap:12px}
.flow-rows b{display:block;font-weight:600;font-size:15px}
.flow-num{display:block;font:500 13px var(--mono);color:var(--text-2)}
.flow-rows .micro{display:block;text-transform:none;letter-spacing:0;font-family:var(--font);font-size:12px}

.islands{display:flex;flex-wrap:wrap;gap:28px 36px;align-items:flex-end}
.island{margin:0;display:flex;flex-direction:column;gap:10px}
.island-px{display:flex;flex-direction:column-reverse}
.island-body,.island-tail{display:block;background:repeating-linear-gradient(90deg,transparent 0 8px,var(--panel) 8px 10px),repeating-linear-gradient(180deg,transparent 0 8px,var(--panel) 8px 10px),var(--p3)}
.island.lead .island-body,.island.lead .island-tail{background:repeating-linear-gradient(90deg,transparent 0 8px,var(--panel) 8px 10px),repeating-linear-gradient(180deg,transparent 0 8px,var(--panel) 8px 10px),var(--p4)}
.island-body{width:calc(var(--c) * 10px);height:calc(var(--r) * 10px)}
.island-tail{width:calc(var(--rem) * 10px);height:10px}
.island figcaption{font-size:13px;color:var(--text-2);max-width:16ch;line-height:1.35;overflow-wrap:anywhere}
.island figcaption b{display:block;color:var(--text);font-size:1.25rem;letter-spacing:-.02em}
.islands-key{flex-basis:100%}

/* ---------- cards, findings, actions ---------- */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:22px;min-width:0}
.card h3{margin:6px 0 8px}
.card p{color:var(--text-2);font-size:15px}
.examples{margin:12px 0 0;padding-left:1.1em;color:var(--muted);font-size:14px}
.style-quote{margin:0;font-size:clamp(1.1rem,1rem + .5vw,1.35rem);line-height:1.5;color:var(--text-2);border-left:2px solid var(--accent);padding:4px 0 4px 22px;max-width:62ch}
.style-quote .micro{display:block;margin-bottom:8px}
.findings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
.finding{background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--line-strong);border-radius:var(--radius);padding:22px;display:grid;gap:12px;min-width:0}
.finding.sev-high{border-top-color:var(--p4)}
.finding.sev-medium{border-top-color:var(--p3)}
.finding.sev-low{border-top-color:var(--p2)}
.finding-top{display:flex;flex-wrap:wrap;gap:6px 14px}
.finding .sev{color:var(--text)}
.finding.sev-high .sev{color:var(--accent)}
.finding p{color:var(--text-2);font-size:15px}
.metric{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.metric b{font-size:2rem;font-weight:600;letter-spacing:-.03em;line-height:1.1}
.metric span{color:var(--muted);font-size:14px}
details summary{cursor:pointer;list-style:none}
details summary::-webkit-details-marker{display:none}
details summary::before{content:"+ ";color:var(--accent)}
details[open] summary::before{content:"− "}
.evidence{list-style:none;margin:10px 0 0;padding:0;border-top:1px solid var(--line)}
.evidence li{display:grid;grid-template-columns:1fr;gap:2px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px}
.evidence .where{font-size:12px;color:var(--muted)}
.evidence .where code{background:none;border:0;padding:0}
.see{text-decoration:none}
.actions{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.action{display:grid;grid-template-columns:110px minmax(0,1fr);gap:28px;padding:36px 0;border-bottom:1px solid var(--line)}
.rank{font:600 5.5rem/0.85 var(--font);letter-spacing:-.06em;color:var(--accent)}
.action-body{max-width:760px;display:grid;gap:12px}
.action-body h3{font-size:clamp(1.3rem,1.1rem + .7vw,1.7rem);letter-spacing:-.025em}
.action-body>p{color:var(--text-2)}
.why{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;color:var(--text);margin:14px 0}
.why .micro{color:var(--accent)}
.why .metric b{font-size:1.15rem}
.more-actions{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
.more-actions li{display:grid;gap:6px;align-content:start;padding:20px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}
.more-actions span:not(.micro){color:var(--text-2);font-size:15px}
.learn{font-size:14px;color:var(--muted);overflow-wrap:anywhere}
.learn a::after{content:" ↗"}
.copy{position:relative;margin-top:4px}
.copy pre{margin:0;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:16px 18px;padding-right:84px;font-size:12.5px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;max-height:22rem;overflow:auto;color:var(--text)}
.copy button{display:none;position:absolute;top:10px;right:10px;font:600 12px/1 var(--mono);color:var(--text);background:var(--panel-2);border:1px solid var(--line-strong);border-radius:7px;padding:7px 11px;cursor:pointer}
.js .copy button{display:block}
.copy button:hover{border-color:var(--accent);color:var(--accent)}
.prompt-panel{display:grid;gap:18px;max-width:820px}
.prompt-panel p{color:var(--text-2)}

/* ---------- closing ---------- */
.closing{padding-top:140px}
.closing-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.closing-grid.single{grid-template-columns:minmax(0,820px);justify-content:center}
.closing-card{position:relative;overflow:hidden;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:36px;display:grid;gap:14px;align-content:start}
.closing-card::after{content:"";position:absolute;top:22px;right:22px;width:6px;height:6px;background:var(--p4);box-shadow:8px 0 var(--p4),16px 0 var(--p3),8px 8px var(--p3),16px 8px var(--p2),16px 16px var(--p1)}
.closing-card h3{font-size:clamp(1.35rem,1.1rem + .8vw,1.85rem);letter-spacing:-.03em;max-width:22ch}
.closing-card p{color:var(--text-2)}
.closing-card.matrix{background:var(--panel);background:radial-gradient(120% 90% at 100% 0%,var(--accent-soft),transparent 60%),var(--panel);border-color:var(--line-strong)}
.cta{justify-self:start;display:inline-flex;align-items:center;gap:8px;margin-top:10px;background:var(--accent);color:var(--accent-ink);text-decoration:none;font-weight:600;padding:12px 18px;border-radius:8px}
.cta:hover{filter:brightness(1.08)}
.cta.ghost{background:transparent;color:var(--text);border:1px solid var(--line-strong);font:500 13px var(--mono)}
.cta.ghost::after{content:" ↗"}
footer{max-width:1180px;margin:96px auto 0;padding:28px 40px 56px;border-top:1px solid var(--line);display:flex;gap:24px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
footer p{max-width:72ch;font-size:13px;color:var(--muted)}
.brand.small{font-size:15px}
.brand.small .mark{width:16px;height:16px}

/* ---------- older chart pieces still used ---------- */
.col-chart{margin:0}
.col-body{display:grid;grid-template-columns:auto 1fr;gap:10px}
.y-title{font:500 11px var(--mono);color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em}
.x-title{display:none}
.y-axis{position:relative;height:170px;min-width:30px;font:500 11px var(--mono);color:var(--muted);text-align:right}
.y-axis span{position:absolute;right:0;transform:translateY(50%);line-height:1}
.plot{min-width:0}
.plot svg{display:block;width:100%;height:170px;overflow:visible}
.x-axis{position:relative;height:22px;font:500 11px var(--mono);color:var(--muted)}
.x-axis span{position:absolute;top:8px;transform:translateX(-50%);white-space:nowrap}
svg .gl{stroke:var(--line);stroke-width:1}
svg .gl.base{stroke:var(--line-strong)}
svg .s1 rect,.key.s1{fill:var(--c1);background:var(--c1)}
svg .s2 rect,.key.s2{fill:var(--c2);background:var(--c2)}
svg .s3 rect,.key.s3{fill:var(--c3);background:var(--c3)}
svg .hits rect{fill:transparent}
svg .hits rect:hover{fill:var(--text);fill-opacity:.06}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--muted);margin-top:12px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.key{display:inline-block;width:10px;height:10px;flex:none}
.chart-empty{display:flex;align-items:center;justify-content:center;min-height:110px;border:1px dashed var(--line-strong);border-radius:10px;color:var(--muted);font-size:14px;padding:16px;text-align:center}
.scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.day-grid{display:block;max-width:none}
.day-grid rect:hover{stroke:var(--text);stroke-width:1}
.composition .comp-bar{display:flex;height:16px;gap:3px}
.comp-bar span{display:block;height:100%;min-width:4px}
.q0{background:var(--q0)}.q1{background:var(--q1)}.q2{background:var(--q2)}.q3{background:var(--q3)}.q4{background:var(--q4)}
.comp-legend{list-style:none;padding:0;margin:16px 0 0;display:grid;gap:6px;font-size:14px}
.comp-legend li{display:flex;align-items:center;gap:8px;color:var(--text-2)}
.comp-legend b{font-weight:600;margin-left:auto;color:var(--text)}
.comp-legend .muted{min-width:3.4em;text-align:right;font:500 12px var(--mono)}
table{width:100%;border-collapse:collapse;font-size:14px}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
th,td{padding:10px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;padding-left:0}
th:last-child,td:last-child{padding-right:0}
th{font:500 11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
td.model{font:13px var(--mono);white-space:normal;overflow-wrap:anywhere;min-width:10rem}
tr.unpriced td:last-child{color:var(--accent)}

/* ---------- motion ---------- */
@keyframes rise{from{transform:translateY(14px)}}
@keyframes lit{from{opacity:.35}}
@keyframes grow{from{transform:scale(.85)}}
@media (prefers-reduced-motion:no-preference){
  .rise{animation:rise .9s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--d,0) * 110ms)}
  .px-hero g{animation:lit .45s ease-out both;animation-delay:calc(450ms + var(--w,0) * 32ms)}
  .clock path{transform-box:view-box;transform-origin:150px 150px;animation:grow .7s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--h,0) * 22ms)}
  @supports (animation-timeline:view()){
    .reveal{animation:rise linear both;animation-timeline:view();animation-range:entry 0% entry 28%}
  }
}

/* ---------- small screens ---------- */
@media (max-width:820px){
  main{padding:0 18px 32px}
  .hook{min-height:0}
  .hook::before{inset:0 -18px}
  .topbar{padding:20px 0}
  .topbar .micro{max-width:12ch;text-align:right}
  .tl-axis span.odd{display:none}
  .hook-grid{grid-template-columns:minmax(0,1fr);gap:36px;padding:3vh 0 28px}
  .numbers{grid-template-columns:repeat(2,minmax(0,1fr))}
  .number:nth-child(3){padding-left:0;border-left:0}
  .number:nth-child(n+3){border-top:1px solid var(--line)}
  .hero-art{max-width:100%}
  .chapter{padding-top:88px}
  .row,.findings,.more-actions,.closing-grid{grid-template-columns:minmax(0,1fr)}
  .panel{padding:18px}
  .tip{grid-template-columns:minmax(0,1fr);gap:8px}
  .waffle{grid-template-columns:minmax(0,1fr)}
  .waffle svg{max-width:200px}
  .parallel-viz{grid-template-columns:minmax(0,1fr) auto;gap:20px}
  .versus{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
  .versus .vs-bar{grid-column:1 / -1;grid-row:2}
  .flow-viz{grid-template-columns:88px minmax(24px,.6fr) minmax(0,1.8fr)}
  .flow-rows{padding-left:10px}
  .flow-rows .micro{display:none}
  .flow-rows b{font-size:14px;white-space:nowrap}
  .week svg{max-width:240px}
  .flow-total b{font-size:1.15rem}
  .flow-cost{font-size:12px}
  .px-bars li{grid-template-columns:minmax(0,7.5rem) minmax(0,1fr) auto;gap:10px}
  .sources-list li{grid-template-columns:minmax(0,1fr) auto;gap:4px 12px}
  .action{grid-template-columns:minmax(0,1fr);gap:8px;padding:28px 0}
  .rank{font-size:3.4rem}
  .closing{padding-top:96px}
  .closing-card{padding:24px}
  footer{padding:24px 18px 40px}
}

/* ---------- print: light, static, everything visible ---------- */
@media print{
  :root{${LIGHT}}
  *,*::before,*::after{animation:none!important}
  body{background:#fff}
  .hook{min-height:0}
  .hook::before,.copy button,.chapter-nav{display:none!important}
  .chapter{padding-top:48px;break-inside:avoid-page}
  .panel,.finding,.card,.closing-card,.action{break-inside:avoid}
}
`;
