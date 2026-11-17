"use client"

import * as React from "react"

import { BASE } from "@/lib/site"

type Clickable = React.ReactElement<{ onClick?: (event: React.MouseEvent<HTMLElement>) => void }>

/**
 * Sign in from a cached page: /account/sign-in runs the satellite sync first, so someone already signed in on Matrix OS
 * comes straight back signed in, and anyone else goes to the Matrix sign-in and returns here. The primary's sign-in page
 * would not send an already signed-in person back, and these pages skip the sync for a recently checked browser
 * (lib/auth-config.ts clerkRun). Only the path and query travel in `to`; the button's own handler runs first, and
 * keeps the fragment in the tab (lib/pending-share.ts), since a fragment must never reach a server.
 */
export function SignInHandoff({ children }: { children: Clickable }) {
  return React.cloneElement(children, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      children.props.onClick?.(event)
      window.location.assign(`${BASE}/account/sign-in?to=${encodeURIComponent(window.location.pathname + window.location.search)}`)
    },
  })
}

export const signInHandoff = (button: React.ReactElement) => <SignInHandoff>{button as Clickable}</SignInHandoff>
