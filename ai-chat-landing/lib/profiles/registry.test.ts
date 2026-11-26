import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Registry } from "./registry"

function tempRegistry() {
  const dir = mkdtempSync(join(tmpdir(), "profiles-"))
  return { dir, path: join(dir, "profiles.json"), registry: new Registry(join(dir, "profiles.json")) }
}

const entry = {
  oidHash: "abcdef0123456789",
  slug: "alice-chen-contoso-com",
  status: "active" as const,
  email: "alice.chen@contoso.com",
  displayName: "Alice Chen",
  winUser: "PC1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  lastError: null,
}

describe("Registry (U3–U7)", () => {
  it("reads an absent file as empty", () => {
    const { registry } = tempRegistry()
    expect(registry.list()).toEqual([])
  })

  it("writes atomically and round-trips", async () => {
    const { path, registry } = tempRegistry()
    await registry.withLock((file) => {
      file.profiles[entry.oidHash] = entry
    })
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    expect(parsed.version).toBe(1)
    expect(Object.keys(parsed.profiles)).toEqual([entry.oidHash])
    expect(readFileSync(path, "utf8")).not.toContain("API_SERVER_KEY")
  })

  it("rejects corrupt or malformed registries", () => {
    const { path, registry } = tempRegistry()
    writeFileSync(path, "{not json")
    expect(() => registry.list()).toThrowError(/registry parse/)
    writeFileSync(path, JSON.stringify({ version: 1, updatedAt: "", profiles: { bad: entry } }))
    expect(() => registry.list()).toThrowError(/registry entry/)
  })

  it("uses a lock and times out with provisioning_in_progress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "profiles-"))
    const path = join(dir, "profiles.json")
    writeFileSync(`${path}.lock`, "999")
    const registry = new Registry(path, 200)
    await expect(registry.withLock(() => 1)).rejects.toMatchObject({ code: "provisioning_in_progress" })
  })

  it("serialises concurrent writers", async () => {
    const { registry } = tempRegistry()
    await Promise.all(
      [0, 1, 2, 3, 4].map((n) =>
        registry.withLock((file) => {
          file.profiles[`000000000000000${n}`] = { ...entry, oidHash: `000000000000000${n}`, slug: `user-${n}` }
        }),
      ),
    )
    expect(registry.list()).toHaveLength(5)
  })
})
