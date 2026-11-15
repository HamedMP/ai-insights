import { readFileSync } from "node:fs";

let cached: string | undefined;

/** The package version, read once from package.json (two levels up from both src/ and dist/). */
export function packageVersion(): string {
  if (cached) return cached;
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    cached = typeof version === "string" ? version : "0.0.0";
  } catch {
    cached = "0.0.0";
  }
  return cached;
}
