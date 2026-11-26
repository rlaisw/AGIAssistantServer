import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { listProfiles, rotateProfile, setProfileStatus, waitForOldKeyRejected } from "../../scripts/profiles-cli.mjs"

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "operator-"))
  const profilesDir = join(dir, "profiles")
  const home = join(profilesDir, "alice-chen-contoso-com")
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, ".env"), "OTHER=1\nAPI_SERVER_KEY=OLD_KEY\n", { mode: 0o600 })
  const registry = join(dir, "profiles.json")
  writeFileSync(
    registry,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      profiles: {
        abcdef0123456789: {
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
        },
      },
    }),
  )
  return { profilesDir, registry, audit: join(dir, "audit.jsonl"), dir }
}

describe("operator CLI (U15–U17, U22)", () => {
  it("rotates the key without printing or storing it in the registry", () => {
    const p = setup()
    const before = readFileSync(join(p.profilesDir, "alice-chen-contoso-com", ".env"), "utf8")
    rotateProfile("alice-chen-contoso-com", p)
    const after = readFileSync(join(p.profilesDir, "alice-chen-contoso-com", ".env"), "utf8")
    expect(after).not.toContain("OLD_KEY")
    expect(after).toContain("API_SERVER_KEY=")
    expect(after).not.toBe(before)
    expect(readFileSync(p.registry, "utf8")).not.toContain("API_SERVER_KEY")
    expect(readFileSync(p.audit, "utf8")).toContain('"event":"rotate"')
  })

  it("disables by replacing the key and enabling restores an active status", () => {
    const p = setup()
    const disabled = setProfileStatus("alice-chen-contoso-com", "disabled", p)
    expect(disabled.status).toBe("disabled")
    const oldKey = readFileSync(join(p.profilesDir, "alice-chen-contoso-com", ".env"), "utf8")
    expect(oldKey).not.toContain("OLD_KEY")
    const enabled = setProfileStatus("alice-chen-contoso-com", "active", p)
    expect(enabled.status).toBe("active")
    const rows = listProfiles(p)
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).sort()).toEqual(["createdAt", "lastSeenAt", "slug", "status"])
  })
})

describe("operator lock (T061)", () => {
  it("refuses a mutation while another writer holds the registry lock", () => {
    const p = setup()
    writeFileSync(`${p.registry}.lock`, "999")
    expect(() => rotateProfile("alice-chen-contoso-com", p, 50)).toThrowError(/provisioning_in_progress/)
  })
})

describe("rotation latency (T046 / US3 AC2)", () => {
  it("polls until the old key is refused", async () => {
    const seen = []
    const fetchImpl = async () => {
      seen.push(1)
      return new Response(null, { status: seen.length < 3 ? 200 : 401 })
    }
    const ok = await waitForOldKeyRejected({
      slug: "alice-chen-contoso-com",
      oldKey: "OLD",
      gatewayUrl: "http://gateway.test",
      fetchImpl,
      intervalMs: 1,
      timeoutMs: 1000,
    })
    expect(ok).toBe(true)
    expect(seen.length).toBe(3)
  })
})
