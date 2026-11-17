import type { Metadata } from "next"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { ShareCard } from "@/components/site/share-card"

const title = "AI Insights: someone's AI coding, recapped"
const description = "A recap of AI coding-agent stats, made with AI Insights. Find out yours with npx ai-insights."

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url: "./share/", siteName: "AI Insights", type: "website", images: [{ url: "og.png", width: 1200, height: 630, alt: "AI Insights by Matrix OS" }] },
  twitter: { card: "summary_large_image", title, description, images: ["og.png"] },
}

/** Static page; the numbers live in the URL fragment and are read in the viewer's browser only. */
export default function SharePage() {
  return (
    <>
      <Header />
      <main id="top" className="relative overflow-hidden">
        <div aria-hidden className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[40rem]" />
        <ShareCard />
      </main>
      <Footer />
    </>
  )
}
