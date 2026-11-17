import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { clientAssets, styleIds } from "../../src/render/assets.js";
import { CARD_IDS, recapView } from "../../src/render/view.js";
import type { Recap } from "../../src/schema/types.js";
import { makeReport } from "./fixtures.js";

const CLIENT = new URL("../../src/render/client/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, CLIENT), "utf8");
const RECAP = JSON.parse(readFileSync(new URL("./recap-fixture.json", import.meta.url), "utf8")) as Recap;
const D = recapView({ ...makeReport(), recap: RECAP })!;

/** The engine and the given style scripts in a fresh global scope, as the page loads them, without a DOM. */
function engineWith(styles: string[], data: unknown = D): { CardStyles: { list(): Array<{ id: string; ok: boolean }>; specs(id: string): Record<string, { id: string; build: unknown; dur: number }> | null; setData(d: unknown): void }; errors: string[] } {
  const errors: string[] = [];
  // Just enough DOM for a style that measures text on a detached canvas while building its specs.
  const document = { createElement: () => ({ getContext: () => ({ font: "", measureText: (text: string) => ({ width: String(text).length * 10 }) }) }) };
  const context = createContext({ document, console: { error: (...args: unknown[]) => errors.push(args.map(String).join(" ")), warn: () => {}, log: () => {} }, Math, Object, Array, JSON, Number, String, Map, Set, Date, Intl, Promise });
  for (const code of [read("rabbit.js"), read("engine.js"), ...styles]) new Script(code).runInContext(context);
  const CardStyles = new Script("CardStyles").runInContext(context);
  CardStyles.setData(JSON.parse(JSON.stringify(data)));
  return { CardStyles, errors };
}

describe("the client sources", () => {
  it("pass the build check: classic scripts, scoped style CSS, no page rule that restyles a card", () => {
    expect(() => execFileSync(process.execPath, [new URL("../../scripts/build-client.mjs", import.meta.url).pathname, "--check"], { stdio: "pipe" })).not.toThrow();
  });

  it("are all in the page, Pop first", () => {
    const { script, cardCss, styles } = clientAssets();
    expect(styles[0]).toBe("pop");
    expect(styles).toEqual(styleIds());
    for (const id of styles) {
      expect(new RegExp(`registerCardStyle\\(\\{\\s*id:\\s*"${id}"`).test(script), id).toBe(true);
      expect(cardCss.includes(`.card[data-style="${id}"]`), id).toBe(true);
    }
  });

  it("keep the launch hashtag and pitch in one config object, not in cards or captions", () => {
    const share = /const SHARE = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(read("engine.js"))![1]!;
    const tag = /hashtag: "([^"]+)"/.exec(share)![1]!;
    for (const file of ["page.js", ...readdirSync(new URL("styles/", CLIENT)).map((name) => `styles/${name}`)]) expect(read(file), file).not.toContain(tag);
  });
});

describe("card style registry", () => {
  it("builds every registered style with all 21 cards from the recap", () => {
    const styles = styleIds();
    const { CardStyles, errors } = engineWith(styles.map((id) => read(`styles/${id}.js`)));
    expect(errors).toEqual([]);
    expect(CardStyles.list().map((style) => style.id)).toEqual(styles);
    for (const id of styles) {
      const specs = CardStyles.specs(id)!;
      expect(specs, id).not.toBeNull();
      for (const card of CARD_IDS) {
        expect(typeof specs[card]!.build, `${id}/${card}`).toBe("function");
        expect(specs[card]!.dur, `${id}/${card}`).toBeGreaterThan(0);
      }
    }
  });

  it("adds the earned-titles card to every style when the persona earned a title, and leaves it out otherwise", () => {
    const styles = styleIds();
    const earned = { ...D, persona: { ...D.persona!, earned: [{ key: "architect", title: "The Architect", rule: "62% of sessions that edited files started with a plan (half or more earns it)" }] } };
    const { CardStyles, errors } = engineWith(styles.map((id) => read(`styles/${id}.js`)), earned);
    expect(errors).toEqual([]);
    for (const id of styles) expect(typeof CardStyles.specs(id)!.titles?.build, id).toBe("function");
    const without = engineWith(styles.map((id) => read(`styles/${id}.js`)), { ...D, persona: { ...D.persona!, earned: [] } });
    for (const id of styles) expect(without.CardStyles.specs(id)!.titles, id).toBeUndefined();
  });

  it("refuses a style without an id, name or specs, and a second style with the same id", () => {
    const { CardStyles, errors } = engineWith([
      read("styles/pop.js"),
      'registerCardStyle({ id: "Bad Id", name: "x", specs() { return []; } });',
      'registerCardStyle({ id: "pop", name: "Again", specs() { return []; } });',
      'registerCardStyle({ name: "no id" });',
    ]);
    expect(CardStyles.list().map((style) => style.id)).toEqual(["pop"]);
    expect(errors.length).toBe(3);
  });

  it("drops a style that throws or misses a card, and keeps the others working", () => {
    const { CardStyles, errors } = engineWith([
      read("styles/pop.js"),
      'registerCardStyle({ id: "broken", name: "Broken", specs() { throw new Error("boom"); } });',
      'registerCardStyle({ id: "partial", name: "Partial", specs() { return [{ id: "intro", build() {} }]; } });',
    ]);
    expect(CardStyles.list()).toEqual([expect.objectContaining({ id: "pop", ok: true }), expect.objectContaining({ id: "broken", ok: false }), expect.objectContaining({ id: "partial", ok: false })]);
    expect(errors.some((line) => line.includes("broken"))).toBe(true);
    expect(errors.some((line) => line.includes("missing cards"))).toBe(true);
  });
});
