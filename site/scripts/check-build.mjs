// Fails the build when a page would load anything from another host.
// Links people click (<a href="https://...">) are fine; scripts, styles, fonts, images and frames are not, with one
// exception: when Clerk is configured, pages with sign-in may load clerk-js and @clerk/ui (script + preload link)
// under /npm/@clerk/ from the Clerk Frontend API host(s) for
// this app (decoded from the publishable key, plus clerk.<satellite domain>). Nothing else.
//
//   node scripts/check-build.mjs             checks the Next build (.next/server/app HTML, .next/static CSS and JS)
//   node scripts/check-build.mjs --redirect  checks the GitHub Pages redirect site in pages-redirect/
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const site = new URL("../", import.meta.url).pathname
const redirect = process.argv.includes("--redirect")
const roots = redirect ? [join(site, "pages-redirect")] : [join(site, ".next/server/app"), join(site, ".next/static")]
const REMOTE = /^(?:https?:)?\/\//i
const TRACKERS = /\b(?:googletagmanager|google-analytics|posthog|plausible\.io|segment\.com|vercel-insights|vitals\.vercel-insights|cdn\.seline\.com|hotjar|clarity\.ms)\b/i

/** Same rule as lib/auth-config.ts clerkHosts(). */
function clerkHosts() {
  const hosts = new Set()
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? ""
  const encoded = /^pk_(?:test|live)_(.+)$/.exec(key)?.[1]
  if (encoded) {
    const host = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").replace(/\$$/, "")
    if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) hosts.add(host.toLowerCase())
  }
  const domain = process.env.NEXT_PUBLIC_CLERK_IS_SATELLITE === "true" ? (process.env.NEXT_PUBLIC_CLERK_DOMAIN ?? "") : ""
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) hosts.add(`clerk.${domain.toLowerCase()}`)
  return hosts
}
const allowedScriptHosts = redirect ? new Set() : clerkHosts()
const problems = []

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else check(path)
  }
}

function allowed(tag, url) {
  if (!["script", "link"].includes(tag.toLowerCase())) return false
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url)
    return u.protocol === "https:" && allowedScriptHosts.has(u.hostname) && u.pathname.startsWith("/npm/@clerk/")
  } catch {
    return false
  }
}

function check(path) {
  if (!/\.(html|css|js|txt)$/.test(path)) return
  const text = readFileSync(path, "utf8")
  const rel = path.slice(site.length)
  if (TRACKERS.test(text)) problems.push(`${rel}: mentions a tracker`)
  if (path.endsWith(".html")) {
    for (const match of text.matchAll(/<(script|link|img|source|iframe|video|audio|embed|object)\b[^>]*?\s(?:src|href|srcset|poster|data)="([^"]*)"/gi)) {
      const [, tag, url] = match
      if (tag.toLowerCase() === "link" && /rel="(?:canonical|alternate)"/.test(match[0])) continue
      if (REMOTE.test(url) && !allowed(tag, url)) problems.push(`${rel}: <${tag}> loads ${url}`)
    }
    for (const match of text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')]+)/gi)) problems.push(`${rel}: CSS loads ${match[1]}`)
  }
  if (path.endsWith(".css")) {
    for (const match of text.matchAll(/(?:url\(\s*["']?|@import\s+["'])((?:https?:)?\/\/[^"')]+)/gi)) problems.push(`${rel}: CSS loads ${match[1]}`)
  }
}

for (const root of roots) {
  if (!existsSync(root)) {
    console.error(`check-build: ${root.slice(site.length)} is missing; run the build first`)
    process.exit(1)
  }
  walk(root)
}
if (problems.length) {
  console.error(`The build loads from other hosts:\n${problems.join("\n")}`)
  process.exit(1)
}
console.log(`check-build: no third-party loads in ${redirect ? "pages-redirect/" : ".next/"}${allowedScriptHosts.size ? ` (clerk-js allowed from ${[...allowedScriptHosts].join(", ")})` : ""}`)
