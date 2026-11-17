import { AuthProvider } from "@/components/site/auth-provider"

/**
 * Profiles mount Clerk so the owner sees their own profile as the owner (account menu, referral list, remove). No
 * client-side satellite sync: proxy.ts runs it on the server when a browser needs it (lib/auth-config.ts clerkRun).
 */
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider autoSync={false}>{children}</AuthProvider>
}
