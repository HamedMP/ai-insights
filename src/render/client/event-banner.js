/* event-banner.js: temporary, the Slush AI Breakfast Club band (src/render/event-banner.ts). The markup ships
   hidden; show it only while its cutoff is still ahead when the report is opened. An unreadable cutoff keeps it
   hidden. Delete with event-banner.ts once the breakfast has started. */
(() => {
  const el = document.getElementById("event-banner");
  if (!el) return;
  const until = Number(el.dataset.until);
  if (until > 0 && Date.now() < until) el.hidden = false;
})();
