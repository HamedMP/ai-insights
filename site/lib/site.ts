/** Set by next.config.ts: "/ai-insights" in the Pages build, "" under `next dev`. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
export const SITE_URL = "https://hamedmp.github.io/ai-insights/"
export const REPO = "https://github.com/hamedmp/ai-insights"
export const NPM = "https://www.npmjs.com/package/ai-insights"
export const MATRIX = "https://matrix-os.com"
export const SAMPLE = `${BASE}/demo/report.html`

/** A file under public/, with the base path the export is served from. */
export const asset = (path: string) => `${BASE}/${path.replace(/^\//, "")}`
