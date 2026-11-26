import { vi } from "vitest"

export type LogSpy = {
  text: () => string
  entries: () => Record<string, unknown>[]
  restore: () => void
}

export function spyOnAuthLog(): LogSpy {
  const calls: string[] = []
  const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
    calls.push(args.map(String).join(" "))
  })
  return {
    text: () => calls.join("\n"),
    entries: () => calls.map((line) => JSON.parse(line) as Record<string, unknown>),
    restore: () => spy.mockRestore(),
  }
}
