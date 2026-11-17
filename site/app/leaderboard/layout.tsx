import { Suspense } from "react"

import { BoardPageview } from "@/components/site/analytics"
import { AuthProvider } from "@/components/site/auth-provider"

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Suspense fallback={null}>
        <BoardPageview />
      </Suspense>
    </AuthProvider>
  )
}
