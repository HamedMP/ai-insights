/* deck.js: which cards the deck at the top of the report shows, in what order, and how a position is read out.
   The deck is for reading: it shows every card the report has and never touches the studio's selection, which
   only decides what goes into the video. Kept apart from page.js so the order can be tested without a browser. */
const HeroDeck = (() => {
  "use strict";
  // Lead with what people brag or argue about, persona first; close with the summary and the maker's card.
  const LEAD = Object.freeze(["persona", "parallel", "danger", "manners", "words", "clock"]);
  const CLOSE = Object.freeze(["summary", "outro"]);

  /** Every id in `ids` exactly once: the lead cards first, the rest in the order given, the closing cards last. */
  function order(ids) {
    const list = ids.filter((id, i) => typeof id === "string" && ids.indexOf(id) === i);
    const has = (id) => list.includes(id);
    return [...LEAD.filter(has), ...list.filter((id) => !LEAD.includes(id) && !CLOSE.includes(id)), ...CLOSE.filter(has)];
  }

  /** "Card 3 of 16": what the deck shows and screen readers hear for the card in view. */
  function position(i, n) {
    return `Card ${i + 1} of ${n}`;
  }

  return { LEAD, CLOSE, order, position };
})();
