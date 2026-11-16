import type { NextConfig } from "next"

// GitHub Pages serves the project site from /hindsight; `next dev` runs at the root.
const basePath = process.env.NODE_ENV === "production" ? (process.env.PAGES_BASE_PATH ?? "/hindsight") : ""

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
}

export default nextConfig
