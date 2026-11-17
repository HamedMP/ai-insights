import { AuthProvider } from "@/components/site/auth-provider"

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}
