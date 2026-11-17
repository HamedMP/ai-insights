import type { NextConfig } from "next"

// A normal Next.js deployment on Vercel at the root of ai-insights.app (route handlers need a server).
// The old GitHub Pages address is a static redirect site in pages-redirect/, not a build of this app.
const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BASE_PATH: "" },
}

export default nextConfig
