import type { Metadata } from "next"

import { Footer } from "@/components/site/footer"
import { Header } from "@/components/site/header"
import { SignInHandoff } from "@/components/site/sign-in-handoff"
import { returnPath } from "@/lib/session-hint"

export const metadata: Metadata = { title: "Sign in · AI Insights", robots: { index: false } }

/**
 * Where the header's "Sign in" link goes from pages that do not mount Clerk. Clerk runs here: someone already signed in
 * on Matrix OS is recognised by the satellite sync and sent straight back; anyone else goes to the Matrix sign-in page
 * and returns here, then back to the page they came from (a same-site path only).
 */
export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const to = returnPath(Array.isArray(params.to) ? params.to[0] : params.to)
  return (
    <>
      <Header account={<span />} />
      <main id="top" className="mx-auto flex min-h-[50vh] max-w-6xl flex-col items-start justify-center gap-3 px-4 py-16 md:px-8">
        <SignInHandoff to={to} />
      </main>
      <Footer />
    </>
  )
}
