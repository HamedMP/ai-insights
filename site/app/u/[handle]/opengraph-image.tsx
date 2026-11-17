import { ImageResponse } from "next/og"

import { agentName, formatCompact, formatInt, formatPeriod } from "@/lib/share"

import { loadProfile } from "./data"

export const alt = "An AI Insights recap card"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const COLORS = ["#ff6a1a", "#f3f0e8", "#bed77b", "#8ab4ff", "#f7c948", "#d08cff", "#7ce0c3", "#ff9db0"]

/** The personalized preview for X, LinkedIn, WhatsApp and Instagram link cards. Text only, from validated columns. */
export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const entry = await loadProfile(handle)
  const s = entry && entry !== "error" ? entry.stats : null
  const name = entry && entry !== "error" ? entry.displayName : "Someone"
  const stats: Array<[string, string]> = []
  if (s) {
    stats.push(["tokens", formatCompact(s.tokens)], ["sessions", formatInt(s.sessions)], ["longest streak", `${formatInt(s.streak)} ${s.streak === 1 ? "day" : "days"}`])
    if (s.usd !== null) stats.push(["estimated spend", `$${formatInt(s.usd)}`])
  }
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#17140f", color: "#f3f0e8" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "rgba(243,240,232,0.6)", letterSpacing: 2 }}>
          <span>AI INSIGHTS</span>
          <span>{s ? formatPeriod(s.from, s.to) : ""}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05 }}>
            <span>{`${name}’s `}</span>
            <span style={{ color: "#ff6a1a" }}>AI Insights</span>
          </div>
          <div style={{ display: "flex", gap: 56 }}>
            {stats.map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 60, fontWeight: 700 }}>{value}</span>
                <span style={{ fontSize: 22, color: "rgba(243,240,232,0.55)", textTransform: "uppercase" }}>{label}</span>
              </div>
            ))}
          </div>
          {s && s.agents.length > 0 ? (
            <div style={{ display: "flex", gap: 24, fontSize: 26, color: "rgba(243,240,232,0.8)" }}>
              {s.agents.slice(0, 4).map((a, i) => (
                <div key={`${a.k}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 8, background: COLORS[i % COLORS.length] }} />
                  <span>{`${agentName(a.k)} ${a.p}%`}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30 }}>
          <span>Find out yours: npx ai-insights</span>
          <span style={{ color: "#ff6a1a" }}>ai-insights.app</span>
        </div>
      </div>
    ),
    size,
  )
}
