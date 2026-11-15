import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { main } from '../src/main.js'

const tty = { isTTY: true }
const pipe = { isTTY: undefined }
const ARGS = ['https://a.test/', '--html', 'report.html']

// main with a wizard that gives `setup` and an audit that exits 1, both recording their calls.
function start(t, argv, setup, { stdin = tty, stdout = tty } = {}) {
  const ask = t.mock.fn(async () => setup)
  const audit = t.mock.fn(async () => 1)
  return { code: main(argv, { stdin, stdout, ask, audit }), ask, audit }
}

test('main: runs the setup from the wizard once when told to run it now', async (t) => {
  const { code, ask, audit } = start(t, [], { args: ARGS, runNow: true })
  assert.equal(await code, 1)
  assert.equal(ask.mock.callCount(), 1)
  assert.deepEqual(
    audit.mock.calls.map((call) => call.arguments),
    [[ARGS]]
  )
})

test('main: exits 0 without auditing when the wizard is told to run it later', async (t) => {
  const { code, audit } = start(t, [], { args: ARGS, runNow: false })
  assert.equal(await code, 0)
  assert.equal(audit.mock.callCount(), 0)
})

test('main: exits 130 without auditing when the wizard is cancelled', async (t) => {
  const { code, audit } = start(t, [], null)
  assert.equal(await code, 130)
  assert.equal(audit.mock.callCount(), 0)
})

test('main: audits the arguments as given, without the wizard, when given any or not in a terminal', async (t) => {
  for (const [argv, streams] of [
    [ARGS, {}],
    [[], { stdin: pipe }],
    [[], { stdout: pipe }]
  ]) {
    const { code, ask, audit } = start(t, argv, { args: ['https://b.test/'], runNow: true }, streams)
    assert.equal(await code, 1)
    assert.equal(ask.mock.callCount(), 0)
    assert.deepEqual(
      audit.mock.calls.map((call) => call.arguments),
      [[argv]]
    )
  }
})

test('main: bin/pageaudit.js runs it with the command line arguments', () => {
  const out = execFileSync(process.execPath, ['bin/pageaudit.js', '--help'], { encoding: 'utf8' })
  assert.match(out, /^Usage: pageaudit /)
})
