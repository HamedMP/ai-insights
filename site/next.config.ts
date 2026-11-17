import type { NextConfig } from "next"

// A normal Next.js deployment on Vercel at the root of ai-insights.app (route handlers need a server).
// The old GitHub Pages address is a static redirect site in pages-redirect/, not a build of this app.
const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BASE_PATH: "" },
  // PostHog goes through ai-insights.app itself (first party, EU hosts), so pages never contact a third-party host.
  // Next must not 308 PostHog's /e/ and /flags/ style paths; proxy.ts does the trailing-slash redirect for pages instead.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/relay/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/relay/array/:path*", destination: "https://eu-assets.i.posthog.com/array/:path*" },
      { source: "/relay/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ]
  },
}

export default nextConfig
