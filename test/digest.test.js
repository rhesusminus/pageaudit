import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adviceFor } from '../src/advice.js'
import { buildDigest } from '../src/digest.js'
import { buildReport } from '../src/report.js'
import { auditLine, lhBlock } from './helpers/report-pages.js'

const missingAlt = (url, selector) => ({
  url,
  type: 'missing-alt',
  severity: 'error',
  category: 'accessibility',
  source: 'https://www.w3.org/WAI/tutorials/images/',
  message: 'Image missing alt attribute',
  context: selector === 'header > img' ? '<img src="/logo.svg">' : '<img src="/photo.jpg">',
  selector,
  html: '<img src="/x.jpg">'
})

const page = (url, issues = [], extra = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues,
  facts: null,
  ...extra
})

// `count` pages that share a logo without alt in their header, and each have one photo of their own without alt.
const templateSite = (count) =>
  Array.from({ length: count }, (_, i) => {
    const url = `https://a.test/page-${i}`
    return page(url, [missingAlt(url, 'header > img'), missingAlt(url, `#photo-${i}`)])
  })

test('buildDigest: a template element on every page is one variant, and every count stays complete', () => {
  const digest = buildDigest(buildReport({ pages: templateSite(8), site: [] }))
  const [finding] = digest.findings
  assert.equal(digest.findings.length, 1)
  assert.deepEqual(
    { pages: finding.pages, hits: finding.hits, variants: finding.variants.length, more: finding.moreVariants },
    { pages: 8, hits: 16, variants: 5, more: 4 }
  )
  assert.deepEqual(finding.variants[0], {
    message: 'Image missing alt attribute',
    context: '<img src="/logo.svg">',
    selector: 'header > img',
    html: '<img src="/x.jpg">',
    pages: 8,
    urls: ['https://a.test/page-0', 'https://a.test/page-1', 'https://a.test/page-2']
  })
  assert.equal(finding.variants[1].pages, 1)
  assert.equal(finding.title, buildReport({ pages: templateSite(1), site: [] }).rules['missing-alt'].title)
})

test('buildDigest: only the page lines grow with the number of pages', () => {
  const sizes = [20, 200].map((count) => {
    const digest = buildDigest(buildReport({ pages: templateSite(count), site: [] }))
    return { rest: JSON.stringify({ ...digest, pages: [] }).length, all: JSON.stringify(digest).length }
  })
  // Only the counts get longer: "20" becomes "200".
  assert.ok(sizes[1].rest - sizes[0].rest < 20, JSON.stringify(sizes))
  assert.ok(sizes[1].all < 40_000, JSON.stringify(sizes))
})

test('buildDigest: site issues are findings, and the pages they list are not counted clean', () => {
  const pages = [page('https://a.test/a'), page('https://a.test/b'), page('https://a.test/c')]
  const site = [
    {
      type: 'duplicate-title',
      severity: 'warning',
      category: 'seo',
      source: 'https://developers.google.com/search/docs/appearance/title-link',
      message: 'Same title on 2 pages',
      context: '<title>Home</title>',
      urls: ['https://a.test/a', 'https://a.test/b']
    }
  ]
  const digest = buildDigest(buildReport({ pages, site }))
  assert.deepEqual(
    digest.findings.map(({ type, pages, hits }) => ({ type, pages, hits })),
    [{ type: 'duplicate-title', pages: 2, hits: 1 }]
  )
  assert.deepEqual(digest.summary.health, { errors: 0, warnings: 2, clean: 1 })
  assert.deepEqual(
    digest.pages.map((line) => line.warnings),
    [1, 1, 0]
  )
})

test('buildDigest: Lighthouse audits group by id, one run per final page, worst pages first', () => {
  const run = (scores) => lhBlock(scores.map(([id, score]) => auditLine(id, { score })))
  const pages = [
    page('https://a.test/a', [], { lighthouse: run([['image-alt', 0.5]]) }),
    // Redirects to /a and shares its run, so it does not count again.
    page('https://a.test/old', [], { finalUrl: 'https://a.test/a', lighthouse: run([['image-alt', 0.5]]) }),
    page('https://a.test/b', [], {
      lighthouse: run([
        ['image-alt', 0],
        ['meta-description', null]
      ])
    })
  ]
  const digest = buildDigest(buildReport({ pages, site: [] }))
  assert.deepEqual(
    digest.lighthouseAudits.map(({ id, pages, worstScore, urls }) => ({ id, pages, worstScore, urls })),
    [
      { id: 'image-alt', pages: 2, worstScore: 0, urls: ['https://a.test/b', 'https://a.test/a'] },
      { id: 'meta-description', pages: 1, worstScore: null, urls: ['https://a.test/b'] }
    ]
  )
  assert.deepEqual(Object.keys(digest.lighthouseAudits[0]), ['id', 'category', 'title', 'pages', 'worstScore', 'urls'])
  assert.deepEqual(digest.scores, { pages: 2, scores: { seo: 50 } })
  assert.deepEqual(digest.pages[1], {
    url: 'https://a.test/old',
    finalUrl: 'https://a.test/a',
    status: 200,
    errors: 0,
    warnings: 0,
    infos: 0,
    scores: { seo: 50 }
  })
})

test('buildDigest: says where the report is, keeps the coverage and leaves out what did not occur', () => {
  const coverage = { tool: { name: 'pageaudit', version: '2.0.0' }, notRun: [] }
  const down = page('https://a.test/down', [], { finalUrl: null, status: null })
  const report = { ...buildReport({ pages: [down], site: [] }), coverage }
  const digest = buildDigest(report, { reportPath: 'out/report.json' })
  assert.deepEqual(digest.report, { path: 'out/report.json', schemaVersion: 1, generatedAt: report.generatedAt })
  assert.equal(digest.coverage, coverage)
  assert.deepEqual(digest.pages, [{ url: 'https://a.test/down', status: null, errors: 0, warnings: 0, infos: 0 }])
  assert.deepEqual(Object.keys(digest), [
    'digestVersion',
    'about',
    'report',
    'coverage',
    'summary',
    'skipped',
    'findings',
    'pages'
  ])
  assert.equal(buildDigest(buildReport({ pages: [], site: [] })).report.path, null)
})

test('buildDigest: long page text is cut for display but still grouped whole', () => {
  // Two elements whose selectors only differ past the display cap, so a grouping on the cut text would merge them.
  const long = (end) => `#${'p'.repeat(5000)}${end}`
  const relative = (url, end) => ({
    url,
    type: 'relative-canonical',
    severity: 'warning',
    category: 'seo',
    source: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    message: 'Canonical URL is relative (Google recommends absolute URLs)',
    context: '<link rel="canonical">',
    selector: long(end),
    actual: long(end)
  })
  const pages = [
    page('https://a.test/a', [relative('https://a.test/a', 'a')]),
    page('https://a.test/b', [relative('https://a.test/b', 'b')])
  ]
  const site = [
    {
      type: 'sitemap-url-redirects',
      severity: 'info',
      category: 'seo',
      source: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
      message: 'Sitemap lists a URL that redirects',
      context: long('c'),
      urls: ['https://a.test/a']
    }
  ]
  const findings = buildDigest(buildReport({ pages, site })).findings
  const canonical = findings.find((f) => f.type === 'relative-canonical')
  assert.equal(canonical.variants.length, 2)
  for (const variant of canonical.variants) {
    assert.equal(Array.from(variant.selector).length, 2000)
    assert.equal(Array.from(variant.actual).length, 2000)
    assert.ok(variant.selector.endsWith('...'))
  }
  const [redirect] = findings.find((f) => f.type === 'sitemap-url-redirects').variants
  assert.equal(Array.from(redirect.context).length, 2000)
})

test('buildDigest: a page line says how many Lighthouse audits and warnings the report holds beyond it', () => {
  const lighthouse = lhBlock([auditLine('image-alt')], { omittedAudits: 4, warnings: ['Audit x failed: crash'] })
  const digest = buildDigest(buildReport({ pages: [page('https://a.test/', [], { lighthouse })], site: [] }))
  assert.deepEqual(digest.pages[0].omittedAudits, 4)
  assert.deepEqual(digest.pages[0].lighthouseWarnings, 1)
  const quiet = buildDigest(
    buildReport({ pages: [page('https://a.test/', [], { lighthouse: lhBlock([]) })], site: [] })
  )
  assert.deepEqual(Object.keys(quiet.pages[0]), ['url', 'status', 'errors', 'warnings', 'infos', 'scores'])
})

test('buildDigest: the about text names the issues that mark a page the checks could not fully inspect', () => {
  const { about } = buildDigest(buildReport({ pages: [], site: [] }))
  // A renamed type would leave the model looking for an issue that no longer exists.
  for (const type of ['http-status', 'not-html', 'fetch-failed', 'check-failed', 'html-too-large']) {
    assert.ok(about.includes(type), type)
    assert.ok(adviceFor(type), type)
  }
})

test('buildDigest: one message on a different element of every page is one pattern, while the variants stay split', () => {
  const heading = (url, i, message = 'Heading level skipped: <h3> after <h1>') => ({
    url,
    type: 'skipped-heading-level',
    severity: 'warning',
    category: 'accessibility',
    source: 'https://www.w3.org/WAI/tutorials/page-structure/headings/',
    message,
    context: `<h3>Post ${i}</h3>`,
    selector: `#post-${i}`
  })
  const pages = Array.from({ length: 6 }, (_, i) => page(`https://a.test/${i}`, [heading(`https://a.test/${i}`, i)]))
  const [finding] = buildDigest(buildReport({ pages, site: [] })).findings
  assert.deepEqual(finding.messages, [{ message: 'Heading level skipped: <h3> after <h1>', pages: 6 }])
  assert.equal(finding.moreMessages, undefined)
  assert.deepEqual([finding.variants.length, finding.moreVariants], [5, 1])
  const mixed = ['<h3> after <h1>', '<h4> after <h2>', '<h5> after <h3>', '<h6> after <h4>'].map((skip, i) =>
    page(`https://a.test/m${i}`, [heading(`https://a.test/m${i}`, i, `Heading level skipped: ${skip}`)])
  )
  const [several] = buildDigest(buildReport({ pages: [...pages, ...mixed], site: [] })).findings
  assert.deepEqual(
    several.messages.map((m) => m.pages),
    [7, 1, 1]
  )
  assert.equal(several.moreMessages, 1)
})
