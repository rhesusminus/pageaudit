#!/usr/bin/env node
import { run } from '../src/cli.js'
import { askArgs, wantsWizard } from '../src/wizard.js'

const argv = process.argv.slice(2)
if (wantsWizard(argv, process.stdin, process.stdout)) {
  // While the questions are being built, the wizard only shows the command it would run, so trying it sends no
  // requests. 130 is the usual exit code for a run the user interrupted.
  process.exitCode = (await askArgs()) ? 0 : 130
} else {
  process.exitCode = await run(argv)
}
