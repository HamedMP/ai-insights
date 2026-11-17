/* sharebox.js: the "Join the leaderboard" box under the card studio. The buttons come first so they are in view when
   the box is; then a preview of what the link carries, drawn from the same payload that is encoded (ShareLink.preview),
   then two collapsed sections: options for publishing from several computers, and the exact line-by-line list with
   the raw link. Everything the page owns (storage, clipboard, new tabs, the report data) is passed in, so tests can
   build the real box without a browser. Nothing here sends anything: the person copies or clicks the link. */
const ShareBox = (() => {
  "use strict";

  /**
   * env: { rc, ratios, deviceId, chatOnly, names, site: {siteUrl, command, hashtag}, intent: {x, linkedin},
   *        store: {get, set}, copy(text, what), open(url) -> boolean (false when the browser blocked the tab) }
   */
  function build(env) {
    const LIMITS = ShareLink.LIMITS;
    const hasDevice = typeof env.deviceId === "string";
    const nameIn = h("input", { class: "slink-name", type: "text", maxlength: String(LIMITS.name), placeholder: "Your name (optional)", "aria-label": "Display name for the link", autocomplete: "off", spellcheck: "false" });
    // The device name is remembered in this browser only, so the next report from this machine offers it again.
    const deviceIn = h("input", { class: "slink-name", type: "text", maxlength: String(LIMITS.deviceName), placeholder: "e.g. Work laptop", "aria-label": "Name for this computer", autocomplete: "off", spellcheck: "false", value: env.store.get("deviceName", "") || "" });
    const daysIn = h("input", { type: "checkbox", checked: env.store.get("shareDays", true) !== false });
    const who = h("div", { class: "slink-who" });
    const sum = h("ul", { class: "slink-sum" });
    const meta = h("dl", { class: "slink-meta" });
    const fact = h("p", { class: "slink-fact small" });
    const grid = h("ul", { class: "slink-tiles" });
    const also = h("p", { class: "slink-also muted small" });
    const list = h("ul", { class: "slink-list" });
    const raw = h("code", { class: "slink-url" });
    const status = h("p", { class: "share-status small", role: "status" });
    let link = "";
    const post = () => `My AI coding, recapped: ${link}\nFind out yours: ${env.site.command}\n${env.site.hashtag}`;

    const refresh = () => {
      const device = hasDevice ? { id: env.deviceId, name: deviceIn.value, days: daysIn.checked } : null;
      const p = ShareLink.payload(env.rc, nameIn.value, env.ratios, device);
      link = ShareLink.url(p, env.site.siteUrl);
      const v = ShareLink.preview(p, env.names);
      who.replaceChildren(h("strong", {}, v.name), v.period ? h("span", { class: "muted" }, ` · ${v.period}`) : null);
      sum.replaceChildren(...v.stats.filter((s) => !s.wide).map((s) => h("li", {}, h("span", { class: "slink-sum-v" }, s.value), h("span", { class: "slink-sum-l" }, s.label))));
      meta.replaceChildren(...v.stats.filter((s) => s.wide).map((s) => h("div", {}, h("dt", {}, s.label), h("dd", {}, s.value))));
      fact.textContent = v.fact ? `“${v.fact}”` : "";
      grid.replaceChildren(...v.cards.map((c) => h("li", { class: "slink-tile" },
        h("span", { class: "slink-tile-k" }, c.title),
        h("span", { class: "slink-tile-big" }, c.big),
        c.caption ? h("span", { class: "slink-tile-cap" }, c.caption) : null)));
      also.textContent = v.also.length ? `Also in the link: ${v.also.join(", ")}.` : "";
      list.replaceChildren(...ShareLink.describe(p, env.names).map((line) => h("li", {}, line)));
      raw.textContent = link;
    };
    nameIn.addEventListener("input", refresh);
    deviceIn.addEventListener("input", () => { env.store.set("deviceName", deviceIn.value); refresh(); });
    daysIn.addEventListener("change", () => { env.store.set("shareDays", daysIn.checked); refresh(); });
    const open = (url) => { status.textContent = env.open(url) ? "" : "Your browser blocked the new tab. Copy the link instead."; };
    const btn = (label, fn, cls = "btn small") => h("button", { class: cls, type: "button", onclick: fn }, label);
    refresh();

    return h("div", { class: "slink share", id: "share-stats" },
      h("div", { class: "share-h" }, "Leaderboard"),
      h("h3", { class: "slink-title" }, "Share your stats and cards, join the leaderboard"),
      h("p", { class: "slink-lede muted small" }, "The link holds only the numbers and cards shown below. Nothing is uploaded until you sign in and press Publish on the site."),
      h("div", { class: "slink-actions" },
        h("label", { class: "slink-field" }, h("span", { class: "sr" }, "Display name"), nameIn),
        h("div", { class: "share-row" },
          btn("Publish to the leaderboard", () => open(link), "btn small primary"),
          btn("Copy link", () => env.copy(link, "Link copied")),
          btn("X", () => open(env.intent.x(post()))),
          btn("LinkedIn", () => open(env.intent.linkedin(post()))))),
      status,
      env.chatOnly ? h("p", { class: "small slink-chat" }, "Your history is a chat export only. Chat exports record no tokens or spend, so the site shows both as not measured (the link carries tokens as 0 and no spend), and your entry will not rank in the token, spend or agent arenas.") : null,
      h("div", { class: "slink-preview", "aria-label": "Preview of what the link shares", role: "group" },
        who, sum, meta, fact, grid, also),
      hasDevice ? h("details", { class: "more slink-more" },
        h("summary", {}, "Publishing from more than one computer?"),
        h("div", { class: "slink-more-body" },
          h("p", { class: "muted small" }, "Publish from each one with the same account and the site adds them up. Each computer has a random id AI Insights made, never its name or hardware."),
          h("label", { class: "slink-field slink-field-row small" }, h("span", {}, "Name this computer (optional, shown only if you choose when publishing)"), deviceIn),
          h("label", { class: "slink-check small" }, daysIn, " Include which days I was active (dates only), so streaks combine across computers"))) : null,
      h("details", { class: "more slink-more" },
        h("summary", {}, "See exactly what's in the link"),
        h("div", { class: "slink-more-body" },
          h("p", { class: "small" }, h("strong", {}, "The link contains exactly these lines:")),
          list,
          raw)));
  }

  return { build };
})();
