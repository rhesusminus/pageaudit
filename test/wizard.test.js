import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import {
  answersToArgs,
  askArgs,
  checkLimit,
  checkPageUrls,
  checkSitemapUrl,
  checkUrlFile,
  wantsWizard
} from '../src/wizard.js'

const tty = { isTTY: true }
const pipe = { isTTY: undefined }
const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname

// Keys for the select prompt: Enter picks the highlighted choice, the arrow moves down.
const ENTER = '\r'
const DOWN = '\u001B[B'

// Answers the prompts by typing into clack's input, one chunk per prompt once the previous output has rendered.
// Returns the arguments and what was shown.
async function askShown(...typed) {
  const input = new PassThrough()
  const shown = []
  const output = new Writable({
    write: (chunk, _encoding, done) => {
      shown.push(chunk.toString())
      done()
    }
  })
  const answer = askArgs({ input, output })
  for (const keys of typed) {
    await new Promise((resolve) => setImmediate(resolve))
    input.write(keys)
  }
  return { args: await answer, shown: shown.join('') }
}

const ask = async (...typed) => (await askShown(...typed)).args

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

test('wizard: a sitemap is one URL', () => {
  assert.equal(checkSitemapUrl(' https://a.test/sitemap.xml '), undefined)
  assert.equal(checkSitemapUrl(''), 'Enter one sitemap URL')
  assert.equal(checkSitemapUrl('https://a.test/a.xml https://a.test/b.xml'), 'Enter one sitemap URL')
  assert.equal(
    checkSitemapUrl('a.test/sitemap.xml'),
    'a.test/sitemap.xml: not a valid URL (missing http:// or https://)'
  )
})

test('wizard: a URL file must be a readable file', () => {
  assert.equal(checkUrlFile(fixturePath('urls.txt')), undefined)
  assert.equal(checkUrlFile(' '), 'Enter the path of the file')
  assert.equal(checkUrlFile(undefined), 'Enter the path of the file')
  assert.equal(checkUrlFile(fixturePath('missing.txt')), `Could not read ${fixturePath('missing.txt')}: ENOENT`)
  assert.equal(checkUrlFile(fixturePath('')), `${fixturePath('')} is not a file`)
})

test('wizard: the limit is empty or a whole number of at least 1', () => {
  for (const limit of ['', ' ', undefined, '1', ' 20 ']) assert.equal(checkLimit(limit), undefined, limit)
  for (const limit of ['0', '-1', '2.5', 'ten']) {
    assert.equal(checkLimit(limit), 'Enter a whole number of at least 1, or leave it empty to audit all', limit)
  }
})

test('wizard: every page URL becomes an argument', () => {
  assert.deepEqual(answersToArgs({ source: 'pages', input: ' https://a.test/  https://b.test/x ' }), [
    'https://a.test/',
    'https://b.test/x'
  ])
})

test('wizard: a sitemap or a file becomes its option, with the limit when one was given', () => {
  assert.deepEqual(answersToArgs({ source: 'sitemap', input: ' https://a.test/s.xml ', limit: '' }), [
    '--sitemap',
    'https://a.test/s.xml'
  ])
  assert.deepEqual(answersToArgs({ source: 'sitemap', input: 'https://a.test/s.xml', limit: ' 20 ' }), [
    '--sitemap',
    'https://a.test/s.xml',
    '--limit',
    '20'
  ])
  assert.deepEqual(answersToArgs({ source: 'file', input: ' urls.txt ', limit: undefined }), [
    '--urls-file',
    'urls.txt'
  ])
})

test('wizard: returns the arguments for the typed pages, without asking for a limit', async () => {
  assert.deepEqual(await ask(ENTER, 'https://a.test/ https://b.test/\r'), ['https://a.test/', 'https://b.test/'])
})

test('wizard: asks for a sitemap and a limit', async () => {
  assert.deepEqual(await ask(DOWN + ENTER, 'https://a.test/s.xml\r', '20\r'), [
    '--sitemap',
    'https://a.test/s.xml',
    '--limit',
    '20'
  ])
})

test('wizard: asks for a URL file, and an empty limit audits all', async () => {
  const file = fixturePath('urls.txt')
  assert.deepEqual(await ask(DOWN + DOWN + ENTER, `${file}\r`, ENTER), ['--urls-file', file])
})

test('wizard: shows the command it would run', async () => {
  const { shown } = await askShown(ENTER, 'https://a.test/ https://b.test/\r')
  assert.match(shown, /Would run: pageaudit https:\/\/a\.test\/ https:\/\/b\.test\//)
})

test('wizard: asks again after an invalid answer', async () => {
  // Ctrl+U clears the rejected input.
  assert.deepEqual(await ask(ENTER, 'a.test\r', '\u0015https://a.test/\r'), ['https://a.test/'])
  assert.deepEqual(await ask(DOWN + ENTER, 'https://a.test/s.xml\r', '0\r', '\u00153\r'), [
    '--sitemap',
    'https://a.test/s.xml',
    '--limit',
    '3'
  ])
})

test('wizard: returns null when cancelled at any question', async () => {
  assert.equal(await ask('\u0003'), null)
  assert.equal(await ask(ENTER, '\u0003'), null)
  assert.equal(await ask(DOWN + ENTER, 'https://a.test/s.xml\r', '\u0003'), null)
})
