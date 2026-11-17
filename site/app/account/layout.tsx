import { AuthProvider } from "@/components/site/auth-provider"

/** /account/sign-in mounts Clerk so the landing page's quiet "Sign in" link can run the satellite sign-in here, not there. */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}
