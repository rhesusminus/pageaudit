#!/usr/bin/env node
import { run } from '../src/cli.js'
import { askArgs, wantsWizard } from '../src/wizard.js'

const argv = process.argv.slice(2)
if (wantsWizard(argv, process.stdin, process.stdout)) {
  const setup = await askArgs()
  // 130 is the usual exit code for a run the user interrupted.
  if (!setup) process.exitCode = 130
  else process.exitCode = setup.runNow ? await run(setup.args) : 0
} else {
  process.exitCode = await run(argv)
}
