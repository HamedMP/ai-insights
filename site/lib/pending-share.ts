const PENDING_KEY = "ai-insights:pending-share"

/** Keep the fragment across the sign-in round trip to the primary domain, which may not carry it back. */
export function rememberFragment() {
  try {
    if (window.location.hash) window.sessionStorage.setItem(PENDING_KEY, window.location.hash)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
  }
}

export function restoreFragment() {
  try {
    const pending = window.sessionStorage.getItem(PENDING_KEY)
    window.sessionStorage.removeItem(PENDING_KEY)
    if (pending && !window.location.hash && /^#[A-Za-z0-9_-]+$/.test(pending)) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${pending}`)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
  }
}

