import { homedir } from "node:os"
import { join } from "node:path"

export type ProfilesConfig = {
  provisionToken: string
  profilesDir: string
  templateProfile: string
  winUser: string
  registryPath: string
  auditPath: string
  gatewayUrl: string
}

export function loadProfilesConfig(env: NodeJS.ProcessEnv = process.env): ProfilesConfig {
  const provisionToken = env.PROFILES_PROVISION_TOKEN ?? ""
  const home = homedir()
  const profilesDir = env.HERMES_PROFILES_DIR ?? join(home, ".hermes", "profiles")
  const templateProfile = env.HERMES_TEMPLATE_PROFILE ?? "template-pc"
  if (!provisionToken) throw new Error("PROFILES_PROVISION_TOKEN is required")
  if (!templateProfile) throw new Error("HERMES_TEMPLATE_PROFILE is required")
  const stateDir = join(home, ".config", "agentic-rag-mcp", "hermes-mcp")
  return {
    provisionToken,
    profilesDir,
    templateProfile,
    winUser: env.HERMES_WIN_USER ?? "shared-windows-user",
    registryPath: env.HERMES_REGISTRY_PATH ?? join(stateDir, "profiles.json"),
    auditPath: env.HERMES_AUDIT_PATH ?? join(stateDir, "audit.jsonl"),
    gatewayUrl: env.HERMES_GATEWAY_URL ?? "http://172.17.0.1:8642",
  }
}
