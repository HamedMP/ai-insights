import { agentName, CARD_TITLES, EARNED_TITLES, formatInt, formatPeriod, RATIOS, ratioText, tokensMeasured, type SharedStats } from "./share.ts"

/** The choices on the publish form that change what becomes public. */
export interface PublishChoices {
  /** The name the profile will show (displayNameFor). */
  name: string
  /** The checked handle, or null while the typed one is not valid. */
  handle: string | null
  showAvatar: boolean
  showDeviceName: boolean
}

/**
 * Every line that becomes public on Publish, in order, made only from the validated payload and the form's choices.
 * The panel's disclosure renders exactly these; it is a promise to the person, so nothing published may be missing.
 */
export function publishedLines(stats: SharedStats, choices: PublishChoices): Array<[string, string]> {
  const device = stats.device
  return [
    ["Name", choices.name],
    ...(device ? [["This computer", device.name && choices.showDeviceName ? device.name : `shown as “Device 1”, “Device 2”…${device.name ? " (its name stays private)" : ""}`] as [string, string]] : []),
    ["Photo", choices.showAvatar ? "your Matrix account photo, if you uploaded one" : "not shown (initials instead)"],
    ["Profile", `ai-insights.app/u/${choices.handle ?? "…"}`],
    ["Period", formatPeriod(stats.from, stats.to)],
    ["Sessions", formatInt(stats.sessions)],
    ["Tokens", tokensMeasured(stats) ? formatInt(stats.tokens) : "not measured (chat export only; not ranked by tokens or spend)"],
    ["Estimated spend", stats.usd === null ? "not shown" : `$${formatInt(stats.usd)}`],
    ["Active days", formatInt(stats.activeDays)],
    ["Longest streak", `${formatInt(stats.streak)} days`],
    ["Agents", stats.agents.length ? stats.agents.map((a) => `${agentName(a.k)} ${a.p}%`).join(", ") : "none"],
    ["Fun fact", stats.fact || "none"],
    ...(stats.titles ?? []).map((t): [string, string] => [`Title: ${EARNED_TITLES[t.k].title}`, EARNED_TITLES[t.k].rule(t.v)]),
    ...(stats.ratios?.length ? [["Ratios", stats.ratios.map((r) => `${RATIOS[r.k].label} ${ratioText(r.k, r.v)}`).join(", ")] as [string, string]] : []),
    ...(stats.cards ?? []).map((c): [string, string] => [`Card: ${CARD_TITLES[c.k]}`, c.c ? `${c.b}, ${c.c}` : c.b]),
  ]
}

/** What is sent but never shown, and what a publish does, as short sentences under the disclosure's table. */
export function storedNotes(stats: SharedStats, isKnownDevice: boolean): string[] {
  const notes = ["Nothing else is sent: no projects, prompts or history.", "The numbers are self-reported from your own report and are not verified."]
  if (!stats.cards) notes.push("This link is from an older report, so your profile will show these numbers without recap cards. Run the command again for a link with cards.")
  if (!stats.device) {
    notes.push("This link has no device id (an older report), so it replaces your earlier publish from an older report.", "You can remove it any time.")
    return notes
  }
  notes.push("Also stored, never shown: this computer's random id. AI Insights made it; it does not come from the computer's name or hardware. Publishing again from this computer replaces only its numbers.")
  if (stats.days) notes.push("Also stored, never shown: which days this computer was active (dates only, no counts or times), so streaks can be combined across computers.")
  notes.push(isKnownDevice ? "This computer is already on your profile: this publish replaces its numbers." : "Your profile adds up every computer you publish from.", "You can remove a computer, or everything, any time.")
  return notes
}
