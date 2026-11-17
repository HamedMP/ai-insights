import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeEvent, stripFragment } from "../../site/lib/analytics-sanitize.ts";

const SITE = join(import.meta.dirname, "..", "..", "site");
const FRAG = "#eyJ2IjoxLCJuYW1lIjoiQWRhIn0";

describe("site analytics never sends a share link's fragment", () => {
  it("strips the fragment from URLs and paths, and leaves other text alone", () => {
    expect(stripFragment(`https://ai-insights.app/share/${FRAG}`)).toBe("https://ai-insights.app/share/");
    expect(stripFragment(`/share/${FRAG}`)).toBe("/share/");
    expect(stripFragment("https://ai-insights.app/leaderboard/?arena=codex")).toBe("https://ai-insights.app/leaderboard/?arena=codex");
    expect(stripFragment("#MyAIInsights is a hashtag")).toBe("#MyAIInsights is a hashtag");
  });

  it("reduces a referrer's handle in a URL to a bare flag, so analytics knows only that there was one", () => {
    expect(stripFragment("https://ai-insights.app/u/ada?ref=ada")).toBe("https://ai-insights.app/u/ada?ref");
    expect(stripFragment("/leaderboard?arena=codex&ref=grace-h&page=2")).toBe("/leaderboard?arena=codex&ref&page=2");
    expect(stripFragment(`/share?ref=ada${FRAG}`)).toBe("/share?ref");
    expect(stripFragment("https://ai-insights.app/?prefer=1")).toBe("https://ai-insights.app/?prefer=1");
    const out = sanitizeEvent({ properties: { $current_url: "https://ai-insights.app/u/ada?ref=ada", $referrer: "https://x.com/?ref=ada" } })!;
    expect(JSON.stringify(out)).not.toContain("ref=ada");
  });

  it("cleans every URL-like property, nested ones and $set/$set_once included, and tags the site", () => {
    const event = {
      event: "$pageview",
      properties: {
        $current_url: `https://ai-insights.app/share/${FRAG}`,
        $referrer: `https://hamedmp.github.io/ai-insights/share/${FRAG}`,
        $pathname: `/share/${FRAG}`,
        $initial_current_url: `https://ai-insights.app/share/${FRAG}`,
        $session_entry_url: `https://ai-insights.app/share/${FRAG}`,
        nested: { list: [`https://ai-insights.app/u/x/${FRAG}`] },
        valid: true,
      },
      $set: { $current_url: `https://ai-insights.app/share/${FRAG}` },
      $set_once: { $initial_referrer: `https://x.com/${FRAG}` },
    };
    const out = sanitizeEvent(event as { properties: Record<string, unknown>; $set?: unknown; $set_once?: unknown })!;
    expect(JSON.stringify(out)).not.toContain(FRAG);
    expect(out.properties!.$current_url).toBe("https://ai-insights.app/share/");
    expect(out.properties!.site).toBe("ai-insights");
    expect(out.properties!.valid).toBe(true);
    expect(event.properties.$current_url).toContain(FRAG);
    expect(sanitizeEvent(null)).toBeNull();
  });

  it("is wired as before_send, first party through /relay, with replay, autocapture and surveys off and DNT respected", () => {
    const init = readFileSync(join(SITE, "lib/analytics.ts"), "utf8");
    for (const line of ['api_host: "/relay"', "autocapture: false", "disable_session_recording: true", "respect_dnt: true", "disable_external_dependency_loading: true", "disable_surveys: true", "before_send: (event) => sanitizeEvent(event)"]) expect(init, line).toContain(line);
    expect(init).toContain('import("posthog-js")');
    const config = readFileSync(join(SITE, "next.config.ts"), "utf8");
    expect(config).toContain('destination: "https://eu.i.posthog.com/:path*"');
    expect(config).toContain("skipTrailingSlashRedirect: true");
    expect(readFileSync(join(SITE, "app/layout.tsx"), "utf8")).toContain("process.env.NEXT_PUBLIC_POSTHOG_KEY ? <Analytics />");
  });

  it("sends only coarse event properties: never payload values, names or handles", () => {
    const sources = ["components/site/share-card.tsx", "components/site/publish-panel.tsx", "components/site/copy-button.tsx", "app/leaderboard/page.tsx"].map((p) => readFileSync(join(SITE, p), "utf8")).join("\n");
    const calls = [...sources.matchAll(/track\(EVENTS\.\w+(?:, \{([^}]*)\})?\)|event=\{EVENTS\.\w+\} properties=\{\{([^}]*)\}\}/g)].map((m) => (m[1] ?? m[2] ?? "").trim());
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const props of calls) expect(props, props).toMatch(/^(?:|valid: readFragment\(\) != null|location: trackAs|signedIn: false|arena, page|referred: result\.referred === true)$/);
  });
});
