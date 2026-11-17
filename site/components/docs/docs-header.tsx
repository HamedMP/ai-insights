"use client"

import Link from "next/link"

import { Header } from "@/components/site/header"

/** The site header inside the docs: its "Docs" link switches in place, like the sidebar (lib/navigation.ts). */
export function DocsHeader() {
  return <Header docsLink={Link} />
}
