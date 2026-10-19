import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Readable } from 'node:stream'
import pkg from '../package.json' with { type: 'json' }
import { run } from '../src/cli.js'
import { buildDigest } from '../src/digest.js'
import { SCHEMA_VERSION } from '../src/report.js'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'
import { mockFetch } from './helpers/mock-fetch.js'

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
  robotsHeader: null,
  nosnippetElements: 0,
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
  imageSamples: [
    {
      src: 'https://fixtures.test/products/shampoo.jpg',
      alt: 'Bottle of gentle shampoo',
      context: 'Gentle Shampoo Ingredients Plant-based Reviews'
    }
  ],
  openGraph: {
    title: 'Fixture page',
    description: 'Fixture description.',
    image: 'https://fixtures.test/og.png',
    type: null,
    url: null
  },
  twitterCard: 'summary_large_image',
  jsonLdTypes: [],
  hreflang: [],
  jsonLd: [],
  dates: { published: null, modified: null, lastModified: null },
  author: null
}

// How test/fixtures/robots.txt treats AI crawlers when only pages it allows are audited.
const FIXTURE_ORIGIN = {
  origin: 'https://fixtures.test',
  robotsTxt: 'ok',
  aiSearch: { 'OAI-SearchBot': 'allowed', 'Claude-SearchBot': 'allowed', PerplexityBot: 'allowed' },
  aiTraining: {
    GPTBot: 'allowed',
    ClaudeBot: 'allowed',
    'Google-Extended': 'allowed',
    'Applebot-Extended': 'allowed',
    CCBot: 'allowed'
  },
  contentSignal: 'search=yes, ai-train=no'
}

// The coverage of a run with no option that changes what is collected. The tests run with --delay 0.
const PLAIN_COVERAGE = {
  tool: { name: 'pageaudit', version: pkg.version },
  settings: {
    limit: null,
    concurrency: 3,
    delay: 0,
    sitemaps: [],
    lighthouse: false,
    lighthousePages: 0,
    lighthouseRuns: null,
    checkLinks: false
  },
  urls: { found: 1, audited: 1 },
  notRun: [
    { check: 'lighthouse', reason: 'not asked for (--lighthouse or --lighthouse-page)' },
    { check: 'links', reason: 'not asked for (--check-links)' }
  ]
}

test('cli: good.html has no issues, exposes its facts and exits 0', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('good.html')])
  assert.equal(code, 0)
  const { generatedAt, schemaVersion, ...rest } = report
  assert.equal(schemaVersion, SCHEMA_VERSION)
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
    origins: [FIXTURE_ORIGIN],
    rules: {},
    skipped: [],
    coverage: PLAIN_COVERAGE,
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

test('cli: a page nested deeper than Chrome parses is checked like any other', async (t) => {
  const names = ['good.html', 'deep-nesting.html']
  const { code, report } = await runJson(t, names.map(fixtureUrl))
  assert.equal(code, 0)
  assert.equal(report.pages[1].status, 200)
  assert.equal(report.pages[1].facts.title, 'Deep')
  assert.ok(report.pages.every((p) => !pageTypes(p).includes('check-failed')))
})

test('cli: a page over 2 MB is checked the way Googlebot reads it, only the first 2 MB', async (t) => {
  const { report } = await runJson(t, [fixtureUrl('too-large.html')])
  const types = pageTypes(report.pages[0])
  assert.ok(types.includes('html-too-large'), types)
  assert.ok(types.includes('missing-h1'), types)
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

test('cli: a huge sitemap is read and --limit still applies to it', async (t) => {
  const urls = Array.from({ length: 150_000 }, (_, i) => `<url><loc>https://big.test/p/${i}</loc></url>`).join('')
  const xml = (body) => new Response(body, { headers: { 'content-type': 'application/xml' } })
  mockFetch(t, async (input) => {
    const { pathname } = new URL(input)
    if (pathname === '/index.xml')
      return xml('<sitemapindex><sitemap><loc>https://big.test/all.xml</loc></sitemap></sitemapindex>')
    if (pathname === '/all.xml') return xml(`<urlset>${urls}</urlset>`)
    if (pathname === '/robots.txt') return new Response('', { status: 404 })
    return new Response('<html lang="en"><head><title>Page</title></head><body></body></html>', {
      headers: { 'content-type': 'text/html' }
    })
  })
  const stdout = []
  t.mock.method(console, 'log', (...a) => stdout.push(a.join(' ')))
  t.mock.method(console, 'error', () => {})
  const code = await run(['--sitemap', 'https://big.test/index.xml', '--limit', '1', '--delay', '0', '--json'])
  assert.notEqual(code, 2)
  const report = JSON.parse(stdout.join('\n'))
  assert.deepEqual(
    report.pages.map((page) => page.url),
    ['https://big.test/p/0']
  )
  assert.equal(report.skipped.length, 0)
  const tooMany = report.site.find((issue) => issue.type === 'sitemap-too-many-urls')
  assert.deepEqual(tooMany.urls, ['https://big.test/all.xml'])
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

test('cli: a sitemap given twice, or given and also listed by an index, is read once', async (t) => {
  const index = fixtureUrl('sitemap-index.xml')
  const { report } = await runJson(t, ['--sitemap', index, '--sitemap', fixtureUrl('sitemap.xml'), '--sitemap', index])
  const requested = globalThis.fetch.mock.calls.map((call) => String(call.arguments[0]))
  assert.deepEqual(
    requested.filter((url) => url.endsWith('.xml')),
    ['sitemap-index.xml', 'sitemap.xml', 'sitemap-nested-index.xml', 'missing-sitemap.xml'].map(fixtureUrl)
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

const fakeLighthouse = (results) => async (urls) => results.slice(0, urls.length)

test('cli: --lighthouse with no page that returned HTML says in the coverage that it did not run', async (t) => {
  const lighthouse = async () => assert.fail('Lighthouse ran without a page to run on')
  const { report } = await runJson(t, [fixtureUrl('missing-page'), '--lighthouse'], { lighthouse })
  const notRun = { check: 'lighthouse', reason: 'no page it was asked for returned HTML' }
  assert.deepEqual(report.coverage.notRun[0], notRun)
  // Another page returned HTML, but Lighthouse was only asked for the one that did not.
  const mixed = await runJson(t, [fixtureUrl('good.html'), '--lighthouse-page', fixtureUrl('missing-page')], {
    lighthouse
  })
  assert.deepEqual(mixed.report.coverage.notRun[0], notRun)
})

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

const detailedSummary = {
  scores: { seo: 90 },
  metrics: {},
  audits: [
    {
      id: 'x',
      category: 'seo',
      title: 'X',
      score: 0,
      displayValue: null,
      description: 'Why x matters.',
      learnMore: 'https://x.test/',
      savings: { ms: 5 },
      items: [{ url: 'a.js' }]
    }
  ],
  warnings: []
}
const lighthouseFor = (seen) => async (list) => (seen.push(...list), list.map(() => ({ summary: detailedSummary })))

test('cli: --lighthouse-page runs only those pages, adds them to the audit, and the report keeps the detail', async (t) => {
  const seen = []
  const args = [fixtureUrl('good.html'), '--lighthouse-page', fixtureUrl('bad-overlong.html')]
  const { report } = await runJson(t, args, { lighthouse: lighthouseFor(seen) })
  assert.deepEqual(seen, [fixtureUrl('bad-overlong.html')])
  assert.equal(report.pages.length, 2)
  assert.equal('lighthouse' in report.pages[0], false)
  assert.deepEqual(report.pages[1].lighthouse.audits[0].items, [{ url: 'a.js' }])
  assert.deepEqual(report.lighthouseAudits, { x: { description: 'Why x matters.', learnMore: 'https://x.test/' } })
  assert.equal('description' in report.pages[1].lighthouse.audits[0], false)
})

test('cli: --lighthouse with --lighthouse-page gives the others the short summary, and no pick gives all detail', async (t) => {
  const both = [fixtureUrl('good.html'), fixtureUrl('bad-overlong.html'), '--lighthouse']
  const picked = await runJson(t, [...both, '--lighthouse-page', fixtureUrl('bad-overlong.html')], {
    lighthouse: lighthouseFor([])
  })
  assert.deepEqual(Object.keys(picked.report.pages[0].lighthouse.audits[0]), [
    'id',
    'category',
    'title',
    'score',
    'displayValue'
  ])
  assert.deepEqual(picked.report.pages[1].lighthouse.audits[0].items, [{ url: 'a.js' }])
  const plain = await runJson(t, both, { lighthouse: lighthouseFor([]) })
  assert.deepEqual(plain.report.pages[0].lighthouse.audits[0].items, [{ url: 'a.js' }])
})

test('cli: a urls file marker picks the page, and --limit does not drop it', async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'urls.txt')
  await writeFile(file, `${fixtureUrl('good.html')}\n${fixtureUrl('bad-overlong.html')} lighthouse\n`)
  const seen = []
  const { report } = await runJson(t, ['--urls-file', file, '--limit', '1'], { lighthouse: lighthouseFor(seen) })
  assert.deepEqual(seen, [fixtureUrl('bad-overlong.html')])
  assert.equal(report.pages.length, 2)
})

test('cli: --lighthouse-page alone audits that one page', async (t) => {
  const seen = []
  const { code, report } = await runJson(t, ['--lighthouse-page', fixtureUrl('good.html')], {
    lighthouse: lighthouseFor(seen)
  })
  assert.equal(code, 0)
  assert.deepEqual(seen, [fixtureUrl('good.html')])
  assert.equal(report.pages.length, 1)
})

test('cli: the limit message counts the pages picked for Lighthouse separately', async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'urls.txt')
  const lines = ['good.html', 'bad-missing.html', 'bad-overlong.html', 'bad-images.html', 'duplicate.html']
  await writeFile(file, lines.map((name, i) => `${fixtureUrl(name)}${i === 4 ? ' lighthouse' : ''}`).join('\n'))
  const { report, stderr } = await runJson(t, ['--urls-file', file, '--limit', '2'], {
    lighthouse: lighthouseFor([])
  })
  assert.equal(report.pages.length, 3)
  assert.match(stderr, /Auditing the first 2 of 5 URLs \(--limit 2\), plus 1 picked for Lighthouse\./)
})

test('cli: a picked page that gives no HTML says so instead of losing Lighthouse silently', async (t) => {
  const seen = []
  const args = [
    fixtureUrl('good.html'),
    '--lighthouse-page',
    fixtureUrl('not-html'),
    '--lighthouse-page',
    fixtureUrl('missing-page')
  ]
  const { report } = await runJson(t, args, { lighthouse: lighthouseFor(seen) })
  assert.deepEqual(seen, [])
  for (const page of report.pages.slice(1)) {
    const failed = page.issues.find((i) => i.type === 'lighthouse-failed')
    assert.match(failed.message, /the page did not return HTML/)
    assert.equal('lighthouse' in page, false)
  }
})

test('cli: only picked pages get the full detail, also when an unpicked page redirects to the same final URL', async (t) => {
  const args = [fixtureUrl('redirect-once'), '--lighthouse-page', fixtureUrl('good.html'), '--lighthouse']
  const { report } = await runJson(t, args, { lighthouse: lighthouseFor([]) })
  const [redirected, picked] = report.pages.map((p) => p.lighthouse.audits[0])
  assert.deepEqual(Object.keys(redirected), ['id', 'category', 'title', 'score', 'displayValue'])
  assert.deepEqual(picked.items, [{ url: 'a.js' }])
})

test('cli: a marker in a urls file read from stdin picks the page', async (t) => {
  const stdin = Readable.from([`${fixtureUrl('good.html')}\n${fixtureUrl('bad-missing.html')}  lighthouse\n`])
  const seen = []
  await runJson(t, ['--urls-file', '-'], { stdin, lighthouse: lighthouseFor(seen) })
  assert.deepEqual(seen, [fixtureUrl('bad-missing.html')])
})

test('cli: slow Lighthouse numbers become warnings that count for --fail-on warning but not for the default exit code', async (t) => {
  const slow = { ...detailedSummary, scores: { performance: 40, seo: 95 }, metrics: { lcp: 4500, cls: 0.05, tbt: 100 } }
  const lighthouse = async (list) => list.map(() => ({ summary: slow }))
  const args = [fixtureUrl('good.html'), '--lighthouse']
  const normal = await runJson(t, args, { lighthouse })
  assert.equal(normal.code, 0)
  assert.deepEqual(pageTypes(normal.report.pages[0]), ['lcp-slow', 'score-low-performance'])
  assert.ok('lcp-slow' in normal.report.rules)
  const strict = await runJson(t, [...args, '--fail-on', 'warning'], { lighthouse })
  assert.equal(strict.code, 1)
})

test('cli: slow numbers also become issues for pages with the short summary, and for inputs sharing a final URL', async (t) => {
  const slow = { ...detailedSummary, scores: { performance: 40 }, metrics: { lcp: 4500 } }
  const lighthouse = async (list) => list.map(() => ({ summary: slow }))
  const args = [fixtureUrl('redirect-once'), fixtureUrl('good.html'), fixtureUrl('bad-overlong.html')]
  const { report } = await runJson(t, [...args, '--lighthouse', '--lighthouse-page', fixtureUrl('bad-overlong.html')], {
    lighthouse
  })
  const lcpIssues = report.pages.map((p) => p.issues.filter((i) => i.type === 'lcp-slow').length)
  assert.deepEqual(lcpIssues, [1, 1, 1])
  const ids = report.pages.flatMap((p) => p.issues.filter((i) => i.type === 'lcp-slow').map((i) => i.id))
  assert.equal(new Set(ids).size, 3)
})

test('cli: --lighthouse-runs without any Lighthouse run says it has no effect', async (t) => {
  const { stderr } = await runJson(t, [fixtureUrl('good.html'), '--lighthouse-runs', '3'])
  assert.match(stderr, /--lighthouse-runs has no effect/)
})

test('cli: --lighthouse-runs reaches the runner, 1 without it, and must be a number from 1 to 9', async (t) => {
  let runs
  const lighthouse = async (list, options) => ((runs = options.runs), list.map(() => ({ summary: detailedSummary })))
  await runJson(t, [fixtureUrl('good.html'), '--lighthouse', '--lighthouse-runs', '3'], { lighthouse })
  assert.equal(runs, 3)
  // The progress bar divides by the runs, so they are a number also when not given.
  await runJson(t, [fixtureUrl('good.html'), '--lighthouse'], { lighthouse })
  assert.equal(runs, 1)
  for (const bad of ['0', '10', 'x']) {
    const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), '--lighthouse-runs', bad])
    assert.equal(code, 2)
    assert.match(stderr, /--lighthouse-runs must be a whole number from 1 to 9/)
  }
})

test('cli: --lighthouse-page needs a value', async (t) => {
  const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), '--lighthouse-page', ''])
  assert.equal(code, 2)
  assert.match(stderr, /--lighthouse-page needs a value/)
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

test('cli: --digest writes the digest of the report, naming the report relative to itself', async (t) => {
  const dir = await tempDir(t)
  const [out, digestPath] = [join(dir, 'full', 'report.json'), join(dir, 'report.digest.json')]
  await mkdir(join(dir, 'full'))
  const args = [fixtureUrl('good.html'), fixtureUrl('bad-missing.html'), '--json', '--out', out, '--digest', digestPath]
  const { stdout, stderr } = await runCli(t, args)
  const digest = JSON.parse(await readFile(digestPath, 'utf8'))
  assert.deepEqual(digest, buildDigest(JSON.parse(stdout), { reportPath: join('full', 'report.json') }))
  assert.equal(stderr, `JSON report written to ${out}\nDigest written to ${digestPath}`)
  const alone = join(dir, 'alone.json')
  await runCli(t, [fixtureUrl('good.html'), '--json', '--digest', alone])
  assert.equal(JSON.parse(await readFile(alone, 'utf8')).report.path, null)
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

test('cli: --out or --html naming a directory exits 2 before any page is fetched', async (t) => {
  const dir = await tempDir(t)
  const fetchMock = mockFixtureFetch(t)
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  assert.equal(await run([fixtureUrl('good.html'), '--out', dir, '--html', `${dir}/`, '--json']), 2)
  assert.equal(errors.length, 1)
  assert.ok(errors[0].includes(`--out needs a file path, but "${dir}" is a directory (for example ${dir}/report.json)`))
  assert.ok(
    errors[0].includes(`--html needs a file path, but "${dir}/" is a directory (for example ${dir}/report.html)`)
  )
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('cli: --out and --html naming the same file exit 2 before any page is fetched', async (t) => {
  const dir = await tempDir(t)
  await symlink(dir, join(dir, 'link'))
  const fetchMock = mockFixtureFetch(t)
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  const message = '--out and --html name the same file, give each report its own'
  for (const html of [join(dir, 'r.json'), join(dir, 'link', 'r.json')]) {
    errors.length = 0
    assert.equal(await run([fixtureUrl('good.html'), '--out', join(dir, 'r.json'), '--html', html, '--json']), 2)
    assert.deepEqual(errors, [message])
  }
  assert.equal(fetchMock.mock.callCount(), 0)
  await assert.rejects(readFile(join(dir, 'r.json')), { code: 'ENOENT' })
})

test('cli: --digest naming a directory or the --out file exits 2 before any page is fetched', async (t) => {
  const dir = await tempDir(t)
  const fetchMock = mockFixtureFetch(t)
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  assert.equal(await run([fixtureUrl('good.html'), '--digest', dir, '--json']), 2)
  assert.deepEqual(errors, [
    `--digest needs a file path, but "${dir}" is a directory (for example ${dir}/report.digest.json)`
  ])
  errors.length = 0
  const json = join(dir, 'r.json')
  assert.equal(await run([fixtureUrl('good.html'), '--out', json, '--digest', json, '--json']), 2)
  assert.deepEqual(errors, ['--out and --digest name the same file, give each report its own'])
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('cli: --out and --html naming two hard links to one file exit 2 and leave it as it was', async (t) => {
  const dir = await tempDir(t)
  const [json, html] = [join(dir, 'r.json'), join(dir, 'r.html')]
  await writeFile(json, 'old')
  await link(json, html)
  const fetchMock = mockFixtureFetch(t)
  const errors = []
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')))
  assert.equal(await run([fixtureUrl('good.html'), '--out', json, '--html', html, '--json']), 2)
  assert.deepEqual(errors, ['--out and --html name the same file, give each report its own'])
  assert.equal(fetchMock.mock.callCount(), 0)
  assert.equal(await readFile(json, 'utf8'), 'old')
})

test('cli: --html to an unwritable path exits 2', async (t) => {
  const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), '--html', '/no/such/dir/r.html', '--json'])
  assert.equal(code, 2)
  assert.match(stderr, /Could not write \/no\/such\/dir\/r.html: ENOENT/)
  assert.doesNotMatch(stderr, /written/)
})

test('cli: says where each report file was written, on stderr', async (t) => {
  const dir = await tempDir(t)
  const [json, html] = [join(dir, 'r.json'), join(dir, 'r.html')]
  const { stdout, stderr } = await runCli(t, [fixtureUrl('good.html'), '--json', '--out', json, '--html', html])
  assert.equal(stderr, `JSON report written to ${json}\nHTML report written to ${html}`)
  assert.equal(JSON.parse(stdout).summary.pages, 1)
})

test('cli: says which report files were written when another one failed', async (t) => {
  const json = join(await tempDir(t), 'r.json')
  const args = [fixtureUrl('good.html'), '--json', '--out', json, '--html', '/no/such/dir/r.html']
  const { code, stderr } = await runCli(t, args)
  assert.equal(code, 2)
  assert.equal(stderr, `JSON report written to ${json}\nCould not write /no/such/dir/r.html: ENOENT`)
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

test('cli: empty --digest, --content, --html, --title, --client and --logo values are usage errors', async (t) => {
  for (const option of ['--digest', '--content', '--html', '--title', '--client', '--logo']) {
    const { code, stderr } = await runCli(t, [fixtureUrl('good.html'), option, '', '--json'])
    assert.equal(code, 2)
    assert.match(stderr, new RegExp(`${option} needs a value`))
  }
})

test('cli: --content writes the main content of each page that returned HTML and says where', async (t) => {
  const dir = join(await tempDir(t), 'content')
  const { code, stderr } = await runCli(t, [
    fixtureUrl('good.html'),
    fixtureUrl('rich.html'),
    fixtureUrl('missing.html'),
    '--content',
    dir,
    '--json'
  ])
  assert.equal(code, 1)
  assert.match(stderr, new RegExp(`Page content written to ${dir} \\(2 files\\)`))
  assert.deepEqual((await readdir(dir)).sort(), ['fixtures.test_good.html.md', 'fixtures.test_rich.html.md'])
  const good = await readFile(join(dir, 'fixtures.test_good.html.md'), 'utf8')
  assert.match(good, /^---\ngenerator: "pageaudit"\nurl: "https:\/\/fixtures\.test\/good\.html"\n/)
})

test('cli: the report and the digest name each content file relative to themselves', async (t) => {
  const dir = await tempDir(t)
  await mkdir(join(dir, 'full'))
  const out = join(dir, 'full', 'report.json')
  const digestPath = join(dir, 'report.digest.json')
  const args = [fixtureUrl('good.html'), fixtureUrl('missing.html'), '--content', join(dir, 'content')]
  const { stdout } = await runCli(t, [...args, '--out', out, '--digest', digestPath, '--json'])
  const file = 'fixtures.test_good.html.md'
  const report = JSON.parse(await readFile(out, 'utf8'))
  assert.deepEqual(
    report.pages.map((page) => page.content),
    [join('..', 'content', file), undefined]
  )
  assert.deepEqual(JSON.parse(stdout).pages[0].content, join('..', 'content', file))
  const digest = JSON.parse(await readFile(digestPath, 'utf8'))
  assert.deepEqual(
    digest.pages.map((page) => page.content),
    [join('content', file), undefined]
  )
  assert.equal(
    await readFile(join(dir, 'full', report.pages[0].content), 'utf8'),
    await readFile(join(dir, digest.pages[0].content), 'utf8')
  )
  t.mock.restoreAll()
  const printed = await runJson(t, args)
  assert.equal(printed.report.pages[0].content, relative(process.cwd(), join(dir, 'content', file)))
})

test('cli: --content replaces the files of an earlier run and leaves other files alone', async (t) => {
  const dir = await tempDir(t)
  await runCli(t, [fixtureUrl('good.html'), '--content', dir, '--json'])
  await writeFile(join(dir, 'notes.md'), '# Notes\n')
  t.mock.restoreAll()
  await runCli(t, [fixtureUrl('rich.html'), '--content', dir, '--json'])
  assert.deepEqual((await readdir(dir)).sort(), ['fixtures.test_rich.html.md', 'notes.md'])
})

test('cli: a report written into the --content folder keeps its name', async (t) => {
  const dir = await tempDir(t)
  const out = join(dir, 'fixtures.test_good.html.md')
  await runCli(t, [fixtureUrl('good.html'), '--content', dir, '--out', out, '--json'])
  const report = JSON.parse(await readFile(out, 'utf8'))
  assert.equal(report.pages[0].content, 'fixtures.test_good.html-2.md')
  assert.match(await readFile(join(dir, report.pages[0].content), 'utf8'), /^---\ngenerator: "pageaudit"/)
})

test('cli: --content leaves an earlier run alone when the inputs cannot be read', async (t) => {
  const dir = await tempDir(t)
  await runCli(t, [fixtureUrl('good.html'), '--content', dir, '--json'])
  t.mock.restoreAll()
  const { code } = await runCli(t, ['--urls-file', join(dir, 'missing.txt'), '--content', dir, '--json'])
  assert.equal(code, 2)
  assert.deepEqual(await readdir(dir), ['fixtures.test_good.html.md'])
})

test('cli: a --content file that cannot be written fails the run after the audit', async (t) => {
  const dir = await tempDir(t)
  await chmod(dir, 0o555)
  const { code, stdout, stderr } = await runCli(t, [fixtureUrl('good.html'), '--content', dir, '--json'])
  assert.equal(code, 2)
  assert.match(stderr, /Could not write .*fixtures\.test_good\.html\.md: EACCES/)
  assert.equal(JSON.parse(stdout).summary.pages, 1)
})

test('cli: --content refuses a file and a path a report also names, before the audit', async (t) => {
  const dir = await tempDir(t)
  const file = join(dir, 'taken')
  await writeFile(file, 'x')
  const asFile = await runCli(t, [fixtureUrl('good.html'), '--content', file, '--json'])
  assert.equal(asFile.code, 2)
  assert.match(asFile.stderr, /--content needs a folder, but ".*taken" is a file/)
  assert.equal(asFile.stdout, '')
  const shared = join(dir, 'shared')
  const same = await runCli(t, [fixtureUrl('good.html'), '--content', shared, '--out', shared, '--json'])
  assert.equal(same.code, 2)
  assert.match(same.stderr, /--out and --content name the same path/)
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

test('cli: a page robots.txt keeps from an AI search crawler is reported, and origins says which crawlers', async (t) => {
  const dir = await tempDir(t)
  const digestPath = join(dir, 'digest.json')
  const { code, report } = await runJson(t, [
    fixtureUrl('good.html'),
    fixtureUrl('ai-blocked.html'),
    '--digest',
    digestPath
  ])
  assert.equal(code, 0)
  assert.deepEqual(
    report.site.map(({ type, severity, context, urls, source }) => ({ type, severity, context, urls, source })),
    [
      {
        type: 'ai-search-blocked',
        severity: 'warning',
        context: 'https://fixtures.test/robots.txt disallows OAI-SearchBot',
        urls: [fixtureUrl('ai-blocked.html')],
        source: 'https://developers.openai.com/api/docs/bots'
      }
    ]
  )
  assert.equal(
    report.site[0].message,
    'robots.txt does not allow OAI-SearchBot to crawl the page, so ChatGPT search cannot use it in answers'
  )
  const partial = {
    ...FIXTURE_ORIGIN,
    aiSearch: { ...FIXTURE_ORIGIN.aiSearch, 'OAI-SearchBot': 'partial' },
    aiTraining: { ...FIXTURE_ORIGIN.aiTraining, GPTBot: 'partial' }
  }
  assert.deepEqual(report.origins, [partial])
  assert.ok(report.rules['ai-search-blocked'].fix.includes('OAI-SearchBot'))
  assert.deepEqual(JSON.parse(await readFile(digestPath, 'utf8')).origins, [partial])
})

test('cli: snippet rules from the meta tag and the X-Robots-Tag header become issues and facts', async (t) => {
  const { code, report } = await runJson(t, [fixtureUrl('snippets.html')])
  assert.equal(code, 0)
  const [page] = report.pages
  assert.deepEqual(
    page.issues.map(({ type, severity, context, source }) => ({ type, severity, context, source })),
    [
      {
        type: 'snippet-restricted',
        severity: 'warning',
        context: 'X-Robots-Tag: googlebot: nosnippet',
        source: 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag'
      },
      {
        type: 'copilot-restricted',
        severity: 'warning',
        context: '<meta name="robots" content="noarchive">',
        source:
          'https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat'
      }
    ]
  )
  assert.equal(page.facts.robots, 'noarchive')
  assert.equal(page.facts.robotsHeader, 'googlebot: nosnippet')
  assert.ok(report.rules['copilot-restricted'].fix.includes('noarchive'))
})

test('cli: the facts say who made a page and when, from JSON-LD, its tags and its headers', async (t) => {
  const { report } = await runJson(t, [fixtureUrl('article.html')])
  const facts = (name) => report.pages.find((page) => page.url === fixtureUrl(name)).facts
  const article = facts('article.html')
  assert.deepEqual(
    article.jsonLd.map(({ types, name, authors, publisher }) => [types, name, authors, publisher]),
    [
      [['Article'], 'How to wash your hair', ['Maija Mallikas'], 'Example Store'],
      [['Person'], 'Maija Mallikas', [], null],
      [['Organization'], 'Example Store', [], null]
    ]
  )
  // The JSON-LD date wins over the article:published_time tag.
  assert.deepEqual(article.dates, {
    published: '2026-03-02T09:00:00+02:00',
    modified: '2026-09-15T12:30:00+03:00',
    lastModified: 'Mon, 19 Oct 2026 10:00:00 GMT'
  })
  assert.equal(article.author, 'Maija Mallikas')
})

test('cli: pages that are not listed in a sitemap get no sitemap issues and allowed pages are not blocked', async (t) => {
  const { report } = await runJson(t, [fixtureUrl('noindex.html'), fixtureUrl('bad-canonical.html')])
  assert.ok(report.site.every((issue) => !issue.type.startsWith('sitemap-')))
  assert.ok(report.site.every((issue) => issue.type !== 'blocked-by-robots'))
})

// Answers requests from a map of path to body, or to a function that returns the Response, and counts them. Other
// paths are 404.
function mockSite(t, files) {
  const requests = []
  mockFetch(t, async (input) => {
    const { pathname } = new URL(input)
    requests.push(pathname)
    if (!(pathname in files)) return new Response('Not found', { status: 404 })
    if (typeof files[pathname] === 'function') return files[pathname]()
    const type = pathname.endsWith('.xml') ? 'application/xml' : pathname.endsWith('.txt') ? 'text/plain' : 'text/html'
    return new Response(files[pathname], { headers: { 'content-type': type } })
  })
  return requests
}

const PAGE = '<html lang="en"><head><title>Page</title></head><body></body></html>'

test('cli: a sitemap with no usable URLs is still validated', async (t) => {
  mockSite(t, {
    '/s.xml': '<urlset><url><loc/><lastmod>soon</lastmod></url><url><loc>https://</loc></url></urlset>'
  })
  const stdout = []
  const stderr = []
  t.mock.method(console, 'log', (...a) => stdout.push(a.join(' ')))
  t.mock.method(console, 'error', (...a) => stderr.push(a.join(' ')))
  const code = await run(['--sitemap', 'https://a.test/s.xml', '--json', '--delay', '0'])
  assert.notEqual(code, 2)
  const report = JSON.parse(stdout.join('\n'))
  assert.match(stderr.join('\n'), /only the sitemap files were checked/)
  assert.equal(report.summary.pages, 0)
  assert.deepEqual(report.site.map((issue) => issue.type).sort(), [
    'sitemap-empty-loc',
    'sitemap-invalid-lastmod',
    'sitemap-loc-malformed'
  ])
})

test('cli: no-sitemap-declared is reported, unless --sitemap was used, and robots.txt is read once per origin', async (t) => {
  const requests = mockSite(t, {
    '/robots.txt': 'User-agent: *\nAllow: /',
    '/a': PAGE,
    '/b': PAGE,
    '/s.xml': '<urlset><url><loc>https://a.test/a</loc></url></urlset>'
  })
  const plain = await runCliWithMock(t, ['https://a.test/a', 'https://a.test/b'])
  assert.ok(plain.report.site.some((issue) => issue.type === 'no-sitemap-declared'))
  assert.equal(requests.filter((path) => path === '/robots.txt').length, 1)
  const withSitemap = await runCliWithMock(t, ['--sitemap', 'https://a.test/s.xml'])
  assert.ok(withSitemap.report.site.every((issue) => issue.type !== 'no-sitemap-declared'))
})

async function runCliWithMock(t, args) {
  const stdout = []
  t.mock.method(console, 'log', (...a) => stdout.push(a.join(' ')))
  t.mock.method(console, 'error', () => {})
  const code = await run([...args, '--json', '--delay', '0'])
  return { code, report: JSON.parse(stdout.join('\n')) }
}

test('cli: hreflang pages are checked on their own and against each other', async (t) => {
  const en = fixtureUrl('hreflang.html')
  const fi = fixtureUrl('hreflang-fi.html')
  const { report } = await runJson(t, [en, fi])
  assert.deepEqual(pageTypes(report.pages[0]), [])
  assert.deepEqual(pageTypes(report.pages[1]), ['missing-x-default', 'noindex'])
  assert.deepEqual(report.pages[1].facts.hreflang, [{ lang: 'fi', href: fi }])
  assert.deepEqual(
    report.site.filter((issue) => issue.type.startsWith('hreflang-')).map((issue) => [issue.type, issue.urls]),
    [
      ['hreflang-missing-return', [en, fi]],
      ['hreflang-target-noindex', [fi, en]]
    ]
  )
  assert.ok(report.rules['hreflang-missing-return'].title)
})

test('cli: response headers are judged once per origin, and the secure fixture defaults pass', async (t) => {
  const weak = fixtureUrl('weak-headers.html')
  const { code, report } = await runJson(t, [fixtureUrl('good.html'), weak])
  assert.equal(code, 0)
  assert.deepEqual(pageTypes(report.pages[1]), [])
  assert.deepEqual(
    report.site.map((issue) => [issue.type, issue.severity, issue.urls]),
    [
      ['missing-hsts', 'warning', [weak]],
      ['missing-x-content-type-options', 'info', [weak]],
      ['missing-clickjacking-protection', 'info', [weak]],
      ['weak-csp', 'info', [weak]],
      ['no-compression', 'info', [weak]]
    ]
  )
  assert.equal(
    report.site.find((issue) => issue.type === 'weak-csp').message,
    "Content-Security-Policy allows inline scripts ('unsafe-inline' without a nonce or hash) and eval ('unsafe-eval')"
  )
  assert.ok(report.pages.every((page) => !('response' in page)))
})

test('cli: --check-links reports broken, unreachable and redirecting internal links, without it no link is requested', async (t) => {
  const links = fixtureUrl('links.html')
  const plain = await runJson(t, [fixtureUrl('good.html'), links])
  assert.ok(plain.report.site.every((issue) => !/link|orphan/.test(issue.type)))
  t.mock.restoreAll()
  const fetchMock = mockFixtureFetch(t)
  const stdout = []
  t.mock.method(console, 'log', (...a) => stdout.push(a.join(' ')))
  t.mock.method(console, 'error', () => {})
  const code = await run([fixtureUrl('good.html'), links, '--check-links', '--json', '--delay', '0'])
  const report = JSON.parse(stdout.join('\n'))
  assert.equal(code, 0)
  const long = `${FIXTURE_HOST}/${'long-'.repeat(420)}end`
  assert.deepEqual(
    report.site.filter((issue) => /link/.test(issue.type)).map((issue) => [issue.type, issue.urls]),
    [
      ['broken-link', [links]],
      ['link-to-redirect', [links]],
      ['link-target-unreachable', [links]],
      ['link-target-unreachable', [links]],
      ['broken-link', [links]]
    ]
  )
  assert.match(
    report.site.find((issue) => issue.type === 'link-to-redirect').context,
    /redirect-once -> .*good\.html \(301\)/
  )
  // The link to the audited good.html is not requested again: its two requests are the audit and the end of
  // /redirect-once. The external link is not requested, and the long address is requested whole.
  const requested = fetchMock.mock.calls.map((call) => String(call.arguments[0]))
  assert.equal(requested.filter((url) => url === fixtureUrl('good.html')).length, 2)
  assert.ok(requested.includes(long))
  assert.ok(!requested.some((url) => url.includes('external.test')))
})

test('cli: --check-links reports orphan pages only when a whole sitemap was audited', async (t) => {
  const page = (body) => `<html lang="en"><head><title>Page</title></head><body>${body}</body></html>`
  mockSite(t, {
    '/robots.txt': 'User-agent: *\nAllow: /',
    '/s.xml':
      '<urlset><url><loc>https://a.test/</loc></url><url><loc>https://a.test/a</loc></url><url><loc>https://a.test/b</loc></url></urlset>',
    '/': page('<a href="/a">A</a>'),
    '/a': page('<a href="/">Home</a>'),
    '/b': page('<a href="/a">A</a>'),
    '/index.xml':
      '<sitemapindex><sitemap><loc>https://a.test/s.xml</loc></sitemap><sitemap><loc>https://a.test/gone.xml</loc></sitemap></sitemapindex>'
  })
  const orphans = (report) => report.site.filter((issue) => issue.type === 'orphan-page').map((issue) => issue.urls)
  // Why the report has no orphan pages, when the check did not run.
  const notRun = ({ coverage }) => coverage.notRun.find((entry) => entry.check === 'orphan-page')?.reason
  const whole = await runCliWithMock(t, ['--sitemap', 'https://a.test/s.xml', '--check-links'])
  assert.deepEqual(orphans(whole.report), [['https://a.test/b']])
  assert.equal(notRun(whole.report), undefined)
  assert.deepEqual(whole.report.coverage.links, { checked: 0, unchecked: 0, complete: true })
  assert.deepEqual(whole.report.coverage.urls, { found: 3, audited: 3, sitemapsComplete: true })
  const cut = await runCliWithMock(t, ['--sitemap', 'https://a.test/s.xml', '--check-links', '--limit', '2'])
  assert.deepEqual(orphans(cut.report), [])
  assert.equal(notRun(cut.report), 'only 2 of 3 URLs were audited')
  const listed = await runCliWithMock(t, ['https://a.test/', 'https://a.test/b', '--check-links'])
  assert.deepEqual(orphans(listed.report), [])
  assert.equal(notRun(listed.report), 'needs a --sitemap, the list of pages that should be linked')
  // The index lists a sitemap that cannot be read, so pages linking to /b may be missing from the audit.
  const incomplete = await runCliWithMock(t, ['--sitemap', 'https://a.test/index.xml', '--check-links'])
  assert.equal(incomplete.report.summary.pages, 3)
  assert.deepEqual(orphans(incomplete.report), [])
  assert.equal(notRun(incomplete.report), 'a sitemap file could not be read, so pages may be missing from the list')
  assert.equal(incomplete.report.coverage.urls.sitemapsComplete, false)
})

test('cli: --check-links does not report orphan pages when a sitemap page could not be read', async (t) => {
  const page = (body) => `<html lang="en"><head><title>Page</title></head><body>${body}</body></html>`
  mockSite(t, {
    '/robots.txt': 'User-agent: *\nAllow: /',
    '/s.xml': '<urlset><url><loc>https://a.test/a</loc></url><url><loc>https://a.test/b</loc></url></urlset>',
    '/a': page('<a href="/b">B</a>'),
    // A server error: the links of /b, maybe one to /a, are unknown.
    '/b': () => new Response('down', { status: 503 })
  })
  const { report } = await runCliWithMock(t, ['--sitemap', 'https://a.test/s.xml', '--check-links'])
  assert.equal(report.summary.pages, 2)
  assert.ok(report.site.every((issue) => issue.type !== 'orphan-page'))
  assert.deepEqual(report.coverage.notRun, [
    { check: 'lighthouse', reason: 'not asked for (--lighthouse or --lighthouse-page)' },
    { check: 'orphan-page', reason: 'where some links lead, or which links some pages have, is not known' }
  ])
  assert.equal(report.coverage.links.complete, false)
})

test('cli: --check-links reads the links of a sitemap page nested deeper than Chrome parses', async (t) => {
  const page = (body) => `<html lang="en"><head><title>Page</title></head><body>${body}</body></html>`
  const deep = 10000
  mockSite(t, {
    '/robots.txt': 'User-agent: *\nAllow: /',
    '/s.xml': '<urlset><url><loc>https://a.test/a</loc></url><url><loc>https://a.test/b</loc></url></urlset>',
    // The only link to /b is on a page nested far past Chrome's limit, so /b is not an orphan.
    '/a': page(`${'<span>'.repeat(deep)}<a href="/b">B</a>${'</span>'.repeat(deep)}`),
    '/b': page('<a href="/a">A</a>')
  })
  const { report } = await runCliWithMock(t, ['--sitemap', 'https://a.test/s.xml', '--check-links'])
  assert.ok(report.pages.every((p) => !pageTypes(p).includes('check-failed')))
  assert.ok(report.site.every((issue) => issue.type !== 'orphan-page'))
})

test('cli: --check-links does not report orphan pages when a sitemap page was cut at 2 MB', async (t) => {
  const page = (body) => `<html lang="en"><head><title>Page</title></head><body>${body}</body></html>`
  mockSite(t, {
    '/robots.txt': 'User-agent: *\nAllow: /',
    '/s.xml': '<urlset><url><loc>https://a.test/a</loc></url><url><loc>https://a.test/b</loc></url></urlset>',
    // The only link to /b comes after the first 2 MB of /a, so it is never read.
    '/a': page(`<p>${'word '.repeat(450_000)}</p><a href="/b">B</a>`),
    '/b': page('<a href="/a">A</a>')
  })
  const { report } = await runCliWithMock(t, ['--sitemap', 'https://a.test/s.xml', '--check-links'])
  assert.deepEqual(
    report.pages.map((p) => pageTypes(p).includes('html-too-large')),
    [true, false]
  )
  assert.ok(report.site.every((issue) => issue.type !== 'orphan-page'))
})

test('cli: --delay spaces every request to a host: sitemaps, pages, redirect hops, robots.txt and links', async (t) => {
  const page = (body) => `<html lang="en"><head><title>Page</title></head><body>${body}</body></html>`
  const files = {
    '/s.xml': '<urlset><url><loc>https://a.test/a</loc></url><url><loc>https://a.test/old</loc></url></urlset>',
    '/a': page('<a href="/b">B</a><a href="/moved">Moved</a>'),
    '/b': page(''),
    '/new': page(''),
    '/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://a.test/s.xml'
  }
  const redirects = { '/old': '/new', '/moved': '/b' }
  const starts = []
  mockFetch(t, async (input) => {
    const { pathname } = new URL(input)
    starts.push({ pathname, at: performance.now() })
    if (redirects[pathname]) return new Response(null, { status: 301, headers: { location: redirects[pathname] } })
    const type = pathname.endsWith('.xml') ? 'application/xml' : pathname.endsWith('.txt') ? 'text/plain' : 'text/html'
    return new Response(files[pathname], { headers: { 'content-type': type } })
  })
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  await run(['--sitemap', 'https://a.test/s.xml', '--check-links', '--delay', '40', '--json'])
  assert.deepEqual(
    starts.map((s) => s.pathname),
    ['/s.xml', '/a', '/old', '/new', '/robots.txt', '/b', '/moved', '/b']
  )
  // A little under 40 ms of slack: timers can fire a millisecond early against performance.now().
  const gaps = starts.slice(1).map((s, i) => Math.round(s.at - starts[i].at))
  assert.ok(
    gaps.every((gap) => gap >= 38),
    `gaps ${gaps.join(', ')}`
  )
})
