# Card styles

The report's recap cards come in more than one visual style. Pop is the default.
A style is one script file plus one stylesheet. Adding a style is: drop the two
files into `src/render/client/styles/` and run `pnpm build`. The renderer finds
every `<id>.js` with a `<id>.css` beside it (Pop first, then by name);
`pnpm check` validates them. The page, the studio, the player,
the exporters and the tests pick it up from the registry; nothing else changes.

This document is the whole contract. If something you need is not here, ask
rather than reach into the page.

## Files

```
src/render/client/styles/<id>.js    the card specs (classic script, no import/export)
src/render/client/styles/<id>.css   the card stylesheet
```

`<id>` is lowercase `[a-z0-9-]{1,24}`: `pop`, `panel`, `sticker`.

Both files are inlined into the report at build time. The page loads no files at
run time and has a strict CSP (`default-src 'none'`): no network, no `fetch`, no
`<img src=http…>`, no remote fonts, no `eval`/`new Function`. Images, if any,
are inline SVG or `data:` URIs inside the CSS (keep them small; the whole report
is one file).

## The script

The script runs once, in the page's global scope, after the engine and before
the page. It must make exactly one call:

```js
registerCardStyle({
  id: "panel",                       // same as the file name
  name: "Instrument panel",          // shown in the style picker (<= 20 chars)
  swatch: "linear-gradient(135deg,#101214 50%,#f5c400 50%)", // CSS background for the picker chip
  specs(D, kit) {                    // called lazily, once per page load
    return [ /* card specs, see below */ ];
  },
});
```

Wrap everything else in the file in the `specs` function or an IIFE. Do not
declare top-level `const`/`let`/`function` names: every style shares one global
scope with the engine and the other styles, and a duplicate top-level name is a
SyntaxError that breaks the whole page. Do not read `BUNDLE`, `window.recap`,
`localStorage`, `location` or the DOM outside the card element you are given.

`D` is the recap view model (shape below). `kit` holds the engine helpers (also
available as globals, but prefer `kit`):

| `kit.` | what |
| --- | --- |
| `h(tag, attrs, ...kids)` | HTML element. `attrs.style` may be an object (custom properties allowed), `class`, `html` (avoid), `on*` handlers |
| `s(tag, attrs, ...kids)` | SVG element |
| `clamp, lerp, E` | math; `E.lin/out/out5/inOut/spring` easings |
| `int(n)` `one(n)` `pct(x)` `compact(n)` | number formats: `12,345`, `12.3`, `45%`, `1.2M` |
| `capped(n, cap)` | `"10,000+"` above `cap`, else `int(n)` (use it for counts that can be huge) |
| `dshort("2026-11-16")` | `"Nov 16"` |
| `hh(21)` | `"21:00"` |
| `DAYNAME.Mon` | `"Mondays"` |
| `rng(seed)` | deterministic PRNG returning `[0,1)`. Never use `Math.random` |
| `smooth(points, closed, tension)` | Catmull-Rom path `d` string |
| `rabbitSvg(fill, height)` | the maker's mark rabbit as an `<svg>` |
| `cellGrid(n, w, h, gapRatio, fixedCols?)` | best square-cell grid `{cols, rows, size, gap}` |
| `harnessName(key)` | `"claude-code"` → `"Claude Code"` (all six harnesses) |
| `fitAll(root)` | re-run single-line fitting inside `root` |
| `share` | `{ hashtag, pitch, command, skill, site, siteUrl }`: the one place the launch hashtag and "make your own" text live. Use it on the summary and outro cards; never hard-code the hashtag |

## A card spec

The 21 required card ids are fixed. A style must provide all 21 (any order), so a
person's selection and order carry over when they switch style. A style that
misses one is not offered (the console says which).

Optional ids are cards any style may implement. They are never in the default
selection, and the page offers one only when its data exists (`D.avail[id]`)
and the current style draws it: a style without it simply does not offer that
card. Build an optional card only when its data is present (`if (D.thinking)
add(...)`). Today:

| id | title | from | offered when |
| --- | --- | --- | --- |
| `thinking` | Deep thoughts | `D.thinking` | at least 10 thinking blocks |
| `approvals` | Rubber stamp | `D.approvals` | `auto` and `byPerson` both recorded |
| `history` | History kept | `D.history` | retention data exists |

```
intro hours clock weekday streak words manners slash shell tests danger
parallel marathon failures nemesis model tokens persona tips summary outro
```

```js
{
  id: "hours",                 // one of the 21
  title: "Time",               // studio label, <= 16 chars
  dur: 6500,                   // ms on screen in the player and video at pace 1
  bg: "#c9b8ff", fg: "#141210",// any CSS colour / var() resolved inside .card
  dark: false,                 // true when bg is dark (studio UI contrast)
  squareSide: false,           // true: 1:1 uses the side-by-side layout like 16:9
  noFoot: false,               // ONLY the outro may set this (it is the mark)
  bigMark: false,              // larger maker's mark (summary)
  insets(ctx) { return { top: 0, bottom: 0 }; },   // optional extra padding
  build(ctx) { return parts; },
}
```

`build(ctx)` is called by CardKit for every ratio and every fit attempt. It must
be a pure function of `(D, ctx)`. `ctx`:

| field | meaning |
| --- | --- |
| `W, H` | card size in px: 1:1 1080×1080, 9:16 1080×1920, 4:5 1080×1350, 16:9 1920×1080 |
| `u` | `min(W,H)/1080`; multiply fixed pixel sizes by it |
| `k` | fit step, 1 down to 0.48. CardKit retries with smaller `k` until the card fits; size text with `calc(var(--k) * Npx)` or `N * c.k * c.u` |
| `r, wide, square, tall` | aspect ratio and its class |
| `mode` | `"side"` (16:9, or 1:1 with `squareSide`) or `"stack"` |
| `box` | content box `{x, y, w, h}` inside the padding and above the footer |
| `P, G` | padding and gap in px |
| `tl` | the timeline (below) |
| `el` | the `.card` element; `art` its full-size background `<svg>` |
| `final` | true on the last fit attempt (draw something even if tight) |

`parts`:

| key | meaning |
| --- | --- |
| `head` | node(s): the text block. Stack mode: top of the box. Side mode: left column |
| `extra` | optional node pinned to the bottom of the text column |
| `art(w, h, x, y)` | optional: returns an `<svg>` or element for the art box; DOM is scaled down to fit, never up |
| `artFirst` | art above (stack) or left of (side) the text |
| `artMin` | minimum art height as a share of the box in stack mode (default 0.3); below it CardKit tries a smaller `k` |
| `split` | side mode: text column share (default 0.5) |
| `center` | vertically centre the head when there is no art |
| `artAlign` | `"center"` or `"start"` |
| `legend` | short string for the footer's right side (`"ALL TIMES Europe/Berlin"`) |
| `post(rect)` | runs after layout; `rect(node)` gives its box inside the card, to place decoration in `ctx.art` |

Single-line text that must fit its width: set `data-fit` (max px) and
`data-min` (min px) on the element; CardKit shrinks it to fit.

### Timeline

All motion goes through `ctx.tl`. Every frame is a pure function of `t` (ms):
the player, the video exporter, PNG export and `window.recap.seek(t)` all call
the same `render(inst, t)`. No CSS animations or transitions on card content,
no `requestAnimationFrame`, no `Date.now()`/`performance.now()` in cards.

```
tl.at(start, dur, ease, (p, t) => …)   // p in [0,1] eased
tl.in(el, start, {dur, y, x, sc, rot, ease})
tl.pop(el, start, opts)                 // spring scale-in
tl.count(el, start, dur, to, fmt, from) // number count-up; the final text is set at build
tl.draw(path, start, dur, ease)         // stroke draw-on
tl.grow(el, start, {dur, axis, origin, ease})
tl.stagger(els, start, gap, (el, start, i) => …)
tl.idle((t) => …)                       // runs every frame, for loops
```

At `t = dur` the card must show its final state (the PNG exporter and the
layout audit render that frame). Entrance animations should finish by about
`dur - 1500`.

### Fonts

Three families are embedded for every style:
`"Brico"` (Bricolage Grotesque, display, 200–800), `"GeistR"` (Geist, text,
100–900), `"GeistM"` (Geist Mono, 100–900). CSS custom properties on `.card`:
`--display`, `--text`, `--mono`. Text in SVG must name the family explicitly
(`font-family="GeistM, monospace"`). A style may bring its own fonts (agreed with the page owner first): put the
latin-subset woff2 files and their licence texts (`<family>-OFL.txt`, where the
font file name starts with `<family>-`) in `src/render/client/fonts/`, list them
in `styles/<id>.fonts.json` as `[{ "family", "file", "weight" }]`, and name the
faces to wait for in the registration: `fonts: ["800 100px PanelCond"]`. The
page adds those @font-face rules to the card CSS only when the style is first
used, and waits for them before laying out or exporting.

## The stylesheet

Every selector must start with `.card[data-style="<id>"]`. CardKit sets
`data-style` on every card it builds. The base stylesheet (`card.css`) gives
every style: `.card` positioning, `.blk`, `.foot`, `.mark`, `.legend`, the
colour slots `--paper --ink --lilac --purple --mint --yellow --coral --orange
--sky --pink --lime --red --brand-deep --brand-lime`, and the font variables.
You may redefine the slots for your style on `.card[data-style="<id>"]`.

The card stylesheet is also copied into every exported video and PNG frame, so
keep it lean (aim under 8 KB) and self-contained: no `@import`, no `url()` to
anything but `data:`.

## Maker's mark

CardKit draws the footer mark (rabbit + "AI Insights by Matrix OS") on every
card unless the person turns it off in the studio; you do not draw it. You may
restyle it through `.card[data-style="<id>"] .foot` / `.mark` but it must stay
legible (4.5:1 against your `bg`) and inside the card. Reserve its space: never
place content under it (CardKit already shrinks `box` for it).

The `outro` card is the lime-on-teal maker's card: keep its colours
(`--brand-deep` background, `--brand-lime` foreground), the rabbit, "AI
Insights", "by Matrix OS", `/analyze-ai-usage` and `matrix-os.com`. You may lay
it out in your style.

## The data: `D`

`D` is built by `src/render/view.ts` (`RecapView`) from the product's `Recap`
(`src/schema/types.ts`, `docs/recap-contract.md`). Fields the data layer leaves
absent arrive here as `null` (never `undefined`), lists as `[]`, and the
page never builds a card whose `avail` is false, so a card only needs to guard
what is marked `?` below. Fields marked `?` may be
missing or `null`; a card must not invent a number when they are.

```
generatedAt, timeZone                    ISO string, IANA zone
hasRhythm                                false: no prompt had a timestamp; rhythm is zeros and clock,
                                         weekday, persona and summary are not offered
range {from, to, days}                   YYYY-MM-DD; days can be 1..400+
totals {sessions, prompts, activeDays, wallHours, agentHours,
        harnesses:[{key, sessions}], commits, commitShare, compactions,
        toolCalls, toolsPerPrompt, toolCallsCapped}   capped: show "10,000+" (kit.capped)
rhythm {hours[24], peakHour, nightShare, earlyShare, verdict{key,label},
        quiet{len,start}, latestNight, harnessPeaks[{key,peak,prompts,hours[24]}],
        weekdays[{key:"Mon".."Sun", count}]}       (always 7, Mon first)
daily [{day, sessions, prompts, minutes}]          one per day in range, can be 287+
streak {days, start, end}
bigDay {day, prompts, weekday}?
voice {prompts, excludedAgentSessions, excludedWrapped, words[{key,count}], openers[{key,count}],
       polite{please,thanks,sorry}, questionShare, wordsTyped, oneWord,
       leverage{words, toolCalls}}
interrupted, slash[{key,count}], slashTotal
shell {calls, programs[{key,count}], tests, testPass?, rmrf, forcePush, sleeps}
parallel {max, overlapEvents, subagents, lanes?}
  lanes {windowMinutes, peak, atPeak, rows[{harness, start, end, active[[from, to]], atPeak}]}
                                         all shares (0..1) of a window around the busiest moment (about
                                         6 h); `peak` is that moment. The rows with atPeak number exactly
                                         `atPeak`, which equals `max`: show that count. At most 40 rows. A
                                         chart that looks like data must be data: draw lanes from this, or
                                         when it is null a plain schematic (N identical marks, no time axis),
                                         never random.
longestSession {activeMinutes, wallMinutes, prompts, toolCalls, toolCallsCapped, harness, compactions,
                skippedAutomated}?       skippedAutomated > 0: longer sessions a script or another agent
                                         drove were left out; say so in a small line ("N longer automated
                                         sessions left out")
topProjectShare
failures {total, calls, rate, categories[{key,label,count}], nemesis[{key,count,runs}]}
models [{key, harness, requests, share}]
usage {tokens, output, requests, usd?, unpriced, cacheHitRate?, novels, usdPerCommit?,
       priced: boolean}        priced=false: no cost claims at all (e.g. Cursor-only)
winRate?, facetSessions                   winRate null without agent review facets
persona {title, time, role, reason}
tips [{title, kind, metric{value,unit,label}?}]   1..3, titles from a fixed list; word the "why" line
                                         per kind from the number alone (label may be "")
history {days, firstDay?, cachedOnly}?    days of sessions AI Insights still has, back to firstDay;
                                         cachedOnly: sessions whose transcript is gone (optional card)
thinking {blocks, sessions, totalMs?, longestMs?}?   totalMs/longestMs null when no harness timed it
approvals {auto?, byPerson?, denied?, autoBlocked?, guardianReviews?, sessions}?
                                         each counter null when no harness here records it: never read
                                         null as 0. auto: let through by settings or mode; byPerson:
                                         approved by the person; denied: declined by the person;
                                         autoBlocked: Codex's automatic reviewer blocked it (not the person)
replies {count, medianSec, fastShare, longestSec}?
connectors [{key,count}], skills [{key,count}]       public names only
avail {<cardId>: boolean}                 false = the page will not build that card
```

All strings in `D` are share-safe: aggregate labels, allowlisted words and
program names, no prompts, paths, project names or session ids. Cards must show
only what is in `D`; never pull text from anywhere else. That is the privacy
line for everything a person can export.

Big histories: `range.days` and `daily.length` can be in the hundreds, counts
in the hundreds of thousands. Use `kit.capped` for counts, bound any per-item
drawing (at most ~150 marks per series; bin or sample), and make three-digit day
counts fit in titles.

## Checks your style must pass

`pnpm audit:cards` (headless Chromium) builds every card × 4 ratios × every
registered style with the demo data and with a large-history fixture, renders
the frame at `t = dur`, and fails on any `CardKit.audit` issue: text outside
the card, text overflowing its box or column, cut single-line text, text blocks
overlapping. The large-history fixture also carries a year's thinking, approvals
and 300 days of history, so optional cards are audited at scale. `pnpm test` also
checks that each style registers 21 specs with the ids above, that seek is deterministic (same `t` → same markup) and that no
string outside `D` reaches card markup.
