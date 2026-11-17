/* sharelink.js: the "Share your stats" link. Builds a small versioned payload from the recap's aggregate numbers
   and puts it in the URL fragment of the site's /share page. Fragments never reach a server, and nothing here
   sends anything: the person copies or clicks the link. site/lib/share.ts decodes and validates the same format;
   tests/render/share-link.test.ts proves the two agree. */
const ShareLink = (() => {
  "use strict";
  const V = 1;
  const LIMITS = Object.freeze({ name: 40, fact: 120, agents: 8, sessions: 1e7, tokens: 1e13, usd: 1e7, days: 3660 });
  // Control characters and bidi overrides: a name must not reorder or hide the text around it on the card.
  const UNSAFE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
  const clean = (value, max) => Array.from(String(value == null ? "" : value).replace(/\s+/g, " ").replace(UNSAFE, "").trim()).slice(0, max).join("");
  const num = (value, max) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; };
  const whole = (value, max) => Math.round(num(value, max));
  const isDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : fmt(n));

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

  /** The payload: aggregate numbers and one fun fact. Nothing else from the history goes in. */
  function payload(rc, name) {
    if (!rc) return null;
    const T = rc.totals || {}, U = rc.usage || {}, range = rc.range || {};
    const harnesses = Array.isArray(T.harnesses) ? T.harnesses : [];
    const total = harnesses.reduce((a, x) => a + num(x && x.sessions, LIMITS.sessions), 0);
    const agents = harnesses
      .filter((x) => x && /^[a-z0-9-]{1,20}$/.test(String(x.key)) && num(x.sessions, LIMITS.sessions) > 0)
      .map((x) => ({ k: String(x.key), p: total ? whole((num(x.sessions, LIMITS.sessions) / total) * 100, 100) : 0 }))
      .sort((a, b) => b.p - a.p)
      .slice(0, LIMITS.agents);
    const out = {
      v: V,
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
    };
    return out;
  }

  function encode(p) {
    const bytes = new TextEncoder().encode(JSON.stringify(p));
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const url = (p, base) => `${base.replace(/\/?$/, "/")}share/#${encode(p)}`;

  /** What the link carries, in plain words, shown before the person copies it. */
  function describe(p, names = {}) {
    const agentList = p.agents.map((a) => `${names[a.k] || a.k} ${a.p}%`).join(", ");
    return [
      p.name ? `Name: ${p.name}` : "No name (the card says “Someone”)",
      `Period: ${p.from} to ${p.to}`,
      `${fmt(p.sessions)} sessions, ${short(p.tokens)} tokens${p.usd != null ? `, about $${fmt(p.usd)} estimated spend` : ""}`,
      `${fmt(p.activeDays)} active days, longest streak ${fmt(p.streak)} days`,
      agentList ? `Agents: ${agentList}` : null,
      p.fact ? `Fun fact: ${p.fact}` : null,
    ].filter(Boolean);
  }

  return { V, LIMITS, payload, encode, url, describe, funFact, clean };
})();
