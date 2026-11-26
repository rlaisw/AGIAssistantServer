// @vitest-environment jsdom
// Spec 050 analyze C1: the header auth control's three observable states,
// asserted in CI without a browser (jsdom + react-dom/client).
import { describe, it, expect, vi, afterEach } from "vitest"
import * as React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { AuthControl } from "./auth-control"

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function renderAuth(session: unknown): Promise<HTMLElement> {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => session })))
  const container = document.createElement("div")
  document.body.appendChild(container)
  let root: Root | undefined
  await act(async () => {
    root = createRoot(container)
    root.render(React.createElement(AuthControl))
  })
  return container
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("AuthControl (spec 050 US1 header states)", () => {
  it("renders the Sign in control for an anonymous session", async () => {
    const container = await renderAuth({ authenticated: false })
    const text = container.textContent ?? ""
    expect(text).toContain("Sign in")
    expect(text).not.toContain("Sign out")
  })

  it("renders the display name and Sign out for an authenticated session", async () => {
    const container = await renderAuth({
      authenticated: true,
      user: { displayName: "Peter Chan", email: "peter.chan@tvb.com.hk" },
    })
    const text = container.textContent ?? ""
    expect(text).toContain("Peter Chan")
    expect(text).toContain("Sign out")
    expect(text).not.toContain("Sign in")
  })

  it("renders nothing while the session fetch is in flight", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(React.createElement(AuthControl))
    })
    expect(container.textContent).toBe("")
  })
})
