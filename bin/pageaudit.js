#!/usr/bin/env node
import { run } from '../src/cli.js'
import { askArgs, wantsWizard } from '../src/wizard.js'

const argv = process.argv.slice(2)
const args = wantsWizard(argv, process.stdin, process.stdout) ? await askArgs() : argv
// 130 is the usual exit code for a run the user interrupted.
process.exitCode = args ? await run(args) : 130
