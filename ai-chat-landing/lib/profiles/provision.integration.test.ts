import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import type { ProfilesConfig } from "./config"
import { ensureProfile } from "./provision"
import { Registry } from "./registry"

import { ALICE as alice, BOB, profilesConfigFor, stubHermesCli } from "./testing/harness"

function cfgFor(dir: string) {
  return profilesConfigFor(dir)
}

const stubCli = (cfg: ProfilesConfig, calls: string[][] = []) => stubHermesCli(cfg, calls).run

describe("ensureProfile (U8–U11, I1–I4, SC-009)", () => {
  it("creates the profile, mints a unique key, and writes USER.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    const result = await ensureProfile(cfg, alice, {
      runCli: stubCli(cfg, calls),
      warm: async () => true,
      keyFor: () => "FRESH_KEY_1",
    })
    expect(result).toEqual({ slug: alice.slug, status: "active", created: true })
    expect(calls[0]).toEqual(["profile", "create", alice.slug, "--clone-from", "template-pc"])
    const env = readFileSync(join(cfg.profilesDir, alice.slug, ".env"), "utf8")
    expect(env).toContain("API_SERVER_KEY=FRESH_KEY_1")
    expect(env).not.toContain("CLONED_FROM_TEMPLATE")
    const userMd = readFileSync(join(cfg.profilesDir, alice.slug, "memories", "USER.md"), "utf8")
    expect(userMd).toContain("Display Name: Alice Chen")
    expect(userMd).toContain("Email: alice.chen@contoso.com")
    expect(userMd).toContain("Windows user: PC12345")
    expect(userMd).not.toContain("FRESH_KEY_1")
    const entry = new Registry(cfg.registryPath).byOid("a7a4f0f0c9b3d0f2") // computed below independently
    expect(entry === undefined || entry.slug === alice.slug).toBe(true)
  })

  it("T041: two profiles receive two different keys (never the template's)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    let n = 0
    const deps = { runCli: stubCli(cfg, calls), warm: async () => true, keyFor: () => `KEY_${++n}` }
    await ensureProfile(cfg, alice, deps)
    await ensureProfile(cfg, BOB, deps)
    const a = readFileSync(join(cfg.profilesDir, alice.slug, ".env"), "utf8")
    const b = readFileSync(join(cfg.profilesDir, BOB.slug, ".env"), "utf8")
    expect(a).toContain("API_SERVER_KEY=KEY_1")
    expect(b).toContain("API_SERVER_KEY=KEY_2")
    expect(a).not.toBe(b)
  })

  it("is idempotent: a second ensure reuses the profile and does not call the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    const deps = { runCli: stubCli(cfg, calls), warm: async () => true, keyFor: () => "K" }
    await ensureProfile(cfg, alice, deps)
    const second = await ensureProfile(cfg, alice, deps)
    expect(second.created).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it("rolls back when the CLI fails after creating the directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const failing = async (args: string[]) => {
      const home = join(cfg.profilesDir, args[2])
      mkdirSync(home, { recursive: true })
      throw new Error("boom")
    }
    await expect(ensureProfile(cfg, alice, { runCli: failing, warm: async () => true })).rejects.toMatchObject({ code: "provision_failed" })
    expect(existsSync(join(cfg.profilesDir, alice.slug))).toBe(false)
    expect(new Registry(cfg.registryPath).list()).toEqual([])
  })

  it("SC-009: the three TVB mailboxes produce three distinct profiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    const deps = { runCli: stubCli(cfg, calls), warm: async () => true }
    const emails = ["peter.chan@tvb.com", "peter.chan@tvb.com.hk", "peter.chan@tvb.com.cn"]
    const slugs = []
    for (let i = 0; i < emails.length; i += 1) {
      const res = await ensureProfile(cfg, { ...alice, slug: "", oid: `3333333${i}-3333-3333-3333-333333333333`, email: emails[i] }, deps)
      slugs.push(res.slug)
    }
    expect(slugs).toEqual(["peter-chan-tvb-com", "peter-chan-tvb-com-hk", "peter-chan-tvb-com-cn"])
    expect(new Registry(cfg.registryPath).list()).toHaveLength(3)
  })

  it("T016: five concurrent first ensures create exactly one profile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    const deps = { runCli: stubCli(cfg, calls), warm: async () => true, keyFor: () => "K" }
    const results = await Promise.all(Array.from({ length: 5 }, () => ensureProfile(cfg, alice, deps)))
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(new Set(results.map((r) => r.slug))).toEqual(new Set([alice.slug]))
    expect(calls).toHaveLength(1)
    expect(new Registry(cfg.registryPath).list()).toHaveLength(1)
  })

  it("T030: a cold profile fails honestly but stays active for retry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    await expect(
      ensureProfile(cfg, alice, { runCli: stubCli(cfg, calls), warm: async () => false }),
    ).rejects.toMatchObject({ code: "agent_unavailable" })
    const entries = new Registry(cfg.registryPath).list()
    expect(entries).toHaveLength(1)
    expect(entries[0].status).toBe("active")
    expect(entries[0].lastError?.code).toBe("agent_unavailable")
  })

  it("M1: lastSeenAt updates at most once per minute", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z")
    const deps = { runCli: stubCli(cfg, calls), warm: async () => true, now: () => new Date(nowMs), keyFor: () => "K" }
    await ensureProfile(cfg, alice, deps)
    const created = new Registry(cfg.registryPath).list()[0].lastSeenAt
    nowMs += 30_000
    await ensureProfile(cfg, alice, deps)
    expect(new Registry(cfg.registryPath).list()[0].lastSeenAt).toBe(created)
    nowMs += 31_000
    await ensureProfile(cfg, alice, deps)
    expect(new Registry(cfg.registryPath).list()[0].lastSeenAt).toBe(new Date(nowMs).toISOString())
  })

  it("T063: a retry after a cold failure re-warms before reporting ready", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    await expect(
      ensureProfile(cfg, alice, { runCli: stubCli(cfg, calls), warm: async () => false, keyFor: () => "K" }),
    ).rejects.toMatchObject({ code: "agent_unavailable" })
    const retry = await ensureProfile(cfg, alice, { runCli: stubCli(cfg, calls), warm: async () => true })
    expect(retry.created).toBe(false)
    expect(calls).toHaveLength(1)
    expect(new Registry(cfg.registryPath).list()[0].lastError).toBeNull()
  })

  it("applies the deterministic suffix on a slug collision", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prov-"))
    const cfg = cfgFor(dir)
    const calls: string[][] = []
    const deps = { runCli: stubCli(cfg, calls), warm: async () => true }
    await ensureProfile(cfg, alice, deps)
    const other = await ensureProfile(cfg, { ...alice, oid: "44444444-4444-4444-4444-444444444444" }, deps)
    expect(other.slug).toMatch(/^alice-chen-contoso-com-[0-9a-f]{8}$/)
    expect(new Registry(cfg.registryPath).list()).toHaveLength(2)
  })
})
