/** Always "" now: the site is served at the root of ai-insights.app (next.config.ts). Kept so links stay base-aware. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
export const SITE_URL = "https://ai-insights.app/"
export const REPO = "https://github.com/hamedmp/ai-insights"
export const NPM = "https://www.npmjs.com/package/ai-insights"
export const MATRIX = "https://matrix-os.com"
/** The Matrix OS app, where a Matrix account lives. */
export const MATRIX_APP = "https://app.matrix-os.com"
export const SAMPLE = `${BASE}/demo/report.html`

/** The launch hashtag. Not final: change it here and every mention on the site follows. */
export const HASHTAG = "#MyAIInsights"
/** The one command, and the skill to run it from an agent. */
export const COMMAND = "npx ai-insights"
export const SKILL = "/analyze-ai-usage"

/** A file under public/, with the base path the export is served from. */
export const asset = (path: string) => `${BASE}/${path.replace(/^\//, "")}`

/** What the site's own "tell people" links prefill. Links people click; the site itself sends nothing. */
export const SITE_POST = `AI Insights turns your local Claude Code, Codex, Cursor, OpenCode, Pi and Gemini CLI history into a recap you can post. Nothing leaves your machine.\n\n${COMMAND}\n${SITE_URL}\n${HASHTAG}`
export const intents = (text: string) => ({
  x: `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
  linkedin: `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
})
