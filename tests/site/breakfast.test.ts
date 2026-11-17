// Temporary: the Slush AI Breakfast Club's landing-page section for visitors in Finland. Delete this file with
// site/lib/breakfast.ts once the breakfast has started (19 Nov 2026, 08:00 Helsinki).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripFragment } from "../../site/lib/analytics-sanitize.ts";
import { BREAKFAST_COUNTRY_COOKIE, BREAKFAST_COUNTRY_MAX_AGE, BREAKFAST_UNTIL, countryCookieFor, showLandingBreakfast } from "../../site/lib/breakfast.ts";

const SITE = join(import.meta.dirname, "..", "..", "site");
const read = (path: string) => readFileSync(join(SITE, path), "utf8");
const BEFORE = Date.UTC(2026, 10, 17, 12, 0, 0);
const landing = { pathname: "/", country: "FI", fetchDest: "document", existing: undefined, now: BEFORE };

describe("the Finland flag cookie the proxy sets", () => {
  it("is set on a landing-page visit from Finland, before the breakfast", () => {
    expect(countryCookieFor(landing)).toBe(true);
    expect(countryCookieFor({ ...landing, fetchDest: null })).toBe(true);
  });

  it("is not set for another country, a missing header, or anything that is not exactly FI", () => {
    for (const country of ["SE", "US", "", null, "fi", "FIN", " FI"]) expect(countryCookieFor({ ...landing, country }), String(country)).toBe(false);
  });

  it("is not set on other pages, on prefetches and asset loads, when it is already there, or from the cutoff on", () => {
    for (const pathname of ["/share", "/leaderboard", "/docs", "/u/ada", "/api/leaderboard/entry"]) expect(countryCookieFor({ ...landing, pathname }), pathname).toBe(false);
    for (const fetchDest of ["empty", "script", "image", "iframe"]) expect(countryCookieFor({ ...landing, fetchDest }), fetchDest).toBe(false);
    expect(countryCookieFor({ ...landing, existing: "1" })).toBe(false);
    expect(countryCookieFor({ ...landing, now: BREAKFAST_UNTIL })).toBe(false);
  });

  it("holds a flag only, readable by the page, for a few hours", () => {
    expect(BREAKFAST_COUNTRY_COOKIE).toBe("aii_fi");
    expect(BREAKFAST_COUNTRY_MAX_AGE).toBeLessThanOrEqual(12 * 3600);
    const proxy = read("proxy.ts");
    const line = proxy.split("\n").find((l) => l.includes("res.cookies.set(BREAKFAST_COUNTRY_COOKIE"))!;
    expect(line).toContain('res.cookies.set(BREAKFAST_COUNTRY_COOKIE, "1", { maxAge: BREAKFAST_COUNTRY_MAX_AGE, httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" })');
  });

  it("reads only the country header in the proxy: never the IP or the city", () => {
    const proxy = read("proxy.ts");
    expect(proxy).toContain('country: request.headers.get("x-vercel-ip-country")');
    expect(proxy).not.toMatch(/x-forwarded-for|x-real-ip|x-vercel-ip-city|x-vercel-ip-latitude|request\.ip\b|geolocation\(|ipAddress\(/);
  });
});

describe("whether the landing section shows", () => {
  it("shows for the Finland flag or the ?breakfast=1 preview, only before the breakfast", () => {
    expect(showLandingBreakfast({ now: BEFORE, cookies: "aii_fi=1", search: "" })).toBe(true);
    expect(showLandingBreakfast({ now: BEFORE, cookies: "other=x; aii_fi=1; more=y", search: "" })).toBe(true);
    expect(showLandingBreakfast({ now: BEFORE, cookies: "", search: "?breakfast=1" })).toBe(true);
    expect(showLandingBreakfast({ now: BEFORE, cookies: "", search: "?a=b&breakfast=1" })).toBe(true);
    expect(showLandingBreakfast({ now: BREAKFAST_UNTIL, cookies: "aii_fi=1", search: "?breakfast=1" })).toBe(false);
  });

  it("stays hidden for everyone else", () => {
    for (const cookies of ["", "aii_fi=0", "xaii_fi=1", "aii_fi=11"]) expect(showLandingBreakfast({ now: BEFORE, cookies, search: "" }), cookies).toBe(false);
    for (const search of ["?breakfast=0", "?breakfast=yes", "?xbreakfast=1"]) expect(showLandingBreakfast({ now: BEFORE, cookies: "", search }), search).toBe(false);
  });

  it("never sends the preview parameter to analytics", () => {
    expect(stripFragment("https://ai-insights.app/?breakfast=1")).toBe("https://ai-insights.app/");
    expect(stripFragment("https://ai-insights.app/?a=b&breakfast=1&c=d")).toBe("https://ai-insights.app/?a=b&c=d");
    expect(stripFragment("/?breakfast=1&ref=ada")).toBe("/?ref");
  });
});
