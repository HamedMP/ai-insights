// Fails the build when the static export would load anything from another host.
// Links people click (<a href="https://...">) are fine; scripts, styles, fonts, images and frames are not.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const out = new URL("../out/", import.meta.url).pathname
const REMOTE = /^(?:https?:)?\/\//i
const TRACKERS = /\b(?:googletagmanager|google-analytics|posthog|plausible\.io|segment\.com|vercel-insights|vitals\.vercel-insights|cdn\.seline\.com|hotjar|clarity\.ms)\b/i
const problems = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else check(path)
  }
}

function check(path) {
  if (!/\.(html|css|js|txt)$/.test(path)) return
  const text = readFileSync(path, "utf8")
  const rel = path.slice(out.length)
  if (TRACKERS.test(text)) problems.push(`${rel}: mentions a tracker`)
  if (path.endsWith(".html")) {
    for (const match of text.matchAll(/<(script|link|img|source|iframe|video|audio|embed|object)\b[^>]*?\s(?:src|href|srcset|poster|data)="([^"]*)"/gi)) {
      const [, tag, url] = match
      if (tag.toLowerCase() === "link" && /rel="(?:canonical|alternate)"/.test(match[0])) continue
      if (REMOTE.test(url)) problems.push(`${rel}: <${tag}> loads ${url}`)
    }
    for (const match of text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi)) problems.push(`${rel}: CSS loads ${match[1]}`)
  }
  if (path.endsWith(".css")) {
    for (const match of text.matchAll(/(?:url\(\s*["']?|@import\s+["'])((?:https?:)?\/\/[^"')]+)/gi)) problems.push(`${rel}: CSS loads ${match[1]}`)
  }
}

walk(out)
if (problems.length) {
  console.error(`The export loads from other hosts:\n${problems.join("\n")}`)
  process.exit(1)
}
console.log("check-export: no third-party loads in out/")
