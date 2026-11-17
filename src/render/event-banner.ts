/**
 * Temporary: a band above the report promoting the Slush AI Breakfast Club (Thu 19 Nov 2026, Helsinki).
 * Delete this file, client/event-banner.js, client/event-banner.css, tests/render/event-banner.test.ts and
 * their few lines in index.ts and assets.ts once the breakfast has started.
 *
 * The markup ships hidden. client/event-banner.js reveals it only while the cutoff is still ahead when the
 * report is opened, so a report made today and reopened after the event shows nothing and nothing moves.
 */

/** 08:00 Helsinki (EET, UTC+2) on Thursday 19 November 2026, when the breakfast starts. The only copy. */
export const EVENT_BANNER_UNTIL = Date.UTC(2026, 10, 19, 6, 0, 0);

const REGISTER = "https://luma.com/4yb5xhzs";

/**
 * The banner's HTML, or "" once the cutoff has passed or when the report has no recap (no share box to
 * publish from). `#share-stats` is the share box the deck's own Publish button links to.
 */
export function eventBanner(hasRecap: boolean, now: number = Date.now()): string {
  if (!hasRecap || now >= EVENT_BANNER_UNTIL) return "";
  return `<aside id="event-banner" class="event-banner" aria-label="Slush AI Breakfast Club" data-until="${EVENT_BANNER_UNTIL}" hidden><div class="wrap">`
    + `<p class="event-banner-text"><b>Slush AI Breakfast Club · Thu 19 Nov, 8:00–10:00, Helsinki</b> <span>Publish to the leaderboard and register. We&#39;re sending breakfast invites to people on the leaderboard.</span></p>`
    + `<div class="event-banner-actions"><a class="btn primary" href="#share-stats">Publish to the leaderboard</a><a class="btn" href="${REGISTER}" target="_blank" rel="noopener noreferrer">Register for the breakfast</a></div>`
    + `</div></aside>`;
}
