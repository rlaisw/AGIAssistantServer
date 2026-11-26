// @vitest-environment jsdom
// Spec 050 E4 regression: the auth error banner must survive React StrictMode's
// double-mounted effect (the second run sees the stripped URL and used to erase
// the message it just set) and must strip the ?auth_error param after reading it.
import { describe, it, expect, afterEach } from "vitest"
import * as React from "react"
import { createRoot } from "react-dom/client"
import { act } from "react"
import { AuthErrorBanner } from "./auth-error-banner"

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function renderBanner(strict: boolean) {
  window.history.replaceState({}, "", "/?auth_error=signin_cancelled")
  const container = document.createElement("div")
  document.body.appendChild(container)
  const element = strict
    ? React.createElement(React.StrictMode, null, React.createElement(AuthErrorBanner))
    : React.createElement(AuthErrorBanner)
  await act(async () => {
    createRoot(container).render(element)
  })
  await act(async () => {
    await Promise.resolve()
  })
  return container
}

afterEach(() => {
  window.history.replaceState({}, "", "/")
  document.body.replaceChildren()
})

describe("AuthErrorBanner (spec 050 E4 honest banner)", () => {
  it("renders the message for ?auth_error and strips the param", async () => {
    const container = await renderBanner(false)
    expect(container.textContent).toContain("Sign-in was cancelled.")
    expect(window.location.search).toBe("")
  })

  it("keeps the message under StrictMode double-mount", async () => {
    const container = await renderBanner(true)
    expect(container.textContent).toContain("Sign-in was cancelled.")
    expect(window.location.search).toBe("")
  })
})