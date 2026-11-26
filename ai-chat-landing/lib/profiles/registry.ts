import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs"
import { dirname } from "node:path"
import { ProfileError } from "./errors"
import { SLUG_RE } from "./identity"

export type ProfileStatus = "active" | "disabled"

export type ProfileEntry = {
  oidHash: string
  slug: string
  status: ProfileStatus
  email: string
  displayName: string
  winUser: string
  createdAt: string
  updatedAt: string
  lastSeenAt: string
  lastError: { code: string; at: string } | null
}

type RegistryFile = { version: 1; updatedAt: string; profiles: Record<string, ProfileEntry> }
const STATUSES: ProfileStatus[] = ["active", "disabled"]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function empty(): RegistryFile {
  return { version: 1, updatedAt: new Date(0).toISOString(), profiles: {} }
}

export class Registry {
  constructor(private readonly path: string, private readonly lockTimeoutMs = 30_000) {}

  read(): RegistryFile {
    if (!existsSync(this.path)) return empty()
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      throw new ProfileError("registry_unavailable", code ? `registry read ${code}` : "registry parse")
    }
    const file = parsed as RegistryFile
    if (!file || file.version !== 1 || typeof file.profiles !== "object" || file.profiles === null) {
      throw new ProfileError("registry_unavailable", "registry shape")
    }
    for (const [key, entry] of Object.entries(file.profiles)) {
      if (
        !/^[0-9a-f]{16}$/.test(key) ||
        entry.oidHash !== key ||
        !SLUG_RE.test(entry.slug) ||
        !STATUSES.includes(entry.status)
      ) {
        throw new ProfileError("registry_unavailable", `registry entry ${key}`)
      }
    }
    return file
  }

  list(): ProfileEntry[] {
    return Object.values(this.read().profiles).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  byOid(oidHash: string): ProfileEntry | undefined {
    return this.read().profiles[oidHash]
  }

  bySlug(slug: string): ProfileEntry | undefined {
    return this.list().find((entry) => entry.slug === slug)
  }

  write(file: RegistryFile): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`
    const fd = openSync(tmp, "w", 0o600)
    try {
      writeSync(fd, JSON.stringify({ ...file, updatedAt: new Date().toISOString() }, null, 2))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.path)
  }

  async withLock<T>(fn: (file: RegistryFile) => T | Promise<T>): Promise<T> {
    const lock = `${this.path}.lock`
    const started = Date.now()
    let fd: number | null = null
    while (fd === null) {
      try {
        mkdirSync(dirname(this.path), { recursive: true })
        fd = openSync(lock, "wx", 0o600)
        writeSync(fd, String(process.pid))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "EEXIST") {
          // Permission/space errors are not contention: fail fast and honestly.
          throw new ProfileError("registry_unavailable", `lock ${code ?? "error"}`)
        }
        try {
          if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { force: true })
        } catch {
          /* lock vanished */
        }
        if (Date.now() - started > this.lockTimeoutMs) {
          throw new ProfileError("provisioning_in_progress")
        }
        await sleep(50)
      }
    }
    try {
      const file = this.read()
      const result = await fn(file)
      this.write(file)
      return result
    } finally {
      closeSync(fd)
      rmSync(lock, { force: true })
    }
  }
}

export type { RegistryFile }
