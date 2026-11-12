#!/usr/bin/env node
import { EXIT_BUSINESS } from './exit-codes.js'
import { printError } from './output.js'
import { main } from './program.js'

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    printError(`ledger: 未预期的错误：${message}`)
    process.exitCode = EXIT_BUSINESS
  })
