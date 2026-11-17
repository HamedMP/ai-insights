import type { Metadata } from "next"

import { docBySlug, docHref } from "./docs.ts"
import { SITE_URL } from "./site.ts"

/** Title, description, canonical URL and link-preview tags for one docs page. */
export function docMetadata(slug: string): Metadata {
  const page = docBySlug(slug)
  const title = slug ? `${page.title} · AI Insights docs` : "AI Insights docs"
  const url = new URL(docHref(slug).slice(1), SITE_URL).toString()
  const image = { url: "og.png", width: 1200, height: 630, alt: "AI Insights by Matrix OS" }
  return {
    title,
    description: page.description,
    alternates: { canonical: url },
    openGraph: { title, description: page.description, url, siteName: "AI Insights", type: "article", images: [image] },
    twitter: { card: "summary_large_image", title, description: page.description, images: [image.url] },
  }
}
