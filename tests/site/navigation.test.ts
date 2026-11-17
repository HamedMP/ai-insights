import { describe, expect, it } from "vitest";
import { mountsClerk } from "../../site/lib/auth-config.ts";
import { DOCS, docHref, docSlugFromPath } from "../../site/lib/docs.ts";
import { clientNavigable } from "../../site/lib/navigation.ts";

describe("which links switch pages without a full load", () => {
  it("moves between docs pages in place, so the docs feel instant", () => {
    for (const from of DOCS) {
      for (const to of DOCS) expect(clientNavigable(docHref(to.slug), docHref(from.slug)), `${from.slug} -> ${to.slug}`).toBe(true);
    }
    expect(clientNavigable("/docs/agents#locations", "/docs/import")).toBe(true);
  });

  it("fully loads every page that mounts Clerk, so it gets the policy that lets Clerk run", () => {
    for (const to of ["/leaderboard", "/leaderboard?arena=codex", "/share", "/share#abc", "/u/ada", "/u/ada?ref=ada", "/account/sign-in"]) {
      expect(mountsClerk(to.split(/[?#]/)[0]!), to).toBe(true);
      expect(clientNavigable(to, "/docs/sharing"), to).toBe(false);
      expect(clientNavigable(to, "/"), to).toBe(false);
    }
  });

  it("fully loads the docs from a page that mounts Clerk, so the docs do not keep Clerk's looser policy", () => {
    for (const from of ["/leaderboard", "/share", "/u/ada", "/account/sign-in"]) expect(clientNavigable("/docs", from), from).toBe(false);
  });

  it("leaves files, API routes and other sites to the browser", () => {
    for (const to of ["/demo/report.html", "/api/leaderboard/me", "/relay/e/", "//evil.example/docs", "https://github.com/x", "mailto:a@b.c", "#top", "/docs/nope/deeper"]) {
      expect(clientNavigable(to, "/docs"), to).toBe(false);
    }
  });
});

describe("the docs sidebar's current page", () => {
  it("follows the address, with or without a trailing slash", () => {
    expect(docSlugFromPath("/docs")).toBe("");
    expect(docSlugFromPath("/docs/")).toBe("");
    expect(docSlugFromPath("/docs/import")).toBe("import");
    expect(docSlugFromPath("/docs/import/")).toBe("import");
    expect(docSlugFromPath("/docs/unknown")).toBeNull();
    expect(docSlugFromPath("/leaderboard")).toBeNull();
  });
});
