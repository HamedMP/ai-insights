import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonl, scanJsonl, type JsonlLimits } from "../../../src/sources/claude/jsonl.js";
import { readJsonl as referenceReadJsonl } from "../../reference/claude-jsonl.js";

// The reader was rewritten to decode lines in place instead of copying every piece. These tests hold it to the
// reader it replaced (kept verbatim in tests/reference), so every transcript still yields the same rows.

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function file(body: string | Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-insights-jsonl-"));
  dirs.push(dir);
  const path = join(dir, "t.jsonl");
  writeFileSync(path, body);
  return path;
}

async function rows(reader: typeof readJsonl, path: string, limits?: JsonlLimits) {
  const out: unknown[] = [];
  for await (const row of reader(path, limits)) out.push(row);
  return out;
}

const big = (bytes: number) => JSON.stringify({ type: "user", pad: "é".repeat(Math.floor(bytes / 2)) });

const CASES: Array<{ name: string; body: string | Buffer; limits?: JsonlLimits }> = [
  { name: "plain lines", body: '{"a":1}\n{"b":2}\n' },
  { name: "no trailing newline", body: '{"a":1}\n{"b":2}' },
  { name: "blank, whitespace-only and CRLF lines", body: '\n  \n{"a":1}\r\n\t\n{"b":2}\r\n\n' },
  { name: "bad JSON and non-objects", body: '{"a":\n[1,2]\n"text"\n42\nnull\n{"ok":true}\n' },
  { name: "torn final line", body: '{"a":1}\n{"b":' },
  { name: "lines that span 1 MiB read chunks, with multi-byte characters split", body: [big(900_000), big(1_500_000), '{"x":1}', big(3_000_000)].join("\n") + "\n" },
  { name: "an oversized line in the middle", body: ['{"a":1}', big(200_000), '{"b":2}'].join("\n"), limits: { maxBytes: 1e9, maxLineBytes: 100_000, maxLines: 1e6 } },
  { name: "an oversized final line without a newline", body: ['{"a":1}', big(200_000)].join("\n"), limits: { maxBytes: 1e9, maxLineBytes: 100_000, maxLines: 1e6 } },
  { name: "the line cap", body: Array.from({ length: 20 }, (_, n) => `{"n":${n}}`).join("\n"), limits: { maxBytes: 1e9, maxLineBytes: 1e6, maxLines: 7 } },
  { name: "the byte cap mid-line", body: Array.from({ length: 50 }, (_, n) => `{"n":${n}}`).join("\n"), limits: { maxBytes: 101, maxLineBytes: 1e6, maxLines: 1e6 } },
  { name: "the byte cap past one chunk", body: [big(1_200_000), big(1_200_000)].join("\n"), limits: { maxBytes: 1_500_000, maxLineBytes: 1e8, maxLines: 1e6 } },
];

describe("the JSONL reader gives every transcript the rows the previous reader gave", () => {
  for (const { name, body, limits } of CASES) {
    it(name, async () => {
      const path = file(body);
      expect(await rows(readJsonl, path, limits)).toEqual(await rows(referenceReadJsonl, path, limits));
    });
  }

  it("reports one unreadable issue for a missing file, like before", async () => {
    const path = join(tmpdir(), "ai-insights-missing-file.jsonl");
    expect(await rows(readJsonl, path)).toEqual(await rows(referenceReadJsonl, path));
  });
});

describe("scanJsonl", () => {
  it("resuming from the position of the last complete line gives the rest of the rows", async () => {
    const lines = ['{"n":1}', big(1_200_000), '{"n":3}', '{"n":4}'];
    const path = file(lines.join("\n") + "\n" + '{"n":5');
    let position;
    const first: unknown[] = [];
    for await (const event of scanJsonl(path)) {
      if (event.kind === "at") position = event.position;
      else first.push(event);
    }
    expect(position).toEqual({ offset: Buffer.byteLength(lines.join("\n") + "\n"), lines: 4 });
    // The file grows: the torn line is completed and another follows.
    writeFileSync(path, lines.join("\n") + "\n" + '{"n":5}\n{"n":6}\n');
    const rest: unknown[] = [];
    for await (const event of scanJsonl(path, undefined, { from: position })) if (event.kind !== "at") rest.push(event);
    expect([...first.slice(0, 4), ...rest]).toEqual(await rows(referenceReadJsonl, path));
  });

  it("with a marker, parses only the lines holding it", async () => {
    const path = file(['{"type":"user"}', '{"type":"assistant","message":{"usage":{"input_tokens":1}}}', "not json", '{"usage":2}'].join("\n"));
    const seen: unknown[] = [];
    for await (const event of scanJsonl(path, undefined, { marker: Buffer.from('"usage"') })) if (event.kind === "record") seen.push(event.value);
    expect(seen).toEqual([{ type: "assistant", message: { usage: { input_tokens: 1 } } }, { usage: 2 }]);
  });
});
