/**
 * The docs' one table of contents: the sidebar, each page's "On this page" list, previous/next links, the search
 * filter and the metadata all read it. A section id here must match an `<H2 id>` on its page (tests/site/docs.test.ts).
 * Pure TypeScript with no Next imports, so the package tests can load it; lib/docs-metadata.ts holds the Next part.
 */
export interface DocSection {
  id: string
  title: string
}

export interface DocPage {
  /** Path under /docs; "" is the docs home. */
  slug: string
  /** Sidebar and <h1> title. */
  title: string
  /** One sentence for search results, link previews and the page lede. */
  description: string
  group: DocGroup
  sections: DocSection[]
}

export type DocGroup = "Start" | "Using it" | "Reference"
export const DOC_GROUPS: DocGroup[] = ["Start", "Using it", "Reference"]

export const DOCS: DocPage[] = [
  {
    slug: "",
    title: "Overview",
    description: "What AI Insights does with your local coding-agent history, what you get from it, and where to go next.",
    group: "Start",
    sections: [
      { id: "what-you-get", title: "What you get" },
      { id: "how-it-works", title: "How it works" },
      { id: "when-not-to-use-it", title: "What it is not" },
      { id: "next", title: "Next" },
    ],
  },
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Run AI Insights with one command, read what it prints, and find the report and the files it keeps.",
    group: "Start",
    sections: [
      { id: "requirements", title: "Requirements" },
      { id: "first-run", title: "Your first run" },
      { id: "where-files-go", title: "Where files go" },
      { id: "run-it-again", title: "Run it again" },
      { id: "from-your-agent", title: "From your agent instead" },
      { id: "hindsight", title: "Formerly Hindsight" },
    ],
  },
  {
    slug: "agents",
    title: "What it reads",
    description: "Which agents AI Insights reads, where each keeps its history, what is kept from it, and how long agents keep their files.",
    group: "Start",
    sections: [
      { id: "supported-agents", title: "Supported agents" },
      { id: "locations", title: "Where each agent's history lives" },
      { id: "what-is-kept", title: "What is kept" },
      { id: "retention", title: "How long agents keep history" },
      { id: "limits", title: "Limits" },
    ],
  },
  {
    slug: "report",
    title: "The report",
    description: "The sections of the report, the findings and their thresholds, why sessions go wrong, and the exact rules behind ratios and earned titles.",
    group: "Using it",
    sections: [
      { id: "layout", title: "How the page is laid out" },
      { id: "how-it-went", title: "How it actually went" },
      { id: "findings", title: "Findings" },
      { id: "why-sessions-go-wrong", title: "Why sessions go wrong" },
      { id: "ratios", title: "Work ratios" },
      { id: "titles", title: "Earned titles" },
      { id: "persona", title: "Persona" },
      { id: "cost", title: "Cost and unpriced models" },
      { id: "over-time", title: "Since your last run" },
    ],
  },
  {
    slug: "recap-cards",
    title: "Recap cards",
    description: "The animated recap cards, their three styles and four shapes, the card studio, and exporting video and images.",
    group: "Using it",
    sections: [
      { id: "cards", title: "The cards" },
      { id: "styles-and-shapes", title: "Styles and shapes" },
      { id: "studio", title: "The card studio" },
      { id: "export", title: "Export video and images" },
      { id: "terminal-recipe", title: "Render in a terminal" },
      { id: "share-buttons", title: "Share buttons" },
      { id: "url-options", title: "Report URL options" },
    ],
  },
  {
    slug: "agent-review",
    title: "The agent review",
    description: "How your own agent adds judgement to the report through the analyze-ai-usage skill and the MCP server, and what it sees.",
    group: "Using it",
    sections: [
      { id: "two-layers", title: "Two layers" },
      { id: "install", title: "Install the plugin" },
      { id: "skills", title: "The three skills" },
      { id: "run-it", title: "Run the review" },
      { id: "what-the-model-sees", title: "What your agent sees" },
      { id: "facets", title: "Session labels" },
    ],
  },
  {
    slug: "sharing",
    title: "Sharing and the leaderboard",
    description: "Share links, publishing to the leaderboard, arenas, profiles, referrals and signing in with a Matrix OS account.",
    group: "Using it",
    sections: [
      { id: "share-links", title: "Share links" },
      { id: "publish", title: "Publish to the leaderboard" },
      { id: "arenas", title: "Arenas and ranks" },
      { id: "profiles", title: "Profiles" },
      { id: "devices", title: "Several computers" },
      { id: "referrals", title: "Referrals" },
      { id: "account", title: "Your account" },
      { id: "remove", title: "Remove your entry" },
    ],
  },
  {
    slug: "cli",
    title: "CLI reference",
    description: "Every ai-insights command, option, environment variable and exit code.",
    group: "Reference",
    sections: [
      { id: "commands", title: "Commands" },
      { id: "options", title: "Options" },
      { id: "environment", title: "Environment variables" },
      { id: "exit-codes", title: "Exit codes" },
      { id: "install-script", title: "The install script" },
    ],
  },
  {
    slug: "mcp",
    title: "MCP reference",
    description: "The seven tools the ai-insights MCP server offers your agent, with every parameter and default.",
    group: "Reference",
    sections: [
      { id: "server", title: "The server" },
      { id: "flow", title: "Typical flow" },
      { id: "ai_insights_scan", title: "ai_insights_scan" },
      { id: "ai_insights_report", title: "ai_insights_report" },
      { id: "ai_insights_sessions", title: "ai_insights_sessions" },
      { id: "ai_insights_excerpt", title: "ai_insights_excerpt" },
      { id: "ai_insights_save_facets", title: "ai_insights_save_facets" },
      { id: "ai_insights_save_narrative", title: "ai_insights_save_narrative" },
      { id: "ai_insights_render", title: "ai_insights_render" },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy",
    description: "What stays on your machine, exactly what a share link and a published profile contain, the website's analytics, and how to remove an entry.",
    group: "Reference",
    sections: [
      { id: "local-only", title: "Local only" },
      { id: "redaction", title: "Redaction" },
      { id: "share-link-contents", title: "What a share link contains" },
      { id: "published-contents", title: "What publishing makes public" },
      { id: "device-id", title: "The device id" },
      { id: "website-analytics", title: "The website's analytics" },
      { id: "removing", title: "Removing what you published" },
    ],
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting and FAQ",
    description: "Fixes for missing history, Node versions, unpriced models and missing MCP tools, and answers to common questions.",
    group: "Reference",
    sections: [
      { id: "no-sessions", title: "No agent sessions found" },
      { id: "node-version", title: "Node version problems" },
      { id: "short-history", title: "History only goes back a month" },
      { id: "unpriced", title: "Cost says some requests are unpriced" },
      { id: "no-tools", title: "The MCP tools do not appear" },
      { id: "store", title: "The store is not writable" },
      { id: "faq", title: "FAQ" },
    ],
  },
]

export const docHref = (slug: string) => (slug ? `/docs/${slug}` : "/docs")

export function docBySlug(slug: string): DocPage {
  const page = DOCS.find((doc) => doc.slug === slug)
  if (!page) throw new Error(`unknown docs page "${slug}"`)
  return page
}

/** Reading order: the sidebar's order, group by group. */
export function neighbours(slug: string): { prev: DocPage | null; next: DocPage | null } {
  const index = DOCS.findIndex((doc) => doc.slug === slug)
  return { prev: index > 0 ? DOCS[index - 1]! : null, next: index >= 0 && index < DOCS.length - 1 ? DOCS[index + 1]! : null }
}

/** The page's source file on GitHub, for "Edit this page". */
export const docSource = (slug: string) => `site/app/docs/${slug ? `${slug}/` : ""}page.tsx`
