import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { canSpin, run } from '../src/cli.js'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

const fixtureUrl = (name) => `${FIXTURE_HOST}/${name}`
const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname

// Runs the CLI against the fixture site and captures what it prints. Requests to
// the same host are not spaced out, so tests stay fast.
async function runCli(t, args, options = {}) {
  mockFixtureFetch(t)
  const stdout = []
  const stderr = []
  t.mock.method(console, 'log', (...a) => stdout.push(a.join(' ')))
  t.mock.method(console, 'error', (...a) => stderr.push(a.join(' ')))
  const code = await run([...args, '--delay', '0'], options)
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') }
}

async function runJson(t, args, options) {
  const result = await runCli(t, [...args, '--json'], options)
  return { ...result, report: JSON.parse(result.stdout) }
}

const pageTypes = (page) => page.issues.map((i) => i.type).sort()

test('cli: good.html has no issues and exits 0', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('good.html')])
  assert.equal(code, 0)
  assert.deepEqual(report, {
    pages: [
      { url: fixtureUrl('good.html'), finalUrl: fixtureUrl('good.html'), status: 200, redirects: [], issues: [] }
    ],
    site: [],
    skipped: [],
    summary: { pages: 1, errors: 0, warnings: 0, infos: 0 }
  })
})

test('cli: bad-overlong.html reports its issues and exits 1', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('bad-overlong.html')])
  assert.equal(code, 1)
  assert.deepEqual(report.summary, { pages: 1, errors: 1, warnings: 4, infos: 3 })
  assert.equal(report.pages[0].issues.length, 8)
  assert.ok(report.pages[0].issues.every((i) => i.url === fixtureUrl('bad-overlong.html')))
})

test('cli: bad-missing.html reports missing elements and exits 1', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('bad-missing.html')])
  assert.equal(code, 1)
  assert.deepEqual(report.summary, { pages: 1, errors: 1, warnings: 3, infos: 0 })
  assert.deepEqual(pageTypes(report.pages[0]), [
    'missing-canonical',
    'missing-description',
    'missing-h1',
    'missing-title'
  ])
})

test('cli: pages that cannot be audited become issues instead of stopping the run', async (t) => {
  const names = ['nope.html', 'not-html', 'timeout', 'good.html']
  const { code, report } = await runJson(t, [...names.map(fixtureUrl), 'https://elsewhere.test/'])
  assert.equal(code, 1)
  assert.deepEqual(
    report.pages.map((p) => [p.status, pageTypes(p)]),
    [
      [404, ['http-status']],
      [200, ['not-html']],
      [null, ['fetch-failed']],
      [200, []],
      [null, ['fetch-failed']]
    ]
  )
  assert.match(report.pages[2].issues[0].message, /timed out after 15s/)
  assert.match(report.pages[4].issues[0].message, /ENOTFOUND/)
  assert.deepEqual(report.summary, { pages: 5, errors: 3, warnings: 0, infos: 1 })
})

test('cli: a non-HTML page alone is not an error', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('not-html')])
  assert.equal(code, 0)
  assert.equal(report.summary.infos, 1)
})

test('cli: a redirect chain is a warning on the page and the final page is audited', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('redirect-twice')])
  assert.equal(code, 0)
  const [page] = report.pages
  assert.equal(page.finalUrl, fixtureUrl('good.html'))
  assert.equal(page.redirects.length, 2)
  assert.deepEqual(pageTypes(page), ['redirect-chain'])
})

test('cli: several pages are merged, deduplicated and compared across pages', async (t) => {
  const { code, report } = await runJson(t, [
    fixtureUrl('good.html'),
    fixtureUrl('duplicate.html'),
    `${fixtureUrl('good.html')}/`,
    `${fixtureUrl('good.html')}#reviews`
  ])
  assert.equal(code, 0)
  assert.deepEqual(
    report.pages.map((p) => p.url),
    [fixtureUrl('good.html'), fixtureUrl('duplicate.html')]
  )
  assert.deepEqual(
    report.site.map((i) => [i.type, i.urls.length]),
    [
      ['duplicate-title', 2],
      ['duplicate-description', 2],
      ['duplicate-h1', 2]
    ]
  )
  assert.deepEqual(report.summary, { pages: 2, errors: 0, warnings: 3, infos: 0 })
})

test('cli: --urls-file reads a list and reports skipped lines', async (t) => {
  const { code, report, stderr } = await runJson(t, ['--urls-file', fixturePath('urls.txt')])
  assert.equal(code, 1)
  assert.deepEqual(
    report.pages.map((p) => p.url),
    [fixtureUrl('good.html'), fixtureUrl('bad-missing.html?variant=b'), fixtureUrl('bad-images.html')]
  )
  assert.deepEqual(
    report.skipped.map((s) => s.input),
    ['ftp://fixtures.test/file.txt', 'fixtures.test/no-scheme.html']
  )
  assert.match(stderr, /Skipped ftp:\/\/fixtures\.test\/file\.txt \(.*urls\.txt:8\): unsupported protocol ftp:/)
})

test('cli: --urls-file - reads the list from stdin', async (t) => {
  const stdin = Readable.from([`${fixtureUrl('good.html')}\n${fixtureUrl('bad-missing.html')}\n`])
  const { report } = await runJson(t, ['--urls-file', '-'], { stdin })
  assert.equal(report.summary.pages, 2)
})

test('cli: --sitemap follows a sitemap index and reports skipped child sitemaps', async (t) => {
  const { report } = await runJson(t, ['--sitemap', fixtureUrl('sitemap-index.xml')])
  assert.deepEqual(
    report.pages.map((p) => p.url),
    [fixtureUrl('good.html'), fixtureUrl('bad-missing.html'), fixtureUrl('bad-images.html?ref=sitemap&page=1')]
  )
  assert.deepEqual(
    report.skipped.map((s) => s.reason),
    ['nested sitemap index (only one level is followed)', 'could not read sitemap: HTTP 404']
  )
})

test('cli: arguments, files and sitemaps combine, and --limit caps the result', async (t) => {
  const { report, stderr } = await runJson(t, [
    fixtureUrl('duplicate.html'),
    '--sitemap',
    fixtureUrl('sitemap.xml'),
    '--urls-file',
    fixturePath('urls.txt'),
    '--limit',
    '3'
  ])
  assert.deepEqual(
    report.pages.map((p) => p.url),
    [fixtureUrl('duplicate.html'), fixtureUrl('good.html'), fixtureUrl('bad-missing.html?variant=b')]
  )
  assert.match(stderr, /Auditing the first 3 of 6 URLs \(--limit 3\)/)
})

test('cli: --fail-on warning makes warnings fail', async (t) => {
  assert.equal((await runCli(t, [fixtureUrl('redirect-twice'), '--json', '--fail-on', 'warning'])).code, 1)
  assert.equal((await runCli(t, [fixtureUrl('good.html'), '--json', '--fail-on', 'warning'])).code, 0)
  assert.equal((await runCli(t, [fixtureUrl('redirect-twice'), '--json', '--fail-on', 'error'])).code, 0)
})

test('cli: an unreadable URL file or sitemap exits 2', async (t) => {
  const file = await runCli(t, ['--urls-file', '/nope/urls.txt', '--json'])
  assert.equal(file.code, 2)
  assert.match(file.stderr, /Could not read \/nope\/urls\.txt: ENOENT/)
  const sitemap = await runCli(t, ['--sitemap', fixtureUrl('nope.xml'), '--json'])
  assert.equal(sitemap.code, 2)
  assert.match(sitemap.stderr, /Could not read sitemap .*nope\.xml: HTTP 404/)
})

test('cli: nothing left to audit exits 2', async (t) => {
  const { code, stderr } = await runCli(t, ['not a url', '--json'])
  assert.equal(code, 2)
  assert.match(stderr, /Skipped not a url \(argument\): not a valid URL/)
  assert.match(stderr, /No URLs to audit/)
})

test('cli: usage errors exit 2', async (t) => {
  for (const args of [
    [],
    ['--limit', '0', 'https://a.test/'],
    ['--concurrency', 'x', 'https://a.test/'],
    ['--fail-on', 'info', 'https://a.test/'],
    ['--bogus']
  ]) {
    const { code, stderr } = await runCli(t, args)
    assert.equal(code, 2, args.join(' '))
    assert.match(stderr, /Usage: pageaudit/)
  }
})

test('cli: --help prints the options and exits 0', async (t) => {
  const { code, stdout } = await runCli(t, ['--help'])
  assert.equal(code, 0)
  for (const option of ['--urls-file', '--sitemap', '--limit', '--concurrency', '--delay', '--fail-on', '--json']) {
    assert.match(stdout, new RegExp(option))
  }
})

test('cli: spinner is only enabled on a TTY that reports columns', () => {
  assert.equal(canSpin({ isTTY: true, columns: 80 }), true)
  assert.equal(canSpin({ isTTY: true, columns: 0 }), false)
  assert.equal(canSpin({ isTTY: true }), false)
  assert.equal(canSpin({ isTTY: false, columns: 80 }), false)
  assert.equal(canSpin({}), false)
})

const fakeLighthouse = (results) => async (urls) => results.slice(0, urls.length)

test('cli: --lighthouse attaches a summary to pages that returned HTML', async (t) => {
  const summary = { scores: { seo: 90 }, metrics: {}, audits: [], warnings: [] }
  const urls = [fixtureUrl('good.html'), fixtureUrl('missing-page')]
  const seen = []
  const lighthouse = async (list) => (seen.push(...list), [{ summary }])
  const { code, report } = await runJson(t, [...urls, '--lighthouse'], { lighthouse })
  assert.equal(code, 1)
  assert.deepEqual(seen, [fixtureUrl('good.html')])
  assert.deepEqual(report.pages[0].lighthouse, summary)
  assert.equal('lighthouse' in report.pages[1], false)
})

test('cli: a Lighthouse failure is an info issue on the page and does not stop the run', async (t) => {
  const lighthouse = fakeLighthouse([{ error: 'Could not start Chrome: nope' }])
  const { code, report } = await runJson(t, [fixtureUrl('good.html'), '--lighthouse'], { lighthouse })
  assert.equal(code, 0)
  assert.equal(report.pages[0].lighthouse, null)
  assert.deepEqual(pageTypes(report.pages[0]), ['lighthouse-failed'])
  assert.deepEqual(report.summary, { pages: 1, errors: 0, warnings: 0, infos: 1 })
})

test('cli: without --lighthouse the report has no lighthouse key and the runner is not called', async (t) => {
  const lighthouse = async () => assert.fail('should not run')
  const { report } = await runJson(t, [fixtureUrl('good.html')], { lighthouse })
  assert.equal('lighthouse' in report.pages[0], false)
})

test('cli: a Lighthouse failure does not fail --fail-on warning', async (t) => {
  const lighthouse = fakeLighthouse([{ error: 'Could not start Chrome: nope' }])
  const { code } = await runJson(t, [fixtureUrl('good.html'), '--lighthouse', '--fail-on', 'warning'], { lighthouse })
  assert.equal(code, 0)
})

test('cli: Lighthouse audits the final URL once and the failure keeps the input URL', async (t) => {
  const seen = []
  const lighthouse = async (list) => (seen.push(...list), list.map(() => ({ error: 'boom' })))
  const urls = [fixtureUrl('redirect-once'), fixtureUrl('good.html')]
  const { report } = await runJson(t, [...urls, '--lighthouse'], { lighthouse })
  assert.deepEqual(seen, [fixtureUrl('good.html')])
  const failures = report.pages.map((page) => page.issues.find((i) => i.type === 'lighthouse-failed'))
  assert.deepEqual(
    failures.map((issue) => issue.url),
    urls
  )
})
