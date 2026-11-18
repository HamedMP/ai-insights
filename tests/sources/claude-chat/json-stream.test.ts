import { describe, expect, it } from "vitest";
import { ArrayElementParser, eachKey, orScalar, readArrayElements, type ElementResult, type JsonLimits, type Spec } from "../../../src/sources/claude-chat/json-stream.js";

const SPEC: Spec = { id: true, name: true, items: [{ n: true }], tags: [true] };

async function* chunked(text: string | Buffer, size: number): AsyncGenerator<Uint8Array> {
  const bytes = Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8");
  for (let start = 0; start < bytes.length; start += size) yield bytes.subarray(start, start + size);
}

async function all(text: string | Buffer, options: { size?: number; spec?: Spec; limits?: Partial<JsonLimits> } = {}): Promise<ElementResult[]> {
  const out: ElementResult[] = [];
  for await (const result of readArrayElements(chunked(text, options.size ?? 7), options.spec ?? SPEC, options.limits)) out.push(result);
  return out;
}

const values = (results: ElementResult[]) => results.filter((r) => r.kind === "element").map((r) => (r as { value: unknown }).value);
const issues = (results: ElementResult[]) => results.filter((r) => r.kind === "issue").map((r) => (r as { reason: string }).reason);

describe("streaming a large JSON array one element at a time", () => {
  it("hands over each element whole, whatever the chunk boundaries", async () => {
    const text = JSON.stringify([{ id: "a", name: "x", items: [{ n: 1 }, { n: 2.5e3 }], tags: ["t", true, null] }, { id: "b", name: "é ✓ 😀" }]);
    for (const size of [1, 2, 3, 64, 100_000]) {
      const got = await all(text, { size });
      expect(values(got)).toEqual([
        { id: "a", name: "x", items: [{ n: 1 }, { n: 2500 }], tags: ["t", true, null] },
        { id: "b", name: "é ✓ 😀" },
      ]);
      expect(issues(got)).toEqual([]);
    }
  });

  it("never builds keys the spec leaves out, nested containers included", async () => {
    const text = JSON.stringify([{ id: "a", secret: "SECRET", nested: { deep: ["SECRET"] }, items: [{ n: 1, secret: { x: "SECRET" } }] }]);
    const [first] = values(await all(text));
    expect(JSON.stringify(first)).not.toContain("SECRET");
    expect(first).toEqual({ id: "a", items: [{ n: 1 }] });
  });

  it("decodes escapes, including surrogate pairs and lone surrogates", async () => {
    const text = '[{"id":"q\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\ud83d\\ude00\\ud800x"}]';
    expect(values(await all(text, { size: 1 }))).toEqual([{ id: 'q"\\/\b\f\n\r\té😀�x' }]);
  });

  it("replaces unpaired surrogates and invalid UTF-8 rather than failing", async () => {
    expect(values(await all('[{"id":"a\\udc00b\\ud800"}]', { size: 1 }))).toEqual([{ id: "a\ufffdb\ufffd" }]);
    const bytes = Buffer.concat([Buffer.from('[{"id":"x'), Buffer.from([0xed, 0xa0, 0x80, 0xff]), Buffer.from('y"}]')]);
    const [result] = values(await all(bytes, { size: 2 })) as Array<{ id: string }>;
    expect(result!.id.startsWith("x") && result!.id.endsWith("y") && result!.id.includes("\ufffd")).toBe(true);
  });

  it("reads the array from an object root, skipping the other keys", async () => {
    const text = JSON.stringify({ meta: { skip: [1, 2, { a: "b" }] }, conversations: [{ id: "a" }, { id: "b" }], after: "x" });
    expect(values(await all(text))).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("caps each string and counts what it cut", async () => {
    const big = "y".repeat(50_000);
    const [result] = await all(JSON.stringify([{ id: big }]), { limits: { maxStringBytes: 100 } });
    expect(result).toMatchObject({ kind: "element", truncated: 1 });
    expect(((result as { value: { id: string } }).value.id).length).toBe(100);
  });

  it("caps each array and counts the dropped items", async () => {
    const [result] = await all(JSON.stringify([{ items: Array.from({ length: 30 }, (_, n) => ({ n })) }]), { limits: { maxArrayItems: 10 } });
    expect(result).toMatchObject({ kind: "element", dropped: 20 });
    expect((result as { value: { items: unknown[] } }).value.items).toHaveLength(10);
  });

  it("skips an element nested too deep and carries on with the next", async () => {
    let deep = "1";
    for (let level = 0; level < 200; level += 1) deep = `[${deep}]`;
    const text = `[{"id":"a","items":${deep}},{"id":"b"}]`;
    const got = await all(text, { limits: { maxDepth: 16 } });
    expect(issues(got)).toEqual(["too_deep"]);
    expect(values(got)).toEqual([{ id: "b" }]);
  });

  it("skips an element with too many values and carries on", async () => {
    const text = JSON.stringify([{ items: Array.from({ length: 50 }, (_, n) => ({ n })) }, { id: "ok" }]);
    const got = await all(text, { limits: { maxNodes: 20 } });
    expect(issues(got)).toEqual(["too_large"]);
    expect(values(got)).toEqual([{ id: "ok" }]);
  });

  it("stops at the element cap and the byte cap", async () => {
    const text = JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const capped = await all(text, { limits: { maxElements: 2 } });
    expect(values(capped)).toHaveLength(2);
    expect(issues(capped)).toEqual(["too_many"]);
    const bytes = await all(text, { limits: { maxBytes: 15 } });
    expect(values(bytes)).toEqual([{ id: "a" }]);
    expect(issues(bytes)).toEqual(["byte_limit"]);
  });

  it("reports malformed and truncated input as issues without throwing, keeping what came before", async () => {
    expect(issues(await all('[{"id":"a"},{"id":}]'))).toEqual(["syntax"]);
    expect(values(await all('[{"id":"a"},{"id":}]'))).toEqual([{ id: "a" }]);
    expect(issues(await all('[{"id":"a"},{"id":"b'))).toEqual(["truncated"]);
    expect(issues(await all('[{"id":"a"} {"id":"b"}]'))).toEqual(["syntax"]);
    expect(issues(await all('[{"id":tru}]'))).toEqual(["syntax"]);
    expect(issues(await all('[{"id":"\\x"}]'))).toEqual(["syntax"]);
    expect(issues(await all('"just a string"'))).toEqual(["not_an_array"]);
    expect(issues(await all(""))).toEqual(["not_an_array"]);
    expect(issues(await all(Buffer.from([0xff, 0xfe, 0x00])))).toEqual(["not_an_array"]);
  });

  it("a read error mid-stream ends the document as truncated", async () => {
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield Buffer.from('[{"id":"a"},');
      throw new Error("disk gone");
    }
    const out: ElementResult[] = [];
    for await (const result of readArrayElements(failing(), SPEC)) out.push(result);
    expect(values(out)).toEqual([{ id: "a" }]);
    expect(issues(out)).toEqual(["truncated"]);
  });

  it("never assigns a key the spec does not name, so __proto__ cannot pollute", async () => {
    const parser = new ArrayElementParser({ id: true });
    const [result] = parser.write(Buffer.from('[{"__proto__":{"polluted":true},"id":"a"}]'));
    expect(result).toMatchObject({ kind: "element", value: { id: "a" } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf((result as { value: object }).value)).toBe(Object.prototype);
  });

  it("builds every entry of a keyed map (a ChatGPT mapping) to one spec, capped like an array", async () => {
    const spec: Spec = { mapping: eachKey({ parent: true }) };
    const text = JSON.stringify([{ mapping: { a: { parent: null, secret: "SECRET" }, b: { parent: "a", message: { text: "SECRET" } }, c: { parent: "b" } } }]);
    const got = await all(text, { spec });
    expect(values(got)).toEqual([{ mapping: { a: { parent: null }, b: { parent: "a" }, c: { parent: "b" } } }]);
    expect(JSON.stringify(values(got))).not.toContain("SECRET");
    const capped = await all(text, { spec, limits: { maxArrayItems: 2 } });
    expect(values(capped)).toEqual([{ mapping: { a: { parent: null }, b: { parent: "a" } } }]);
    expect((capped[0] as { dropped: number }).dropped).toBe(1);
  });

  it("a keyed map never assigns __proto__, so a hostile export cannot pollute", async () => {
    const parser = new ArrayElementParser({ mapping: eachKey({ parent: true }) });
    const [result] = parser.write(Buffer.from('[{"mapping":{"__proto__":{"parent":"x","polluted":true},"a":{"parent":null}}}]'));
    expect(result).toMatchObject({ kind: "element", value: { mapping: { a: { parent: null } } } });
    const mapping = (result as { value: { mapping: object } }).value.mapping;
    expect(Object.getPrototypeOf(mapping)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("an array of mixed strings and objects keeps both when the spec allows a scalar", async () => {
    const spec: Spec = { parts: [orScalar({ content_type: true })] };
    const text = JSON.stringify([{ parts: ["hello", { content_type: "image_asset_pointer", asset_pointer: "SECRET" }, 3, [1]] }]);
    const [first] = values(await all(text, { spec }));
    expect(first).toEqual({ parts: ["hello", { content_type: "image_asset_pointer" }, 3, null] });
    // Without orScalar, a string where an object is expected is scanned and stands as null.
    const [strict] = values(await all(text, { spec: { parts: [{ content_type: true }] } }));
    expect(strict).toEqual({ parts: [null, { content_type: "image_asset_pointer" }, null, null] });
  });
});
