/** Set by next.config.ts: "/hindsight" in the Pages build, "" under `next dev`. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
export const SITE_URL = "https://hamedmp.github.io/hindsight/"
export const REPO = "https://github.com/hamedmp/hindsight"
export const NPM = "https://www.npmjs.com/package/@matrix-os/hindsight"
export const MATRIX = "https://matrix-os.com"
export const SAMPLE = `${BASE}/demo/report.html`

/** A file under public/, with the base path the export is served from. */
export const asset = (path: string) => `${BASE}/${path.replace(/^\//, "")}`
