import type { NextConfig } from "next"

// The site is served at the root of ai-insights.app. The GitHub Pages build sets PAGES_BASE_PATH=/ai-insights so older links keep working.
const basePath = process.env.NODE_ENV === "production" ? (process.env.PAGES_BASE_PATH ?? "") : ""

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
}

export default nextConfig
