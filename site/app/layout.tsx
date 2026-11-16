import type { Metadata, Viewport } from "next"
import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SITE_URL } from "@/lib/site"
import { cn } from "@/lib/utils"

const title = "AI Insights: your AI coding, recapped"
const description =
  "One command turns your local Claude Code, Codex, Cursor, OpenCode, Pi and Gemini CLI history into animated recap cards you can post, and a private analysis of what to change. Nothing leaves your machine."
const image = { url: "og.png", width: 1200, height: 630, alt: "AI Insights by Matrix OS: recap cards in three styles, made from your local agent history with npx ai-insights." }

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title,
  description,
  applicationName: "AI Insights",
  openGraph: { title, description, url: "./", siteName: "AI Insights", type: "website", images: [image] },
  twitter: { card: "summary_large_image", title, description, images: [image] },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(GeistSans.variable, GeistMono.variable)}>
      <head>
        {/* lets CSS hold scroll reveals back only when script is running to release them */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
