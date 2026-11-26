import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Registry } from "@/lib/profiles/registry"
import { GET } from "./route"

const saved: Record<string, string | undefined> = {}
let registryPath = ""
beforeEach(async () => {
  for (const key of ["PROFILES_PROVISION_TOKEN", "HERMES_TEMPLATE_PROFILE", "HERMES_REGISTRY_PATH"]) {
    saved[key] = process.env[key]
  }
  const dir = mkdtempSync(join(tmpdir(), "status-"))
  registryPath = join(dir, "profiles.json")
  process.env.PROFILES_PROVISION_TOKEN = "tok"
  process.env.HERMES_TEMPLATE_PROFILE = "template-pc"
  process.env.HERMES_REGISTRY_PATH = registryPath
  const registry = new Registry(registryPath)
  await registry.withLock((file) => {
    file.profiles["abcdef0123456789"] = {
      oidHash: "abcdef0123456789",
      slug: "alice-chen-contoso-com",
      status: "active",
      email: "alice.chen@contoso.com",
      displayName: "Alice Chen",
      winUser: "PC1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastError: null,
    }
  })
})
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
  }
})

function req(slug: string, token = "tok") {
  return new Request(`http://local/api/profiles/status?slug=${slug}`, { headers: { authorization: `Bearer ${token}` } })
}

describe("GET /api/profiles/status (U14)", () => {
  it("returns status without secrets", async () => {
    const res = await GET(req("alice-chen-contoso-com"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ slug: "alice-chen-contoso-com", status: "active" })
    expect(JSON.stringify(body)).not.toMatch(/API_SERVER_KEY|oid\b|email/)
  })

  it("returns 404 for an unknown slug and 401 for a bad token", async () => {
    expect((await GET(req("nobody"))).status).toBe(404)
    expect((await GET(req("alice-chen-contoso-com", "bad"))).status).toBe(401)
  })
})
