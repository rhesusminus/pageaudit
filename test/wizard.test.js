import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { answersToArgs, askArgs, checkPageUrls, wantsWizard } from '../src/wizard.js'

const tty = { isTTY: true }
const pipe = { isTTY: undefined }

// Answers the prompts by typing into clack's input, one chunk per prompt once the previous output has rendered.
async function ask(...typed) {
  const input = new PassThrough()
  const output = new Writable({ write: (_chunk, _encoding, done) => done() })
  const answer = askArgs({ input, output })
  for (const keys of typed) {
    await new Promise((resolve) => setImmediate(resolve))
    input.write(keys)
  }
  return answer
}

test('wizard: only runs with no arguments and a terminal on both ends', () => {
  assert.equal(wantsWizard([], tty, tty), true)
  assert.equal(wantsWizard(['https://a.test/'], tty, tty), false)
  assert.equal(wantsWizard(['--help'], tty, tty), false)
  assert.equal(wantsWizard([], pipe, tty), false)
  assert.equal(wantsWizard([], tty, pipe), false)
})

test('wizard: page URLs are checked like any other input', () => {
  assert.equal(checkPageUrls('https://a.test/ http://b.test/x'), undefined)
  assert.equal(checkPageUrls('  '), 'Enter at least one URL')
  assert.equal(checkPageUrls(undefined), 'Enter at least one URL')
  assert.equal(checkPageUrls('https://a.test/ a.test'), 'a.test: not a valid URL (missing http:// or https://)')
  assert.equal(checkPageUrls('ftp://a.test/'), 'ftp://a.test/: unsupported protocol ftp: (only http and https)')
})

test('wizard: every page URL becomes an argument', () => {
  assert.deepEqual(answersToArgs({ pages: ' https://a.test/  https://b.test/x ' }), [
    'https://a.test/',
    'https://b.test/x'
  ])
})

test('wizard: returns the arguments for the typed pages', async () => {
  assert.deepEqual(await ask('https://a.test/ https://b.test/\r'), ['https://a.test/', 'https://b.test/'])
})

test('wizard: asks again after an invalid URL', async () => {
  // Ctrl+U clears the rejected input.
  assert.deepEqual(await ask('a.test\r', '\u0015https://a.test/\r'), ['https://a.test/'])
})

test('wizard: returns null when cancelled', async () => {
  assert.equal(await ask('\u0003'), null)
})
