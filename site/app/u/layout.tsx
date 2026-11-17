import { AuthProvider } from "@/components/site/auth-provider"

/** Profiles mount Clerk so the owner sees their own profile as the owner (account menu, referral list, remove). */
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}
