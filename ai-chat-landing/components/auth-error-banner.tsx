"use client"

import * as React from "react"

import { authErrorMessage } from "@/lib/auth/error-messages"

export function AuthErrorBanner() {
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get("auth_error")
    queueMicrotask(() => setMessage(authErrorMessage(code)))
    if (code) {
      url.searchParams.delete("auth_error")
      window.history.replaceState({}, "", url)
    }
  }, [])

  if (!message) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-sm"
    >
      <span>{message}</span>
      <button
        type="button"
        className="ml-auto text-xs underline underline-offset-2"
        onClick={() => setMessage(null)}
      >
        Dismiss
      </button>
    </div>
  )
}
