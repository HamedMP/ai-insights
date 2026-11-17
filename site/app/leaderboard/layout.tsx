import { Suspense } from "react"

import { BoardPageview } from "@/components/site/analytics"
import { AuthProvider } from "@/components/site/auth-provider"

// No client-side satellite sync: proxy.ts runs it on the server when a browser needs it (lib/auth-config.ts clerkRun),
// so clerk-js never reloads a cached page to sync it again.
export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider autoSync={false}>
      {children}
      <Suspense fallback={null}>
        <BoardPageview />
      </Suspense>
    </AuthProvider>
  )
}
