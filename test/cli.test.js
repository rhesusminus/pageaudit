import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const GOOD_FACTS = {
  title: 'Gentle Shampoo - Example Store',
  description: 'A gentle daily shampoo for all hair types, made with plant-based ingredients.',
  h1s: ['Gentle Shampoo'],
  canonical: fixtureUrl('good.html'),
  lang: 'en',
  viewport: 'width=device-width, initial-scale=1',
  robots: null,
  headings: [
    { level: 1, text: 'Gentle Shampoo', excerpt: null },
    { level: 2, text: 'Ingredients', excerpt: null },
    { level: 3, text: 'Plant-based', excerpt: null },
    { level: 2, text: 'Reviews', excerpt: null }
  ],
  wordCount: 5,
  mainText: 'Gentle Shampoo Ingredients Plant-based Reviews',
  links: { internal: 0, external: 0, nofollow: 0 },
  linkSamples: [],
  images: { total: 1, missingAlt: 0 },
  imageSamples: [{ src: 'https://fixtures.test/products/shampoo.jpg', alt: 'Bottle of gentle shampoo', context: null }],
  openGraph: {
    title: 'Fixture page',
    description: 'Fixture description.',
    image: 'https://fixtures.test/og.png',
    type: null,
    url: null
  },
  twitterCard: 'summary_large_image',
  jsonLdTypes: []
}

test('cli: good.html has no issues, exposes its facts and exits 0', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('good.html')])
  assert.equal(code, 0)
  const { generatedAt, ...rest } = report
  assert.ok(!Number.isNaN(Date.parse(generatedAt)))
  assert.deepEqual(rest, {
    pages: [
      {
        url: fixtureUrl('good.html'),
        finalUrl: fixtureUrl('good.html'),
        status: 200,
        redirects: [],
        issues: [],
        facts: GOOD_FACTS
      }
    ],
    site: [],
    rules: {},
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

test('cli: bad-markup.html reports indexing, social, structured data and hygiene issues without failing', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('bad-markup.html')])
  assert.equal(code, 0)
  assert.deepEqual(pageTypes(report.pages[0]), [
    'incomplete-open-graph',
    'invalid-json-ld',
    'json-ld-missing-context',
    'json-ld-relative-url',
    'missing-lang',
    'missing-schema-property',
    'missing-twitter-card',
    'missing-viewport',
    'mixed-content',
    'nofollow',
    'noindex'
  ])
  assert.deepEqual(report.summary, { pages: 1, errors: 0, warnings: 8, infos: 3 })
  assert.equal((await runCli(t, [fixtureUrl('bad-markup.html'), '--json', '--fail-on', 'warning'])).code, 1)
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

test('cli: --out writes the same JSON report to a file', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'report.json')
  const { stdout } = await runCli(t, [fixtureUrl('good.html'), '--json', '--out', path])
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), JSON.parse(stdout))
})

test('cli: --out to an unwritable path exits 2 but still prints the report', async (t) => {
  const { code, stdout, stderr } = await runCli(t, [fixtureUrl('good.html'), '--json', '--out', '/no/such/dir/r.json'])
  assert.equal(code, 2)
  assert.match(stderr, /Could not write \/no\/such\/dir\/r.json: ENOENT/)
  assert.equal(JSON.parse(stdout).summary.pages, 1)
})

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pageaudit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('cli: --html writes a branded self-contained report', async (t) => {
  const dir = await tempDir(t)
  const logo = join(dir, 'logo.png')
  await writeFile(logo, TINY_PNG)
  const path = join(dir, 'report.html')
  const args = [
    fixtureUrl('bad-missing.html'),
    '--html',
    path,
    '--title',
    'Check',
    '--client',
    'Acme Oy',
    '--logo',
    logo
  ]
  const { code } = await runCli(t, [...args, '--json'])
  assert.equal(code, 1)
  const out = await readFile(path, 'utf8')
  assert.match(out, /<title>Check - Acme Oy<\/title>/)
  assert.match(out, /src="data:image\/png;base64,iVBOR/)
  assert.match(out, /The page has no title/)
})

test('cli: --html with --lighthouse shows the scores', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'report.html')
  const summary = {
    scores: { performance: 91, accessibility: 80, 'best-practices': 100, seo: 55 },
    metrics: { fcp: 1000, lcp: 2000, tbt: 10, cls: 0, speedIndex: 1500 },
    audits: [],
    warnings: []
  }
  const lighthouse = async (urls) => urls.map(() => ({ summary }))
  await runCli(t, [fixtureUrl('good.html'), '--lighthouse', '--html', path, '--json'], { lighthouse })
  const out = await readFile(path, 'utf8')
  assert.match(out, /aria-label="Speed: 91 out of 100"/)
  assert.match(out, /Largest Contentful Paint/)
})

test('cli: --html to an unwritable path exits 2', async (t) => {
  const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), '--html', '/no/such/dir/r.html', '--json'])
  assert.equal(code, 2)
  assert.match(stderr, /Could not write \/no\/such\/dir\/r.html: ENOENT/)
})

test('cli: a bad logo exits 2 before any page is fetched', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'logo.txt'), 'x')
  const fetchMock = mockFixtureFetch(t)
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  const base = [fixtureUrl('good.html'), '--html', join(dir, 'r.html'), '--json']
  assert.equal(await run([...base, '--logo', join(dir, 'logo.txt')]), 2)
  assert.equal(await run([...base, '--logo', join(dir, 'missing.png')]), 2)
  assert.match(errors[0], /--logo must be a png, jpg, gif, webp or svg file/)
  assert.match(errors[1], /Could not read the logo .*missing\.png: ENOENT/)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('cli: a logo over the size limit is rejected', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'big.png'), Buffer.alloc(513 * 1024))
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  assert.equal(await run([fixtureUrl('good.html'), '--html', join(dir, 'r.html'), '--logo', join(dir, 'big.png')]), 2)
  assert.match(errors[0], /larger than 512 KB/)
})

test('cli: --title, --client and --logo need --html', async (t) => {
  const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), '--client', 'Acme', '--json'])
  assert.equal(code, 2)
  assert.match(stderr, /only apply together with --html/)
})

test('cli: an empty --out value is a usage error', async (t) => {
  const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), '--out', '', '--json'])
  assert.equal(code, 2)
  assert.match(stderr, /--out needs a value/)
})

test('cli: empty --html, --title, --client and --logo values are usage errors', async (t) => {
  for (const option of ['--html', '--title', '--client', '--logo']) {
    const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), option, '', '--json'])
    assert.equal(code, 2)
    assert.match(stderr, new RegExp(`${option} needs a value`))
  }
})

test('cli: --html notes how many URLs a --limit left out', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'report.html')
  await runCli(t, [fixtureUrl('good.html'), fixtureUrl('bad-missing.html'), '--limit', '1', '--html', path, '--json'])
  assert.match(await readFile(path, 'utf8'), /Audited 1 page out of 2 found/)
})

test('cli: a sitemap run reports robots.txt blocks and sitemap entries that send mixed signals', async (t) => {
  const { code, report } = await runJson(t, ['--sitemap', fixtureUrl('sitemap-quality.xml')])
  assert.equal(code, 0)
  const site = Object.fromEntries(report.site.map((issue) => [issue.type, issue.urls]))
  assert.deepEqual(site['blocked-by-robots'], [fixtureUrl('blocked.html')])
  assert.deepEqual(site['sitemap-url-noindex'], [fixtureUrl('noindex.html'), fixtureUrl('noindex-header.html')])
  assert.deepEqual(site['sitemap-url-not-canonical'], [fixtureUrl('bad-canonical.html')])
  assert.deepEqual(site['sitemap-url-redirects'], [fixtureUrl('redirect-once')])
  const header = report.pages.find((page) => page.url === fixtureUrl('noindex-header.html'))
  assert.deepEqual(
    header.issues.map((i) => [i.type, i.context]),
    [['noindex', 'X-Robots-Tag: noindex']]
  )
  assert.equal(report.pages.find((page) => page.url === fixtureUrl('noindex.html')).issues[0].type, 'noindex')
})

test('cli: pages that are not listed in a sitemap get no sitemap issues and allowed pages are not blocked', async (t) => {
  const { report } = await runJson(t, [fixtureUrl('noindex.html'), fixtureUrl('bad-canonical.html')])
  assert.ok(report.site.every((issue) => !issue.type.startsWith('sitemap-')))
  assert.ok(report.site.every((issue) => issue.type !== 'blocked-by-robots'))
})
