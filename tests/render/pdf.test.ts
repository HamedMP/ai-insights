import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { clientAssets } from "../../src/render/assets.js";

const read = (file: string) => readFileSync(new URL(`../../src/render/client/${file}`, import.meta.url), "utf8");

interface Page { jpeg: Uint8Array; width: number; height: number }
interface Writer { LIMITS: { pages: number; bytes: number }; build(pages: Page[], opts?: { size?: number; title?: string }): Uint8Array }
function writer(): Writer {
  const context = createContext({ Object, Array, Uint8Array, String, Math, Error });
  new Script(read("pdf.js")).runInContext(context);
  return new Script("PdfWriter").runInContext(context) as Writer;
}

/** A stand-in JPEG: SOI, a marker byte that tells pages apart, bytes that look like PDF syntax, EOI. */
const fakeJpeg = (n: number) => Uint8Array.from([0xff, 0xd8, n & 0xff, ...Buffer.from("endstream endobj 9 0 obj"), 0x00, 0x0a, 0xff, 0xd9]);

/** Reads a file back the way a strict reader does: from startxref to the xref table to each object. */
function parse(bytes: Uint8Array) {
  const s = Buffer.from(bytes).toString("latin1");
  expect(s.startsWith("%PDF-1.4\n")).toBe(true);
  expect(s.endsWith("%%EOF\n")).toBe(true);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)![1]);
  expect(s.slice(startxref, startxref + 5)).toBe("xref\n");
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(s.slice(startxref))!.map(Number);
  expect(first).toBe(0);
  const table = s.slice(startxref).split("\n").slice(2);
  const objects = new Map<number, string>();
  for (let num = 1; num < count!; num++) {
    const entry = s.substr(startxref + `xref\n0 ${count}\n`.length + num * 20, 20);
    expect(entry, `xref entry ${num}`).toMatch(/^\d{10} 00000 n\r\n$/);
    const offset = Number(entry.slice(0, 10));
    expect(s.slice(offset).startsWith(`${num} 0 obj\n`), `object ${num} at ${offset}`).toBe(true);
    const end = s.indexOf("\nendobj\n", offset);
    objects.set(num, s.slice(offset, end));
  }
  expect(table[0]).toBe("0000000000 65535 f\r");
  const trailer = /trailer\n<< \/Size (\d+) \/Root (\d+) 0 R \/Info (\d+) 0 R >>/.exec(s)!;
  expect(Number(trailer[1])).toBe(count);
  const streamOf = (num: number) => {
    const offset = Number(s.substr(startxref + `xref\n0 ${count}\n`.length + num * 20, 10));
    const head = s.slice(offset);
    const length = Number(/\/Length (\d+)/.exec(head)![1]);
    const start = offset + head.indexOf("stream\n") + "stream\n".length;
    expect(s.slice(start + length, start + length + "\nendstream\n".length), `stream ${num} length`).toBe("\nendstream\n");
    return bytes.slice(start, start + length);
  };
  const root = objects.get(Number(trailer[2]))!;
  const pagesRef = Number(/\/Pages (\d+) 0 R/.exec(root)![1]);
  const tree = objects.get(pagesRef)!;
  const kids = [...tree.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const pages = kids.map((num) => {
    const page = objects.get(num)!;
    const box = /\/MediaBox \[0 0 (\d+) (\d+)\]/.exec(page)!.slice(1).map(Number);
    const image = Number(/\/Im0 (\d+) 0 R/.exec(page)![1]);
    const contents = Number(/\/Contents (\d+) 0 R/.exec(page)![1]);
    return { box, image: streamOf(image), imageDict: objects.get(image)!, draw: Buffer.from(streamOf(contents)).toString("latin1") };
  });
  return { count: Number(/\/Count (\d+)/.exec(tree)![1]), pages, info: objects.get(Number(trailer[3]))! };
}

describe("the LinkedIn carousel PDF", () => {
  const W = writer();

  for (const n of [1, 3, 25]) {
    it(`is a well-formed ${n}-page file: xref offsets land on their objects, stream lengths match, every page square`, () => {
      const pages = Array.from({ length: n }, (_, i) => ({ jpeg: fakeJpeg(i), width: 2160, height: 2160 }));
      const pdf = parse(W.build(pages, { size: 1080, title: "AI Insights recap" }));
      expect(pdf.count).toBe(n);
      expect(pdf.pages).toHaveLength(n);
      for (const page of pdf.pages) {
        expect(page.box).toEqual([1080, 1080]);
        expect(page.imageDict).toContain("/Filter /DCTDecode");
        expect(page.imageDict).toContain("/Width 2160 /Height 2160");
        expect(page.draw).toBe("q 1080 0 0 1080 0 0 cm /Im0 Do Q");
      }
    });
  }

  it("keeps the order it is given: page k shows the k-th card's image, byte for byte", () => {
    const pages = [7, 2, 5].map((k) => ({ jpeg: fakeJpeg(k), width: 1080, height: 1080 }));
    const pdf = parse(W.build(pages));
    expect(pdf.pages.map((p) => p.image[2])).toEqual([7, 2, 5]);
    pdf.pages.forEach((p, i) => expect(Buffer.from(p.image).equals(Buffer.from(pages[i]!.jpeg))).toBe(true));
  });

  it("carries a generic title and nothing else about the person in its metadata", () => {
    const { info } = parse(W.build([{ jpeg: fakeJpeg(1), width: 10, height: 10 }], { title: "AI Insights recap" }));
    expect(info).toContain("/Title (AI Insights recap)");
    expect(info).not.toMatch(/Author|Subject|Keywords|CreationDate/);
    // Text that could break the string is neutralised.
    expect(parse(W.build([{ jpeg: fakeJpeg(1), width: 10, height: 10 }], { title: "a) /Author (x" })).info).toContain("/Title (a\\) /Author \\(x)");
  });

  it("refuses an empty deck or a page without an image instead of writing a broken file", () => {
    expect(() => W.build([])).toThrow();
    expect(() => W.build([{ jpeg: null as never, width: 1, height: 1 }])).toThrow();
  });

  it("states LinkedIn's document limits as its help pages give them", () => {
    expect(W.LIMITS.pages).toBe(300);
    expect(W.LIMITS.bytes).toBe(100_000_000);
    expect(read("pdf.js")).toContain("linkedin.com/help/linkedin/answer/a518909");
  });

  it("is in the page, before the page script that uses it", () => {
    const { script } = clientAssets();
    expect(script.indexOf("const PdfWriter")).toBeGreaterThan(-1);
    expect(script.indexOf("const PdfWriter")).toBeLessThan(script.indexOf("const VIEW = JSON.parse"));
  });
});
