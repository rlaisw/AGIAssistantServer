import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const userFacing = [
  join("README.md"),
  join("app", "page.tsx"),
  join("..", "dify", "AGIAssistant", "AGI_Assistant.yml"),
].map((p) => readFileSync(join(root, p), "utf8"))

describe("isolation boundary copy (T024 / SC-011)", () => {
  it("never claims per-user Windows or OneDrive isolation", () => {
    const forbidden = [/per-user OneDrive/i, /each user'?s (own )?OneDrive/i, /your own Windows (PC|session)/i, /isolated Windows desktop/i]
    for (const text of userFacing) {
      for (const pattern of forbidden) expect(text).not.toMatch(pattern)
    }
  })

  it("states the shared Windows account boundary", () => {
    expect(userFacing.join("\n")).toMatch(/shared Windows PC account/i)
  })
})
