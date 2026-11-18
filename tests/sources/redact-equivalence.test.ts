import { describe, expect, it } from "vitest";
import { redact, scrub, shortenHome } from "../../src/sources/shared.js";
import * as reference from "../reference/shared.js";

// redact and shortenHome skip their costly patterns when the cheap hint cannot match. These tests hold them to the
// versions without the hints (tests/reference), so the skip never changes what is stored. The strings are made up.

const PIECES = [
  "plain words", "token", "TOKEN", "my_api_key", "API_KEY=abc123", "apikey: 'xyz'", "password = \"hunter2\"", "PASSWD:x",
  "private_key=k", "ACCESS_KEY  =  v", "secret", "SECRET_TOKEN_VALUE=zz", "token limit is 200k", "tokens: 5",
  "sk-abcdefghijklmnop1234", "ghp_abcdefghijklmnopqrstuvwxyz12", "Bearer abcdefghijklmnopqrstu", "AKIAABCDEFGHIJKLMNOP",
  "a@b.co", "person@example.org", "name%40mail.example.com", "git@github.com:org/repo", "getty@1.service", "icon@2x.png", "@",
  "/home/alex/project", "/Users/sam/code", "C:\\Users\\Pat Lee\\docs", "https://example.com/home/page", "~/home/x", "$ROOT/home/me",
  "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----", "\t  spaced   out  ", "naïve café", "",
];

function combos(): string[] {
  const out: string[] = [...PIECES];
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
  for (let n = 0; n < 4000; n += 1) {
    const parts = Array.from({ length: 1 + (next() % 5) }, () => PIECES[next() % PIECES.length]!);
    out.push(parts.join([" ", "", "\n", "=", ":", "/"][next() % 6]!));
  }
  return out;
}

describe("redaction with cheap hints stores exactly what it stored before", () => {
  const inputs = combos();
  it("redact", () => {
    for (const text of inputs) expect(redact(text)).toBe(reference.redact(text));
  });
  it("shortenHome", () => {
    for (const text of inputs) expect(shortenHome(text)).toBe(reference.shortenHome(text));
  });
  it("scrub", () => {
    for (const text of inputs) expect(scrub(text, 120)).toBe(reference.scrub(text, 120));
  });
});
