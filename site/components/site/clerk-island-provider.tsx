"use client"

import { AuthProvider } from "@/components/site/auth-provider"

/** Imported on demand by clerk-island.tsx. No satellite auto-sync: proxy.ts runs the sync on the server when needed. */
export default function ClerkIslandProvider({ children }: { children: React.ReactNode }) {
  return <AuthProvider autoSync={false}>{children}</AuthProvider>
}
