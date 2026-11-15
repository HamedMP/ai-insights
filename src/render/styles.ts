/**
 * One accent (indigo) on warm neutrals. Every colour is a token so the dark
 * theme only swaps tokens; chart tints are steps of the same accent.
 * Text tokens are chosen for at least 4.5:1 contrast on their surfaces.
 */
export const STYLES = `
:root{
  color-scheme:light dark;
  --bg:#f7f6f3;--surface:#ffffff;--surface-2:#f0eee9;--text:#1c1b19;--muted:#5f5b54;--border:#e3e0d9;--grid:#ebe8e2;
  --accent:#4338ca;--accent-soft:#eceafd;--on-accent:#ffffff;--danger:#b42318;--danger-soft:#fdecea;
  --h0:#ebe9e4;--h1:#d6d2f6;--h2:#a7a0ee;--h3:#7166df;--h4:#4338ca;
  --s1:#d6d2f6;--s2:#8c84e6;--s3:#4338ca;
  --q0:#4338ca;--q1:#7166df;--q2:#a7a0ee;--q3:#d6d2f6;--q4:#e3e0d9;
  --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --fs-xs:.75rem;--fs-sm:.875rem;--fs-base:1rem;--fs-md:1.125rem;--fs-lg:1.375rem;--fs-xl:1.75rem;--fs-2xl:clamp(2rem,1.4rem + 2.6vw,2.875rem);
  --radius:14px;--gap:20px;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0f0f11;--surface:#17171a;--surface-2:#1d1d21;--text:#ececef;--muted:#a4a3ad;--border:#2b2b31;--grid:#232328;
  --accent:#a8a2ff;--accent-soft:#25234a;--on-accent:#111027;--danger:#ff8f85;--danger-soft:#3a1c1a;
  --h0:#222227;--h1:#302c60;--h2:#4a43a3;--h3:#7067e0;--h4:#a8a2ff;
  --s1:#35316d;--s2:#6a62d6;--s3:#b4afff;
  --q0:#a8a2ff;--q1:#7a71e6;--q2:#5148b0;--q3:#363170;--q4:#2b2b31;
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:400 var(--fs-base)/1.6 var(--font);font-feature-settings:"tnum" 1;-webkit-font-smoothing:antialiased}
main{max-width:1040px;margin:0 auto;padding:0 24px 64px}
h1,h2,h3,h4{margin:0;font-weight:650;letter-spacing:-.015em;line-height:1.2}
h1{font-size:var(--fs-2xl);letter-spacing:-.025em}
h2{font-size:var(--fs-xl)}
h3{font-size:var(--fs-md)}
h4{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
p{margin:0}
a{color:var(--accent)}
code,pre,.mono{font-family:var(--mono);font-size:.9em}
code{background:var(--surface-2);padding:.1em .35em;border-radius:5px;overflow-wrap:anywhere}
.muted{color:var(--muted)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.eyebrow{font-size:var(--fs-xs);font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}

.masthead{padding:56px 0 8px}
.brand{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--muted);margin-bottom:40px}
.brand b{color:var(--text);font-weight:650;letter-spacing:-.01em}
.masthead h1{margin:10px 0 16px}
.lead{font-size:var(--fs-md);line-height:1.55;max-width:62ch;color:var(--text)}
.lead.small{font-size:var(--fs-base);color:var(--muted)}
nav.toc{display:flex;flex-wrap:wrap;gap:6px 18px;margin:32px 0 0;padding:14px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);font-size:var(--fs-sm)}
nav.toc a{color:var(--muted);text-decoration:none}
nav.toc a:hover{color:var(--accent)}

.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-top:32px}
.tiles.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.tile{background:var(--surface);padding:18px 20px}
.tile .value{display:block;font-size:var(--fs-xl);font-weight:650;letter-spacing:-.02em;line-height:1.15}
.tile .label{display:block;font-size:var(--fs-sm);color:var(--muted);margin-top:4px}
.tile .sub{display:block;font-size:var(--fs-xs);color:var(--muted);margin-top:2px}

section{padding-top:80px}
.section-head{margin-bottom:28px;max-width:68ch}
.section-head h2{margin:6px 0 10px}
.section-head p{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:var(--gap)}
.grid.two{grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.stack>*+*{margin-top:var(--gap)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;min-width:0}
.card>h3+*,.card>h4+*{margin-top:14px}
.card p+p{margin-top:10px}
.card-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.card-head .muted{font-size:var(--fs-sm)}
.count{font-size:var(--fs-sm);color:var(--muted);margin-top:4px}
.prose{max-width:68ch}
.quote{font-size:var(--fs-md);line-height:1.6;border-left:3px solid var(--accent);padding-left:20px;max-width:68ch}

.col-chart{margin:0}
.col-body{display:grid;grid-template-columns:auto 1fr;gap:10px}
.y-title{font-size:var(--fs-xs);color:var(--muted);margin-bottom:8px}
.x-title{font-size:var(--fs-xs);color:var(--muted);text-align:center;margin-top:4px}
.y-axis{position:relative;height:160px;min-width:28px;font-size:var(--fs-xs);color:var(--muted);text-align:right}
.y-axis span{position:absolute;right:0;transform:translateY(50%);line-height:1}
.plot{min-width:0}
.plot svg{display:block;width:100%;height:160px;overflow:visible}
.tall .y-axis,.tall .plot svg{height:200px}
.x-axis{position:relative;height:22px;font-size:var(--fs-xs);color:var(--muted)}
.x-axis span{position:absolute;top:6px;transform:translateX(-50%);white-space:nowrap}
svg .gl{stroke:var(--grid);stroke-width:1}
svg .gl.base{stroke:var(--border)}
svg .s1 rect,.key.s1{fill:var(--s1);background:var(--s1)}
svg .s2 rect,.key.s2{fill:var(--s2);background:var(--s2)}
svg .s3 rect,.key.s3{fill:var(--s3);background:var(--s3)}
svg .hits rect{fill:transparent}
svg .hits rect:hover{fill:var(--text);fill-opacity:.06}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:var(--fs-xs);color:var(--muted);margin-top:10px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.key{display:inline-block;width:10px;height:10px;border-radius:3px;flex:none}
.chart-empty{display:flex;align-items:center;justify-content:center;min-height:120px;border:1px dashed var(--border);border-radius:10px;color:var(--muted);font-size:var(--fs-sm);padding:16px;text-align:center}

.heatmap{margin:0}
.scroll-x{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.heatmap svg{display:block;max-width:none}
.heatmap rect.h0,.key.h0{fill:var(--h0);background:var(--h0)}
.heatmap rect.h1,.key.h1{fill:var(--h1);background:var(--h1)}
.heatmap rect.h2,.key.h2{fill:var(--h2);background:var(--h2)}
.heatmap rect.h3,.key.h3{fill:var(--h3);background:var(--h3)}
.heatmap rect.h4,.key.h4{fill:var(--h4);background:var(--h4)}
.heatmap rect:hover{stroke:var(--text);stroke-width:1}
svg text.axis{fill:var(--muted);font:11px var(--font)}
.heat-legend{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--muted);margin-top:12px}
.heat-legend .scale{display:inline-flex;align-items:center;gap:4px}

.bars{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.bars li{display:grid;grid-template-columns:minmax(0,9.5rem) 1fr auto;align-items:center;gap:12px;font-size:var(--fs-sm)}
.bars.mono .bar-label{font-family:var(--mono);font-size:var(--fs-xs)}
.bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{height:10px;background:var(--surface-2);border-radius:5px;overflow:hidden}
.bar-fill{display:block;height:100%;background:var(--accent);border-radius:5px;min-width:3px}
.bar-value{color:var(--muted);font-size:var(--fs-xs);min-width:3.5em;text-align:right}
.more{font-size:var(--fs-xs);color:var(--muted);margin-top:10px}

.composition .comp-bar{display:flex;height:14px;border-radius:7px;overflow:hidden;gap:2px;background:var(--surface)}
.comp-bar span{display:block;height:100%;min-width:3px}
.q0{background:var(--q0)}.q1{background:var(--q1)}.q2{background:var(--q2)}.q3{background:var(--q3)}.q4{background:var(--q4)}
.comp-legend{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:6px;font-size:var(--fs-sm)}
.comp-legend li{display:flex;align-items:center;gap:8px}
.comp-legend b{font-weight:600;margin-left:auto}
.comp-legend .muted{min-width:3.2em;text-align:right;font-size:var(--fs-xs)}

.meter{height:10px;border-radius:5px;background:var(--surface-2);overflow:hidden;margin-top:10px}
.meter span{display:block;height:100%;background:var(--accent)}

.not-found{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:18px}
.not-found .status{margin-right:4px}
.status{font-size:var(--fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.status.on{color:var(--accent)}
.status.off{color:var(--muted)}
dl.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:14px 0 0;font-size:var(--fs-sm)}
dl.facts dt{color:var(--muted)}
dl.facts dd{margin:0;text-align:right}

.callout{background:var(--accent-soft);border:1px solid transparent;border-radius:var(--radius);padding:28px}
.callout h2{font-size:var(--fs-lg);margin:6px 0 10px}
.callout p{max-width:66ch}
.callout p+p,.callout p+.copy{margin-top:14px}

table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
th,td{padding:10px 12px;text-align:right;border-bottom:1px solid var(--border);white-space:nowrap}
th:first-child,td:first-child{text-align:left;padding-left:0}
th:last-child,td:last-child{padding-right:0}
th{font-weight:600;font-size:var(--fs-xs);color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
td.model{font-family:var(--mono);font-size:var(--fs-xs);white-space:normal;overflow-wrap:anywhere;min-width:10rem}
tr.total td{font-weight:650;border-bottom:0}
.note{font-size:var(--fs-sm);color:var(--muted);margin-top:16px;max-width:72ch}

.finding{display:grid;gap:12px;align-content:start}
.finding-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-xs);font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 10px}
.badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--border)}
.badge.high{color:var(--danger);border-color:currentColor}
.badge.high::before{background:var(--danger)}
.badge.medium::before{background:var(--accent)}
.badge.low::before{background:var(--h2)}
.chip{display:inline-block;font-size:var(--fs-xs);color:var(--muted);background:var(--surface-2);border-radius:999px;padding:2px 10px}
.finding h3{font-size:var(--fs-md)}
.metric{display:flex;align-items:baseline;gap:8px}
.metric b{font-size:var(--fs-xl);font-weight:650;letter-spacing:-.02em}
.metric span{color:var(--muted);font-size:var(--fs-sm)}
.evidence{list-style:none;margin:0;padding:0;border-top:1px solid var(--border)}
.evidence li{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:10px 0;border-bottom:1px solid var(--border);font-size:var(--fs-sm)}
.evidence .where{font-size:var(--fs-xs);color:var(--muted);text-align:right;white-space:nowrap}
.evidence .where code{background:none;padding:0}
.see{font-size:var(--fs-sm)}
ul.examples{margin:10px 0 0;padding-left:1.1em;color:var(--muted);font-size:var(--fs-sm)}
ul.examples li+li{margin-top:4px}

.suggestion .type{font-size:var(--fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.suggestion h3{margin-top:6px}
.suggestion .from{font-size:var(--fs-xs);color:var(--muted);margin-top:12px}
.learn{font-size:var(--fs-sm);color:var(--muted);margin-top:12px;overflow-wrap:anywhere}
.learn a{text-underline-offset:2px}
.learn a::after{content:" ↗";speak:never}
.copy{position:relative;margin-top:16px}
.copy pre{margin:0;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:16px 18px;padding-right:84px;font-size:var(--fs-xs);line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;max-height:22rem;overflow:auto;color:var(--text)}
.copy button{display:none;position:absolute;top:10px;right:10px;font:600 var(--fs-xs)/1 var(--font);color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:7px;padding:7px 11px;cursor:pointer}
.js .copy button{display:block}
.copy button:hover{border-color:var(--accent);color:var(--accent)}
.copy button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chips .chip{font-family:var(--mono)}
.chips .chip b{font-family:var(--font);font-weight:600;color:var(--text);margin-left:6px}

.matrix{margin-top:96px;padding:48px 40px;border-radius:20px;background:var(--surface);border:1px solid var(--border);position:relative;overflow:hidden}
.matrix::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--accent)}
.matrix h2{max-width:24ch;margin:8px 0 16px}
.matrix p{max-width:62ch;color:var(--muted)}
.matrix p+p{margin-top:12px}
.matrix .history{display:flex;align-items:baseline;gap:12px;margin:28px 0 18px}
.matrix .history b{font-size:var(--fs-2xl);font-weight:650;letter-spacing:-.03em;color:var(--text);line-height:1}
.matrix .history span{color:var(--muted)}
.cta{display:inline-flex;align-items:center;gap:8px;margin-top:28px;background:var(--accent);color:var(--on-accent);text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px}
.cta:hover{filter:brightness(1.08)}
footer{max-width:1040px;margin:0 auto;padding:32px 24px 56px;font-size:var(--fs-xs);color:var(--muted);border-top:1px solid var(--border)}
footer p+p{margin-top:6px}

@media (max-width:640px){
  main{padding:0 16px 48px}
  footer{padding:28px 16px 48px}
  .masthead{padding-top:32px}
  .brand{margin-bottom:28px}
  section{padding-top:56px}
  .card{padding:18px}
  .callout{padding:22px}
  .matrix{padding:32px 22px;margin-top:64px}
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tiles.three{grid-template-columns:repeat(3,minmax(0,1fr))}
  .tiles.three .tile{padding:12px}
  .tile{padding:14px 16px}
  .tile .value{font-size:var(--fs-lg)}
  .bars li{grid-template-columns:minmax(0,7rem) 1fr auto;gap:10px}
  .evidence li{grid-template-columns:1fr}
  .evidence .where{text-align:left}
}
@media print{
  body{background:#fff;color:#000}
  .copy button,nav.toc{display:none!important}
  section{break-inside:avoid-page;padding-top:40px}
  .card,.matrix{break-inside:avoid}
}
`;
