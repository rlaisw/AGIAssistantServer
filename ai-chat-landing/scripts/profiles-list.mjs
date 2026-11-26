#!/usr/bin/env node
import { run } from "./profiles-cli.mjs"
run(["list", ...process.argv.slice(2)]).catch((error) => {
  console.error(error.message)
  process.exit(1)
})
