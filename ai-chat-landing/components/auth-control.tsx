"use client"

import * as React from "react"
import { LogIn, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { resolveControlState, type ControlState } from "@/lib/auth/control-state"
import { markSignedOut, signInUrl } from "@/lib/auth/signin-url"

export function AuthControl() {
  const [state, setState] = React.useState<ControlState | null>(null)

  React.useEffect(() => {
    let alive = true
    fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (alive) setState(resolveControlState(data))
      })
      .catch(() => {
        if (alive) setState({ status: "anonymous" })
      })
    return () => {
      alive = false
    }
  }, [])

  React.useEffect(() => {
    if (state?.status !== "authenticated") return
    // FR-010: keep the server-side renewal path reachable while the tab is in
    // active use; /api/auth/session renews within five minutes of access-token
    // expiry. Hidden tabs are skipped (no background token refresh).
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      fetch("/api/auth/session", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => setState(resolveControlState(data)))
        .catch(() => undefined)
    }, 10 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [state?.status])

  if (!state) return null

  if (state.status === "anonymous") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // full navigation: this is the API redirect endpoint, not a Next page
          window.location.href = signInUrl(window.sessionStorage)
        }}
      >
        <LogIn />
        Sign in
      </Button>
    )
  }

  const signOut = async () => {
    const res = await fetch("/api/auth/signout", { method: "POST" })
    const data = (await res.json().catch(() => null)) as { endSessionUrl?: string } | null
    markSignedOut(window.sessionStorage)
    // endSessionUrl is the tenant logout page (external); "/" is the local fallback
    window.location.href = data?.endSessionUrl ?? "/"
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline">
        {state.displayName}
      </span>
      <Button variant="ghost" size="sm" onClick={signOut}>
        <LogOut />
        Sign out
      </Button>
    </div>
  )
}
