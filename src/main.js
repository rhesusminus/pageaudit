import { run } from './cli.js'
import { askArgs, wantsWizard } from './wizard.js'

// Runs pageaudit for the command line arguments and returns the exit code. With none in a terminal the wizard asks
// for the setup and runs it only when told to. The streams, the wizard and the audit are given in tests.
export async function main(argv, { stdin = process.stdin, stdout = process.stdout, ask = askArgs, audit = run } = {}) {
  if (!wantsWizard(argv, stdin, stdout)) return audit(argv)
  const setup = await ask()
  // 130 is the usual exit code for a run the user interrupted.
  if (!setup) return 130
  return setup.runNow ? audit(setup.args) : 0
}
