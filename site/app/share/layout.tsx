import { AuthProvider } from "@/components/site/auth-provider"

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}
