import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { clientAssets } from "../../src/render/assets.js";
import { CARD_IDS, OPTIONAL_CARD_IDS } from "../../src/render/view.js";

const CLIENT = new URL("../../src/render/client/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, CLIENT), "utf8");

interface Deck { LEAD: string[]; CLOSE: string[]; order(ids: string[]): string[]; position(i: number, n: number): string }
const deck = (): Deck => {
  const context = createContext({ Object, Array });
  new Script(read("deck.js")).runInContext(context);
  return new Script("HeroDeck").runInContext(context) as Deck;
};

describe("the card deck at the top of the report", () => {
  const D = deck();
  const every = [...CARD_IDS, ...OPTIONAL_CARD_IDS];

  it("shows every card the report has, each exactly once, persona first and the maker's card last", () => {
    const shown = D.order(every);
    expect([...shown].sort()).toEqual([...every].sort());
    expect(shown[0]).toBe("persona");
    expect(shown.slice(0, D.LEAD.length)).toEqual(D.LEAD);
    expect(shown.slice(-2)).toEqual(["summary", "outro"]);
  });

  it("keeps the remaining cards in the order the report tells them, between the lead and the close", () => {
    const middle = D.order(every).slice(D.LEAD.length, -2);
    expect(middle).toEqual(every.filter((id) => !D.LEAD.includes(id) && !D.CLOSE.includes(id)));
  });

  it("still shows a small history's few cards, in a sensible order, without inventing missing ones", () => {
    expect(D.order(["intro", "words", "summary", "outro"])).toEqual(["words", "intro", "summary", "outro"]);
    expect(D.order(["hours", "outro"])).toEqual(["hours", "outro"]);
    expect(D.order([])).toEqual([]);
    expect(D.order(["persona", "persona", "clock"])).toEqual(["persona", "clock"]);
  });

  it("reads a position out as 'Card 3 of 16'", () => {
    expect(D.position(2, 16)).toBe("Card 3 of 16");
  });

  it("is in the page and reads nothing it could change: no storage, no studio selection", () => {
    const code = read("deck.js");
    expect(code).not.toMatch(/localStorage|\bstore\b|\.sel\b|saveStudio/);
    const { script } = clientAssets();
    expect(script.indexOf("const HeroDeck")).toBeGreaterThan(-1);
    expect(script.indexOf("const HeroDeck")).toBeLessThan(script.indexOf("page.js: the report page"));
  });
});

describe("report anchors", () => {
  it("keeps the section ids that the site's docs, the CLI and the share links point to", () => {
    const page = read("page.js");
    for (const id of ["recap", "overview", "publish", "studio", "analysis", "change", "time", "keep-history"]) expect(page, id).toMatch(new RegExp(`id: "${id}"`));
    expect(read("sharebox.js")).toContain('id: "share-stats"');
  });
});
