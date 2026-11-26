import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ProfilesConfig } from "../config"

export function profilesConfigFor(dir: string): ProfilesConfig {
  return {
    provisionToken: "token",
    profilesDir: join(dir, "profiles"),
    templateProfile: "template-pc",
    winUser: "PC12345",
    registryPath: join(dir, "profiles.json"),
    auditPath: join(dir, "audit.jsonl"),
    gatewayUrl: "http://gateway.test",
  }
}

/** Deterministic stand-in for `hermes profile create` (clone copies a key on purpose). */
export function stubHermesCli(cfg: ProfilesConfig, calls: string[][] = []) {
  const run = async (args: string[]) => {
    calls.push(args)
    const home = join(cfg.profilesDir, args[2])
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, "config.yaml"), "model: test\n")
    writeFileSync(join(home, ".env"), "API_SERVER_KEY=CLONED_FROM_TEMPLATE\nOTHER=1\n", { mode: 0o600 })
  }
  return { run, calls }
}

export const ALICE = {
  slug: "alice-chen-contoso-com",
  oid: "11111111-1111-1111-1111-111111111111",
  email: "alice.chen@contoso.com",
  displayName: "Alice Chen",
}

export const BOB = {
  slug: "bob-ng-tvb-com-hk",
  oid: "22222222-2222-2222-2222-222222222222",
  email: "bob.ng@tvb.com.hk",
  displayName: "Bob Ng",
}
