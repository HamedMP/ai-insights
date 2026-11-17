/* sharelink.js: the "Share your stats" link. Builds a small versioned payload from the recap's aggregate numbers
   and puts it in the URL fragment of the site's /share page. Fragments never reach a server, and nothing here
   sends anything: the person copies or clicks the link. site/lib/share.ts decodes and validates the same format;
   tests/render/share-link.test.ts proves the two agree.
   v2 adds the recap cards as data: a fixed card key, a short headline and a caption, each built here from counts,
   dates, agent names and fixed wording only. No card field is ever copied from text the person or a model wrote.
   v3 adds what the site needs to keep one entry per machine and add them up: the store's random device id and a
   name the person typed (or none), the count each ratio is out of, and, unless the person turns it off, which days
   had activity (dates only, as a bitmap) so the site can combine active days and streaks across machines.
   Without a device id (an unwritable store) the link is v2, exactly as 0.4 made it. */
const ShareLink = (() => {
  "use strict";
  const V = 3;
  const LIMITS = Object.freeze({ deviceName: 32, dayBits: 3660, base: 1e9, name: 40, fact: 120, agents: 8, sessions: 1e7, tokens: 1e13, usd: 1e7, days: 3660, cards: 16, big: 32, caption: 80, titles: 3, ratio: 1000, fragment: 3800 });
  // Control characters and bidi overrides: a name must not reorder or hide the text around it on the card.
  const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
  const clean = (value, max) => Array.from(String(value == null ? "" : value).replace(/\s+/g, " ").replace(UNSAFE, "").trim()).slice(0, max).join("");
  const num = (value, max) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; };
  const whole = (value, max) => Math.round(num(value, max));
  const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : fmt(n));
  const one = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US");
  const pct = (share) => `${Math.round(num(share, 1) * 100)}%`;
  const plural = (n, word, many = `${word}s`) => `${fmt(n)} ${n === 1 ? word : many}`;
  const hh = (hour) => `${String(whole(hour, 23)).padStart(2, "0")}:00`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dshort = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1] || "?"} ${Number(d.slice(8, 10))}`;

  /** Fixed wording only: anything not in these tables is left out, never passed through. */
  const AGENTS = { "claude-code": "Claude Code", codex: "Codex", cursor: "Cursor", pi: "Pi", opencode: "OpenCode", gemini: "Gemini CLI", "claude-chat": "Claude chat" };
  // Chat exports record no tokens. The site estimates each agent's tokens as total tokens times its share of
  // sessions, so their sessions stay out of the per-agent shares (and the arenas built on them).
  const UNMEASURED = new Set(["claude-chat"]);
  const VERDICTS = { night_owl: "Night owl", early_bird: "Early bird", evening: "Golden-hour builder", afternoon: "Afternoon engine", morning: "Morning mind" };
  const DAYS = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
  const PERSONA = /^The (?:Night|Dawn|Golden-Hour|Afternoon|Morning) (?:Orchestrator|Shipper|Delegator|Conversationalist)$/;
  // Display names the analysis makes from known public model families (src/analysis/recap/text.ts modelLabel).
  // A family, then only version numbers and known variant words: a custom model id cannot smuggle a name through.
  const FAMILY = /^(?:Claude|GPT|O[1-9]|Codex|Gemini|Grok|Deepseek|Qwen[0-9][0-9a-z.]*|Kimi|Glm|Mistral|Llama[0-9]*)$/;
  const VARIANTS = new Set(["opus", "sonnet", "haiku", "fable", "mythos", "instant", "mini", "nano", "pro", "max", "flash", "lite", "turbo", "codex", "chat", "coder", "high", "low", "medium", "preview", "thinking", "spark", "plus", "large", "small", "air", "reasoner", "latest"]);
  const publicModel = (key) => {
    const words = key.split(/[ -]/);
    return words.length <= 5 && FAMILY.test(words[0]) && words.slice(1).every((w) => /^[0-9][0-9a-z.]{0,7}$/i.test(w) || VARIANTS.has(w.toLowerCase()));
  };

  /** Card titles, the same table as site/lib/share.ts CARD_TITLES. Titles are never sent: the key picks them. */
  const TITLES = Object.freeze({
    persona: "Persona", parallel: "Most agents at once", tokens: "Tokens processed", streak: "Longest streak",
    marathon: "Longest session", clock: "When they prompt", manners: "Manners check", danger: "Danger zone",
    hours: "Time with agents", model: "Top model", weekday: "Favourite day", tests: "Test runs",
    shell: "Bash hall of fame", failures: "Where things broke", words: "Words typed", slash: "Slash commands",
    thinking: "Deep thoughts", approvals: "Rubber stamp", history: "History kept",
  });

  /**
   * One builder per published card, in the order the profile shows them (and the order cards are dropped from the
   * end when the link would get too long). Each returns [headline, caption] or null when the card has nothing true
   * to say. Inputs are the recap view's numbers; the only strings used are table lookups and checked patterns.
   * Cards with free text in the report (top words, slash command and program names, tips) publish a count instead.
   */
  const BUILD = {
    persona: (rc) => {
      const P = rc.persona, T = rc.totals || {}, range = rc.range || {};
      const title = P && typeof P.title === "string" ? P.title : "";
      if (!rc.hasRhythm || !PERSONA.test(title)) return null;
      return [title, `${plural(whole(T.sessions, LIMITS.sessions), "session")} in ${plural(whole(range.days, 1e5), "day")}`];
    },
    parallel: (rc) => {
      const P = rc.parallel || {}, max = whole(P.max, 1000), subs = whole(P.subagents, 1e7);
      return max >= 2 ? [`${fmt(max)} at once`, subs > 0 ? `sessions side by side, plus ${plural(subs, "subagent")}` : "sessions running side by side"] : null;
    },
    tokens: (rc) => {
      const U = rc.usage || {}, tokens = whole(U.tokens, LIMITS.tokens);
      if (tokens <= 0) return null;
      const usd = typeof U.usd === "number" && U.usd > 0 ? num(U.usd, LIMITS.usd) : 0;
      return [short(tokens), usd ? `tokens, about $${fmt(usd)} at API list prices` : `tokens in ${plural(whole(U.requests, 1e9), "model request")}`];
    },
    streak: (rc) => {
      const S = rc.streak || {}, days = whole(S.days, LIMITS.days);
      if (days < 1 || !isDay(S.start) || !isDay(S.end)) return null;
      return [plural(days, "day"), `in a row, ${dshort(S.start)} to ${dshort(S.end)}`];
    },
    marathon: (rc) => {
      const L = rc.longestSession;
      if (!L || num(L.activeMinutes, 1e7) <= 0) return null;
      const agent = AGENTS[L.harness];
      return [`${one(num(L.activeMinutes, 1e7) / 60)} hrs`, agent ? `of active work in one ${agent} session` : "of active work in one session"];
    },
    clock: (rc) => {
      const R = rc.rhythm || {}, verdict = VERDICTS[R.verdict && R.verdict.key];
      return rc.hasRhythm && verdict && whole(rc.totals && rc.totals.prompts, 1e9) >= 10 ? [verdict, `busiest hour ${hh(R.peakHour)}`] : null;
    },
    manners: (rc) => {
      const V = rc.voice || {}, p = V.polite || {}, prompts = whole(V.prompts, 1e9);
      if (prompts < 10) return null;
      const please = whole(p.please, 1e7);
      return [`${fmt(please)} ${please === 1 ? "please" : "pleases"}`, `${plural(whole(p.thanks, 1e7), "thank-you")} and ${plural(whole(p.sorry, 1e7), "sorry", "sorries")} in ${plural(prompts, "prompt")}`];
    },
    danger: (rc) => {
      const S = rc.shell || {}, rmrf = whole(S.rmrf, 1e7), push = whole(S.forcePush, 1e7);
      return rmrf + push > 0 ? [`${fmt(rmrf)} × rm -rf`, `${plural(push, "force push", "force pushes")} and ${plural(whole(S.sleeps, 1e7), "nap")}. Nothing caught fire.`] : null;
    },
    hours: (rc) => {
      const T = rc.totals || {}, wall = whole(T.wallHours, 1e7);
      return wall > 0 ? [`${fmt(wall)} hrs`, `with an agent at work, ${fmt(whole(T.agentHours, 1e7))} agent-hours in all`] : null;
    },
    model: (rc) => {
      const m = Array.isArray(rc.models) ? rc.models[0] : null;
      if (!m || typeof m.key !== "string" || m.key.length > LIMITS.big || !publicModel(m.key)) return null;
      return [m.key, `answered ${pct(m.share)} of ${plural(whole(rc.usage && rc.usage.requests, 1e9), "model request")}`];
    },
    weekday: (rc) => {
      const R = rc.rhythm || {}, days = Array.isArray(R.weekdays) ? R.weekdays : [];
      if (!rc.hasRhythm || whole(rc.totals && rc.totals.prompts, 1e9) < 10) return null;
      const top = days.filter((d) => d && DAYS[d.key]).slice().sort((a, b) => num(b.count, 1e9) - num(a.count, 1e9))[0];
      return top && whole(top.count, 1e9) > 0 ? [DAYS[top.key], `the busiest day, ${plural(whole(top.count, 1e9), "prompt")}`] : null;
    },
    tests: (rc) => {
      const S = rc.shell || {}, tests = whole(S.tests, 1e7);
      return tests > 0 && typeof S.testPass === "number" ? [plural(tests, "run"), `of the tests, ${pct(S.testPass)} passed`] : null;
    },
    shell: (rc) => {
      const calls = whole(rc.shell && rc.shell.calls, 1e9);
      return calls > 0 ? [fmt(calls), "shell commands run by agents"] : null;
    },
    failures: (rc) => {
      const F = rc.failures || {}, total = whole(F.total, 1e9);
      return total > 0 ? [fmt(total), `failed tool calls, ${one(num(F.rate, 1) * 100)}% of ${fmt(whole(F.calls, 1e9))}`] : null;
    },
    words: (rc) => {
      const V = rc.voice || {}, typed = whole(V.wordsTyped, 1e10);
      return whole(V.prompts, 1e9) >= 10 && typed > 0 ? [short(typed), `words in prompts, ${pct(V.questionShare)} of them questions`] : null;
    },
    slash: (rc) => {
      const total = whole(rc.slashTotal, 1e9);
      return total > 0 ? [fmt(total), "slash commands typed"] : null;
    },
    thinking: (rc) => {
      const t = rc.thinking, blocks = whole(t && t.blocks, 1e9);
      if (blocks < 10) return null;
      const longest = num(t.longestMs, 1e9) / 1000;
      return [fmt(blocks), longest >= 1 ? `thinking blocks, the longest ${longest >= 60 ? `${one(longest / 60)} min` : `${fmt(longest)} s`}` : "thinking blocks"];
    },
    approvals: (rc) => {
      const a = rc.approvals;
      if (!a || typeof a.auto !== "number" || typeof a.byPerson !== "number" || a.auto + a.byPerson <= 0) return null;
      return [fmt(whole(a.auto, 1e9)), `actions approved automatically, ${fmt(whole(a.byPerson, 1e9))} by hand`];
    },
    history: (rc) => {
      const H = rc.history, days = whole(H && H.days, 1e5);
      if (days <= 0) return null;
      const cached = whole(H.cachedOnly, 1e7);
      return [plural(days, "day"), cached > 0 ? `of history kept, ${plural(cached, "session")} saved from deletion` : "of agent history kept"];
    },
  };
  const CARD_KEYS = Object.freeze(Object.keys(BUILD));

  /** The five work ratios (src/analysis/ratios.ts), in the report's order. Only the numbers travel. */
  const RATIO_KEYS = Object.freeze(["correctionsPerSession", "contextResetShare", "toolErrorRate", "planFirstShare", "parallelism"]);
  /** Earned title keys and the ratio each comes from (src/analysis/recap/titles.ts). The site rebuilds the wording. */
  const TITLE_RATIO = Object.freeze({
    clear_briefer: "correctionsPerSession", hands_on_pilot: "correctionsPerSession", architect: "planFirstShare", improviser: "planFirstShare",
    conductor: "parallelism", deep_focuser: "parallelism", context_keeper: "contextResetShare", deep_diver: "contextResetShare",
    smooth_operator: "toolErrorRate", stress_tester: "toolErrorRate",
  });
  const r4 = (n) => Math.round(n * 1e4) / 1e4;

  /**
   * The ratios with a value, as {k, v}, or in v3 {k, v, n} with n the count the ratio is out of (sessions, tool
   * calls, clock hours), so the site can weigh one machine's ratio against another's. `ratios` is VIEW.ratios.
   */
  function ratioData(ratios, withBase = false) {
    const list = Array.isArray(ratios) ? ratios : [];
    const out = [];
    for (const k of RATIO_KEYS) {
      const r = list.find((x) => x && x.key === k);
      if (!r || typeof r.value !== "number" || !Number.isFinite(r.value)) continue;
      const entry = { k, v: r4(num(r.value, LIMITS.ratio)) };
      if (withBase) entry.n = Math.round(num(r.denominator, LIMITS.base) * 10) / 10;
      out.push(entry);
    }
    return out;
  }

  const dayNumber = (d) => Math.floor(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 864e5);
  const dayString = (n) => new Date(n * 864e5).toISOString().slice(0, 10);

  /**
   * Which days had activity, as {from, bits}: `from` is the first active day and bit i (least significant first,
   * eight days a byte, base64url) says whether day from+i had a prompt or active minutes, the same rule as the
   * recap's streak. Dates only: no counts, no times. Null when no day was active.
   */
  function activeDays(rc) {
    const daily = rc && Array.isArray(rc.daily) ? rc.daily : [];
    const days = daily.filter((d) => d && isDay(d.day) && (num(d.prompts, 1e9) > 0 || num(d.minutes, 1e9) > 0)).map((d) => dayNumber(d.day)).sort((a, b) => a - b);
    if (!days.length) return null;
    const first = days[0];
    const span = Math.min(LIMITS.dayBits, days[days.length - 1] - first + 1);
    const bytes = new Uint8Array(Math.ceil(span / 8));
    for (const n of days) { const i = n - first; if (i < span) bytes[i >> 3] |= 1 << (i & 7); }
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return { from: dayString(first), bits: btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
  }

  /** The earned titles as {k, v}: a known title key and the number of the ratio that earned it. Nothing else. */
  function titleData(rc, ratios) {
    const earned = rc && rc.persona && Array.isArray(rc.persona.earned) ? rc.persona.earned : [];
    const values = Object.fromEntries(ratioData(ratios).map((r) => [r.k, r.v]));
    const out = [];
    for (const t of earned) {
      const ratio = t && TITLE_RATIO[t.key];
      if (!ratio || values[ratio] === undefined || out.some((x) => x.k === t.key)) continue;
      out.push({ k: t.key, v: values[ratio] });
      if (out.length >= LIMITS.titles) break;
    }
    return out;
  }

  /** The cards the recap can honestly show, as data. A card whose builder cannot read its numbers is left out. */
  function cards(rc) {
    const out = [];
    for (const k of CARD_KEYS) {
      if (out.length >= LIMITS.cards) break;
      let made = null;
      try { made = BUILD[k](rc); } catch (err) { if (!(err instanceof TypeError)) throw err; console.warn("share card skipped", k); }
      if (!made) continue;
      const b = clean(made[0], LIMITS.big), c = clean(made[1], LIMITS.caption);
      if (b) out.push({ k, b, c });
    }
    return out;
  }

  /** One line from the recap's numbers. Built from counts only, never from anything the person wrote. */
  function funFact(rc) {
    const p = (rc && rc.parallel) || {}, voice = (rc && rc.voice) || {}, shell = (rc && rc.shell) || {}, rhythm = (rc && rc.rhythm) || {};
    const please = whole(voice.polite && voice.polite.please, 1e7);
    if (whole(p.max, 1000) >= 3) return `Ran ${whole(p.max, 1000)} agents at once.`;
    if (whole(shell.rmrf, 1e7) >= 5) return `Typed rm -rf ${fmt(whole(shell.rmrf, 1e7))} times and lived.`;
    if (please >= 10) return `Said please to an AI ${fmt(please)} times.`;
    if (rc && rc.bigDay && whole(rc.bigDay.prompts, 1e7) > 0) return `Biggest day: ${fmt(whole(rc.bigDay.prompts, 1e7))} prompts.`;
    if (rhythm.verdict && rhythm.verdict.label) return `${clean(rhythm.verdict.label, 30)}, peaking at ${whole(rhythm.peakHour, 23)}:00.`;
    return "";
  }

  /**
   * The payload: aggregate numbers, one fun fact and the cards as data. Nothing else from the history goes in.
   * `device` is {id, name, days}: the store's random id, the name typed in the share box, and whether to include
   * which days were active. Without an id the link is v2.
   */
  function payload(rc, name, ratios, device) {
    if (!rc) return null;
    const id = device && typeof device.id === "string" && /^[0-9a-f]{32}$/.test(device.id) ? device.id : null;
    const T = rc.totals || {}, U = rc.usage || {}, range = rc.range || {};
    const harnesses = (Array.isArray(T.harnesses) ? T.harnesses : []).filter((x) => x && !UNMEASURED.has(String(x.key)));
    const total = harnesses.reduce((a, x) => a + num(x && x.sessions, LIMITS.sessions), 0);
    const agents = harnesses
      .filter((x) => x && /^[a-z0-9-]{1,20}$/.test(String(x.key)) && num(x.sessions, LIMITS.sessions) > 0)
      .map((x) => ({ k: String(x.key), p: total ? whole((num(x.sessions, LIMITS.sessions) / total) * 100, 100) : 0 }))
      .sort((a, b) => b.p - a.p)
      .slice(0, LIMITS.agents);
    const out = {
      v: id ? V : 2,
      name: clean(name, LIMITS.name),
      from: isDay(range.from) ? range.from : "",
      to: isDay(range.to) ? range.to : "",
      sessions: whole(T.sessions, LIMITS.sessions),
      tokens: whole(U.tokens, LIMITS.tokens),
      usd: typeof U.usd === "number" && U.usd > 0 ? Math.round(num(U.usd, LIMITS.usd) * 100) / 100 : null,
      activeDays: whole(T.activeDays, LIMITS.days),
      streak: whole(rc.streak && rc.streak.days, LIMITS.days),
      agents,
      fact: clean(funFact(rc), LIMITS.fact),
      cards: cards(rc),
      titles: titleData(rc, ratios),
      ratios: ratioData(ratios, !!id),
    };
    if (id) {
      out.device = { id, name: clean(device.name, LIMITS.deviceName) };
      out.days = device.days === false ? null : activeDays(rc);
    }
    // Keep the link comfortably short for chat apps and under the site's limit: drop the last cards until it fits.
    while (out.cards.length && encode(out).length > LIMITS.fragment) out.cards.pop();
    return out;
  }

  function encode(p) {
    const bytes = new TextEncoder().encode(JSON.stringify(p));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const url = (p, base) => `${base.replace(/\/?$/, "/")}share/#${encode(p)}`;

  const TITLE_NAMES = Object.freeze({ clear_briefer: "The Clear Briefer", hands_on_pilot: "The Hands-On Pilot", architect: "The Architect", improviser: "The Improviser", conductor: "The Conductor", deep_focuser: "The Deep Focuser", context_keeper: "The Context Keeper", deep_diver: "The Deep Diver", smooth_operator: "The Smooth Operator", stress_tester: "The Stress Tester" });
  const RATIO_NAMES = Object.freeze({ correctionsPerSession: "mid-run corrections per session", contextResetShare: "sessions with a context reset", toolErrorRate: "tool-call error rate", planFirstShare: "started with a plan", parallelism: "sessions at once" });
  const RATIO_BASE = Object.freeze({ correctionsPerSession: "sessions you drove", contextResetShare: "sessions", toolErrorRate: "tool calls", planFirstShare: "sessions that edited files", parallelism: "clock hours" });
  const ratioText = (k, v) => (k === "parallelism" ? `${v.toFixed(1)}×` : k === "correctionsPerSession" ? v.toFixed(2) : `${v > 0 && v < 0.01 ? "<1" : Math.round(v * 100)}%`);

  /** What the link carries, in plain words, shown before the person copies it. Every card is listed in full. */
  function describe(p, names = {}) {
    const agentList = p.agents.map((a) => `${names[a.k] || a.k} ${a.p}%`).join(", ");
    const cardLines = (p.cards || []).map((c) => `Card “${TITLES[c.k] || c.k}”: ${c.b}${c.c ? `, ${c.c}` : ""}`);
    const titleLine = (p.titles || []).length ? `Earned titles: ${p.titles.map((t) => `${TITLE_NAMES[t.k] || t.k} (${RATIO_NAMES[TITLE_RATIO[t.k]]} ${ratioText(TITLE_RATIO[t.k], t.v)})`).join(", ")}` : null;
    const ratioLine = (p.ratios || []).length ? `Ratios: ${p.ratios.map((r) => `${RATIO_NAMES[r.k] || r.k} ${ratioText(r.k, r.v)}${typeof r.n === "number" ? ` of ${fmt(r.n)} ${RATIO_BASE[r.k]}` : ""}`).join(", ")}` : null;
    const deviceLines = p.device ? [
      `Device: ${p.device.name ? `“${p.device.name}”` : "no name (the site calls it “Device 1”, “Device 2”…)"}, random id ${p.device.id} made by AI Insights, not from this computer's name or hardware`,
      p.days ? `Which days you were active: ${fmt(daysCount(p.days.bits))} dates from ${p.days.from} on (dates only, no counts or times)` : "Which days you were active: not included",
    ] : [];
    return [
      p.name ? `Name: ${p.name}` : "No name (the card says “Someone”)",
      ...deviceLines,
      `Period: ${p.from} to ${p.to}`,
      `${fmt(p.sessions)} sessions, ${p.tokens > 0 || p.agents.length ? `${short(p.tokens)} tokens` : "tokens not measured (chat export only)"}${p.usd != null ? `, about $${fmt(p.usd)} estimated spend` : ""}`,
      `${fmt(p.activeDays)} active days, longest streak ${fmt(p.streak)} days`,
      agentList ? `Agents: ${agentList}` : null,
      p.fact ? `Fun fact: ${p.fact}` : null,
      titleLine,
      ratioLine,
      ...cardLines,
    ].filter(Boolean);
  }

  function daysCount(bits) {
    let n = 0;
    const bin = atob(String(bits).replace(/-/g, "+").replace(/_/g, "/"));
    for (let i = 0; i < bin.length; i += 1) for (let b = bin.charCodeAt(i); b; b >>= 1) n += b & 1;
    return n;
  }

  return { V, LIMITS, activeDays, daysCount, CARD_KEYS, TITLES, RATIO_KEYS, TITLE_RATIO, payload, cards, encode, url, describe, funFact, clean };
})();
