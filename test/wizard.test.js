import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import {
  answersToArgs,
  askArgs,
  checkContentFolder,
  checkLimit,
  checkLogoFile,
  checkPageUrls,
  checkReportPath,
  checkSitemapUrl,
  shellQuote,
  checkUrlFile,
  commandLines,
  wantsWizard
} from '../src/wizard.js'

const tty = { isTTY: true }
const pipe = { isTTY: undefined }
const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname

// Keys for the select prompts: Enter goes on with the highlighted or picked choices, the arrow moves down and
// Space picks in a multiselect.
const ENTER = '\r'
const DOWN = '\u001B[B'
const SPACE = ' '
// The last question, whether to run the audit now: Enter keeps the preselected Yes, the right arrow moves to No.
const RUN = ENTER
const LATER = '\u001B[C' + ENTER

// Answers the prompts by typing into clack's input, one chunk per prompt once the previous output has rendered.
// Returns the arguments, null when cancelled, whether to run them now and what was shown. A prompt still waiting
// after 5 s, because the test typed too few answers, is cancelled, so the test fails instead of hanging.
async function askShown(...typed) {
  const input = new PassThrough()
  const shown = []
  const output = new Writable({
    write: (chunk, _encoding, done) => {
      shown.push(chunk.toString())
      done()
    }
  })
  const answer = askArgs({ input, output, signal: AbortSignal.timeout(5000) })
  for (const keys of typed) {
    await new Promise((resolve) => setImmediate(resolve))
    input.write(keys)
  }
  const setup = await answer
  return { args: setup?.args ?? null, runNow: setup?.runNow, shown: stripVTControlCharacters(shown.join('')) }
}

const ask = async (...typed) => (await askShown(...typed)).args

// A folder for report and logo files, removed after the test.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'pageaudit-wizard-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

// One page and no extra checks, the answers before the report question.
const ONE_PAGE = [ENTER, 'https://a.test/\r', ENTER]

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

test('wizard: the limit is empty, all or a whole number of at least 1', () => {
  for (const limit of ['', ' ', undefined, 'all', '1', ' 20 ']) assert.equal(checkLimit(limit), undefined, limit)
  for (const limit of ['0', '-1', '2.5', 'ten', 'All']) {
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
  assert.deepEqual(answersToArgs({ source: 'file', input: ' urls.txt ', limit: 'all' }), ['--urls-file', 'urls.txt'])
  assert.deepEqual(answersToArgs({ source: 'file', input: ' urls.txt ', limit: undefined }), [
    '--urls-file',
    'urls.txt'
  ])
})

test('wizard: each picked check adds its option, in a fixed order', () => {
  const pages = { source: 'pages', input: 'https://a.test/' }
  assert.deepEqual(answersToArgs({ ...pages, checks: [] }), ['https://a.test/'])
  assert.deepEqual(answersToArgs({ ...pages, checks: ['links'] }), ['https://a.test/', '--check-links'])
  assert.deepEqual(answersToArgs({ ...pages, checks: ['links', 'lighthouse'] }), [
    'https://a.test/',
    '--lighthouse',
    '--check-links'
  ])
})

test('wizard: returns the arguments for the typed pages, without asking for a limit', async () => {
  assert.deepEqual(await ask(ENTER, 'https://a.test/ https://b.test/\r', ENTER, ENTER, RUN), [
    'https://a.test/',
    'https://b.test/'
  ])
})

test('wizard: asks for a sitemap and a limit', async () => {
  assert.deepEqual(await ask(DOWN + ENTER, 'https://a.test/s.xml\r', '20\r', ENTER, ENTER, RUN), [
    '--sitemap',
    'https://a.test/s.xml',
    '--limit',
    '20'
  ])
})

test('wizard: asks for a URL file, and an empty limit audits all and is shown as all', async () => {
  const file = fixturePath('urls.txt')
  const { args, shown } = await askShown(DOWN + DOWN + ENTER, `${file}\r`, ENTER, ENTER, ENTER, RUN)
  assert.deepEqual(args, ['--urls-file', file])
  // The answered question, not the placeholder shown while it is asked.
  assert.match(shown, /◇ {2}How many pages at most\?\n│ {2}all\n/)
})

test('wizard: asks for extra checks', async () => {
  const page = [ENTER, 'https://a.test/\r']
  assert.deepEqual(await ask(...page, SPACE + ENTER, ENTER, RUN), ['https://a.test/', '--lighthouse'])
  assert.deepEqual(await ask(...page, DOWN + SPACE + ENTER, ENTER, RUN), ['https://a.test/', '--check-links'])
  assert.deepEqual(await ask(...page, SPACE + DOWN + SPACE + ENTER, ENTER, RUN), [
    'https://a.test/',
    '--lighthouse',
    '--check-links'
  ])
})

test('wizard: shows the command before asking whether to run it', async () => {
  const { shown } = await askShown(ENTER, 'https://a.test/ https://b.test/\r', ENTER, ENTER, RUN)
  assert.match(shown, /◇ {2}Command:\n│ {2}pageaudit https:\/\/a\.test\/ https:\/\/b\.test\/\n/)
  assert.ok(shown.indexOf('Command:') < shown.indexOf('Run the audit now?'))
})

test('wizard: runs the audit now unless told to run it later', async () => {
  const run = await askShown(...ONE_PAGE, ENTER, RUN)
  assert.deepEqual(run.args, ['https://a.test/'])
  assert.equal(run.runNow, true)
  assert.match(run.shown, /└ {2}Running the audit\.\n/)
  const later = await askShown(...ONE_PAGE, ENTER, LATER)
  assert.deepEqual(later.args, ['https://a.test/'])
  assert.equal(later.runNow, false)
  assert.match(later.shown, /└ {2}Not run\. Paste the command above into a shell to run it later\.\n/)
})

test('wizard: quotes an argument only when a shell would change it', () => {
  for (const arg of ['https://a.test/x?', 'report.html', '--limit', '20', 'a_b@c%d+e=f:g,h']) {
    const expected = arg.includes('?') ? `'${arg}'` : arg
    assert.equal(shellQuote(arg), expected, arg)
  }
  assert.equal(shellQuote('Acme Oy'), "'Acme Oy'")
  assert.equal(shellQuote('https://a.test/?a=1&b=2'), "'https://a.test/?a=1&b=2'")
  assert.equal(shellQuote("Acme's"), String.raw`'Acme'\''s'`)
  assert.equal(shellQuote('Kevään'), "'Kevään'")
  assert.equal(shellQuote('~/r.html'), "'~/r.html'")
  assert.equal(shellQuote(''), "''")
  // zsh turns =name into the path of the command name, an = later in the argument is plain.
  assert.equal(shellQuote('=sh'), "'=sh'")
  assert.equal(shellQuote('a=b'), 'a=b')
})

const LONG_ARGS = [
  '--sitemap',
  'https://example.com/sitemap.xml?lang=fi&x=1',
  '--limit',
  '20',
  '--lighthouse',
  '--check-links',
  '--html',
  'audit.html',
  '--title',
  'Kevään audit',
  '--client',
  "Acme's Oy",
  '--logo',
  'logo.svg',
  '--out',
  'report.json'
]

test('wizard: the command fits on one line when it can', () => {
  assert.deepEqual(commandLines(['https://a.test/', '--lighthouse'], 77), ['pageaudit https://a.test/ --lighthouse'])
})

test('wizard: a long command wraps within the width, an option on the line of its value', () => {
  const lines = commandLines(LONG_ARGS, 77)
  assert.deepEqual(lines, [
    "pageaudit --sitemap 'https://example.com/sitemap.xml?lang=fi&x=1' \\",
    '  --limit 20 --lighthouse --check-links --html audit.html \\',
    "  --title 'Kevään audit' --client 'Acme'\\''s Oy' --logo logo.svg \\",
    '  --out report.json'
  ])
  for (const line of lines) assert.ok(line.length <= 77, line)
})

test('wizard: a part longer than a line gets a line of its own', () => {
  const url = `https://a.test/${'x'.repeat(80)}`
  assert.deepEqual(commandLines([url, '--json', '--out', 'r.json'], 40), [
    'pageaudit \\',
    `  ${url} \\`,
    '  --json --out r.json'
  ])
  assert.deepEqual(commandLines(['--lighthouse', url], 40), ['pageaudit --lighthouse \\', `  ${url}`])
})

test('wizard: the first part goes on the next line when it fits there and not after pageaudit', () => {
  const url = `https://a.test/${'x'.repeat(20)}`
  assert.deepEqual(commandLines([url], 40), ['pageaudit \\', `  ${url}`])
  assert.deepEqual(commandLines([url], 47), [`pageaudit ${url}`])
})

test('wizard: a wide character takes two columns of the line', () => {
  const lines = commandLines(['https://a.test/', '--title', '春'.repeat(8)], 50)
  assert.deepEqual(lines, ['pageaudit https://a.test/ \\', `  --title '${'春'.repeat(8)}'`])
})

// The arguments the shown command gives the shell, with pageaudit replaced by a function that prints them.
function shellArgs(shell, args) {
  const command = commandLines(args, 40).join('\n')
  const script = `pageaudit() { for arg in "$@"; do printf '%s\\n' "$arg"; done; }\n${command}\n`
  return execFileSync(shell, ['-c', script], { encoding: 'utf8' }).split('\n').slice(0, -1)
}

const ROUND_TRIP_ARGS = [...LONG_ARGS, '--logo', '=sh', '--title', '~/春 $HOME `x` "y" *']

test('wizard: the shown command gives sh back the same arguments', () => {
  assert.deepEqual(shellArgs('sh', ROUND_TRIP_ARGS), ROUND_TRIP_ARGS)
})

const hasZsh = !spawnSync('zsh', ['-c', 'true']).error
test('wizard: the shown command gives zsh back the same arguments', { skip: !hasZsh && 'zsh is not installed' }, () => {
  assert.deepEqual(shellArgs('zsh', ROUND_TRIP_ARGS), ROUND_TRIP_ARGS)
})

test('wizard: asks again after an invalid answer', async () => {
  // Ctrl+U clears the rejected input.
  assert.deepEqual(await ask(ENTER, 'a.test\r', '\u0015https://a.test/\r', ENTER, ENTER, RUN), ['https://a.test/'])
  assert.deepEqual(await ask(DOWN + ENTER, 'https://a.test/s.xml\r', '0\r', '\u00153\r', ENTER, ENTER, RUN), [
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
  assert.equal(await ask(ENTER, 'https://a.test/\r', '\u0003'), null)
  assert.equal(await ask(...ONE_PAGE, '\u0003'), null)
  assert.equal(await ask(...ONE_PAGE, SPACE + ENTER, '\u0003'), null)
  assert.equal(await ask(...ONE_PAGE, ENTER, '\u0003'), null)
})

test('wizard: a report path is a file in a folder that exists', (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'old.html'), 'old')
  assert.equal(checkReportPath(join(dir, 'new.html')), undefined)
  assert.equal(checkReportPath(` ${join(dir, 'old.html')} `), undefined)
  assert.equal(checkReportPath(''), 'Enter the path of the file')
  assert.equal(checkReportPath(dir), `${dir} is a folder, enter a file path`)
  assert.equal(checkReportPath(join(dir, 'missing', 'r.html')), `The folder ${join(dir, 'missing')} does not exist`)
  // A path the file system refuses to look at is a message to answer, not a crash.
  const long = join(dir, 'a'.repeat(300), 'r.html')
  assert.equal(checkReportPath(long), `Could not use ${long}: ENAMETOOLONG`)
})

test('wizard: the page content goes in a folder, which may not exist yet', (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'file'), 'x')
  assert.equal(checkContentFolder(dir), undefined)
  assert.equal(checkContentFolder(` ${join(dir, 'new', 'content')} `), undefined)
  assert.equal(checkContentFolder(' '), 'Enter the path of the folder')
  assert.equal(checkContentFolder(join(dir, 'file')), `${join(dir, 'file')} is a file, enter a folder`)
  const long = join(dir, 'a'.repeat(300))
  assert.equal(checkContentFolder(long), `Could not use ${long}: ENAMETOOLONG`)
})

test('wizard: a logo is left out, or a readable image file of at most 512 KB', (t) => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(dir, 'big.png'), Buffer.alloc(512 * 1024 + 1))
  mkdirSync(join(dir, 'folder.png'))
  for (const logo of ['', ' ', undefined, 'none', join(dir, 'logo.svg')]) assert.equal(checkLogoFile(logo), undefined)
  assert.equal(checkLogoFile(join(dir, 'logo.txt')), 'The logo must be a png, jpg, gif, webp or svg file')
  assert.equal(checkLogoFile(join(dir, 'missing.png')), `Could not read ${join(dir, 'missing.png')}: ENOENT`)
  assert.equal(checkLogoFile(join(dir, 'folder.png')), `${join(dir, 'folder.png')} is not a file`)
  assert.equal(checkLogoFile(join(dir, 'big.png')), `${join(dir, 'big.png')} is larger than 512 KB`)
})

test('wizard: the report answers become their options, leaving out defaults and empty answers', () => {
  const page = { source: 'pages', input: 'https://a.test/' }
  const html = { html: ' r.html ', title: 'Website audit', client: 'none', logo: 'none' }
  assert.deepEqual(answersToArgs({ ...page, ...html }), ['https://a.test/', '--html', 'r.html'])
  assert.deepEqual(answersToArgs({ ...page, ...html, title: ' Audit ', client: ' Acme Oy ', logo: ' l.svg ' }), [
    'https://a.test/',
    '--html',
    'r.html',
    '--title',
    'Audit',
    '--client',
    'Acme Oy',
    '--logo',
    'l.svg'
  ])
  assert.deepEqual(answersToArgs({ ...page, json: ' r.json ' }), ['https://a.test/', '--out', 'r.json'])
  assert.deepEqual(answersToArgs({ ...page, digest: ' d.json ' }), ['https://a.test/', '--digest', 'd.json'])
  assert.deepEqual(answersToArgs({ ...page, content: ' pages ' }), ['https://a.test/', '--content', 'pages'])
  // "none" only stands for a left-out client or logo. As a path or a title it is what was typed.
  assert.deepEqual(answersToArgs({ ...page, ...html, html: 'none', title: 'none', json: 'none' }), [
    'https://a.test/',
    '--html',
    'none',
    '--title',
    'none',
    '--out',
    'none'
  ])
  assert.deepEqual(answersToArgs({ ...page, ...html, json: 'r.json' }), [
    'https://a.test/',
    '--html',
    'r.html',
    '--out',
    'r.json'
  ])
})

test('wizard: asks for every report file, with their default paths', async (t) => {
  const dir = tempDir(t)
  const cwd = process.cwd()
  process.chdir(dir)
  t.after(() => process.chdir(cwd))
  const all = SPACE + DOWN + SPACE + DOWN + SPACE + ENTER
  assert.deepEqual(await ask(...ONE_PAGE, all, ENTER, ENTER, ENTER, ENTER, ENTER, ENTER, RUN), [
    'https://a.test/',
    '--html',
    'report.html',
    '--out',
    'report.json',
    '--digest',
    'report.digest.json'
  ])
})

test('wizard: the digest cannot take the path of the JSON report', async (t) => {
  const dir = tempDir(t)
  const [json, digest] = [join(dir, 'r.json'), join(dir, 'r.digest.json')]
  const typed = [...ONE_PAGE, DOWN + SPACE + DOWN + SPACE + ENTER, `${json}\r`, `${json}\r`, `\u0015${digest}\r`]
  const { args, shown } = await askShown(...typed, RUN)
  assert.deepEqual(args, ['https://a.test/', '--out', json, '--digest', digest])
  assert.match(shown, /The JSON report goes there/)
})

test('wizard: asks for the page content folder, which cannot be where a report goes', async (t) => {
  const dir = tempDir(t)
  const cwd = process.cwd()
  process.chdir(dir)
  t.after(() => process.chdir(cwd))
  const contentOnly = DOWN + DOWN + DOWN + SPACE + ENTER
  assert.deepEqual(await ask(...ONE_PAGE, contentOnly, ENTER, RUN), ['https://a.test/', '--content', 'content'])
  const jsonAndContent = DOWN + SPACE + DOWN + DOWN + SPACE + ENTER
  const typed = [...ONE_PAGE, jsonAndContent, 'r.json\r', 'r.json\r', '\u0015pages\r']
  const { args, shown } = await askShown(...typed, RUN)
  assert.deepEqual(args, ['https://a.test/', '--out', 'r.json', '--content', 'pages'])
  assert.match(shown, /The JSON report goes there/)
})

test('wizard: an answer of only spaces takes the default path', async (t) => {
  const dir = tempDir(t)
  const cwd = process.cwd()
  process.chdir(dir)
  t.after(() => process.chdir(cwd))
  assert.deepEqual(await ask(...ONE_PAGE, SPACE + DOWN + SPACE + ENTER, '  \r', ENTER, ENTER, ENTER, ' \r', RUN), [
    'https://a.test/',
    '--html',
    'report.html',
    '--out',
    'report.json'
  ])
})

test('wizard: asks for the HTML report title, client and logo', async (t) => {
  const dir = tempDir(t)
  const logo = join(dir, 'logo.svg')
  writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg"/>')
  const html = join(dir, 'r.html')
  const typed = [...ONE_PAGE, SPACE + ENTER, `${html}\r`, 'Audit\r', 'Acme Oy\r', `${logo}\r`]
  const { args, shown } = await askShown(...typed, RUN)
  assert.deepEqual(args, ['https://a.test/', '--html', html, '--title', 'Audit', '--client', 'Acme Oy', '--logo', logo])
  assert.doesNotMatch(shown, /JSON report go/)
})

test('wizard: an empty client and logo are shown as none', async (t) => {
  const html = join(tempDir(t), 'r.html')
  const { args, shown } = await askShown(...ONE_PAGE, SPACE + ENTER, `${html}\r`, ENTER, ENTER, ENTER, RUN)
  assert.deepEqual(args, ['https://a.test/', '--html', html])
  assert.match(shown, /◇ {2}Who is the client\?\n│ {2}none\n/)
  assert.match(shown, /◇ {2}Which logo should it show\?[^\n]*\n│ {2}none\n/)
})

test('wizard: asks before replacing a report file, and for another path on no', async (t) => {
  const dir = tempDir(t)
  const old = join(dir, 'old.json')
  writeFileSync(old, 'old')
  const json = [...ONE_PAGE, DOWN + SPACE + ENTER, `${old}\r`]
  // Enter keeps the preselected No, the left arrow moves to Yes.
  assert.deepEqual(await ask(...json, ENTER, `${join(dir, 'new.json')}\r`, RUN), [
    'https://a.test/',
    '--out',
    join(dir, 'new.json')
  ])
  assert.deepEqual(await ask(...json, '\u001B[D' + ENTER, RUN), ['https://a.test/', '--out', old])
})

test('wizard: asks again for a report path that cannot be used', async (t) => {
  const dir = tempDir(t)
  const html = join(dir, 'r.html')
  const typed = [...ONE_PAGE, SPACE + DOWN + SPACE + ENTER, `${join(dir, 'missing', 'r.html')}\r`, `\u0015${html}\r`]
  const reportAnswers = [ENTER, ENTER, ENTER, `${html}\r`, `\u0015${join(dir, 'r.json')}\r`]
  const { args, shown } = await askShown(...typed, ...reportAnswers, RUN)
  assert.deepEqual(args, ['https://a.test/', '--html', html, '--out', join(dir, 'r.json')])
  assert.match(shown, /does not exist/)
  assert.match(shown, /The HTML report goes there/)
})

test('wizard: the JSON report cannot take the HTML report path through a link to its folder', async (t) => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'real'))
  symlinkSync(join(dir, 'real'), join(dir, 'link'))
  const html = join(dir, 'real', 'r.html')
  const json = join(dir, 'real', 'r.json')
  const typed = [...ONE_PAGE, SPACE + DOWN + SPACE + ENTER, `${html}\r`, ENTER, ENTER, ENTER]
  const { args, shown } = await askShown(...typed, `${join(dir, 'link', 'r.html')}\r`, `\u0015${json}\r`, RUN)
  assert.deepEqual(args, ['https://a.test/', '--html', html, '--out', json])
  assert.match(shown, /The HTML report goes there/)
})
