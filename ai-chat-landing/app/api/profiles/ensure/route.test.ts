import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { POST } from "./route"

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of ["PROFILES_PROVISION_TOKEN", "HERMES_TEMPLATE_PROFILE", "HERMES_PROFILES_DIR", "HERMES_REGISTRY_PATH", "HERMES_AUDIT_PATH"]) {
    saved[key] = process.env[key]
  }
  process.env.PROFILES_PROVISION_TOKEN = "tok"
  process.env.HERMES_TEMPLATE_PROFILE = "template-pc"
})
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
})

function req(body: unknown, token = "tok") {
  return new Request("http://local/api/profiles/ensure", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/profiles/ensure (U10, U14)", () => {
  it("rejects a missing or wrong token", async () => {
    const res = await POST(req({}, "wrong"))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("rejects malformed bodies", async () => {
    const res = await POST(req({ slug: "x", oid: 1 }))
    expect(res.status).toBe(422)
  })

  it("rejects a slug that does not match the identity's derived slug", async () => {
    const res = await POST(req({ slug: "evil", oid: "11111111-1111-1111-1111-111111111111", email: "a@b.com" }))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "invalid_profile_request" })
  })

  it("returns config_invalid when provisioning is not configured", async () => {
    Reflect.deleteProperty(process.env, "PROFILES_PROVISION_TOKEN")
    const res = await POST(req({}))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "config_invalid" })
  })
})
