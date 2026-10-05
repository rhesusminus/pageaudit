import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { ADVICE } from '../src/html/advice.js'
import { escapeHtml, markup, raw } from '../src/html/escape.js'
import { averageScores, groupIssues, metricBand, pageHealth, verdict } from '../src/html/model.js'
import { renderHtml } from '../src/html/render.js'
import { buildReport } from '../src/report.js'

const issue = (type, severity, extra = {}) => ({
  url: 'https://a.test/',
  type,
  severity,
  category: 'seo',
  source: 'https://developers.google.com/search/docs/appearance/title-link',
  message: `Message for ${type}`,
  context: '<head>',
  ...extra
})

const facts = {
  title: 'Home',
  description: null,
  h1s: ['Welcome'],
  wordCount: 120,
  links: { internal: 4, external: 1, nofollow: 0 },
  images: { total: 2, missingAlt: 0 }
}
const lighthouse = {
  scores: { performance: 95, accessibility: 60, 'best-practices': 30, seo: null },
  metrics: { fcp: 900, lcp: 3000, tbt: 700, cls: 0.3, speedIndex: null },
  audits: [{ id: 'a', category: 'seo', title: 'Fix the thing', score: 10, displayValue: '3 KiB', items: [] }],
  warnings: []
}
const page = (url, issues, extra = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues: issues.map((i) => ({ ...i, url })),
  facts,
  ...extra
})

const PAGES = [
  page('https://a.test/', [issue('missing-description', 'warning'), issue('http-status', 'error')], { lighthouse }),
  page('https://a.test/b', [issue('missing-description', 'warning')]),
  page('https://a.test/clean', [])
]
const SITE = [
  {
    ...issue('duplicate-title', 'warning'),
    url: undefined,
    urls: ['https://a.test/', 'https://a.test/b'],
    context: 'Same title'
  }
]
const NOW = new Date('2026-10-05T10:00:00Z')
const report = buildReport({ pages: PAGES, site: SITE, now: NOW })

test('html tag: escapes values, joins arrays and passes raw markup through', () => {
  const unsafe = '<b>"x" & \'y\'</b>'
  const text = String(markup`<p>${unsafe}</p>`)
  assert.equal(text, '<p>&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;</p>')
  const list = String(markup`${[raw('<i>1</i>'), 2, null, false]}`)
  assert.equal(list, '<i>1</i>2')
  assert.equal(escapeHtml('<'), '&lt;')
})

test('groupIssues: one group per type, worst first, with page and site issues together', () => {
  const groups = groupIssues(report)
  assert.deepEqual(
    groups.map((g) => [g.type, g.severity, g.urls.length]),
    [
      ['http-status', 'error', 1],
      ['duplicate-title', 'warning', 2],
      ['missing-description', 'warning', 2]
    ]
  )
})

test('pageHealth, averageScores, verdict and metricBand', () => {
  const health = pageHealth(report.pages)
  assert.deepEqual(health, { errors: 1, warnings: 1, clean: 1 })
  assert.match(verdict(report.summary, health), /^1 page out of 3 has problems/)
  assert.match(verdict({ pages: 2 }, { errors: 0, warnings: 0, clean: 2 }), /^No problems found on 2 pages/)
  assert.deepEqual(averageScores(report.pages), {
    pages: 1,
    scores: { performance: 95, accessibility: 60, 'best-practices': 30, seo: null }
  })
  assert.equal(averageScores([PAGES[1]]), null)
  assert.deepEqual(
    [metricBand('lcp', 2500), metricBand('lcp', 3000), metricBand('lcp', 4000), metricBand('lcp', null)],
    ['good', 'average', 'poor', 'unknown']
  )
})

test('renderHtml: has every section, the branding and the page facts', () => {
  const out = renderHtml(report, { title: 'Site check', client: 'Acme Oy', logo: 'data:image/png;base64,AAAA' })
  assert.match(out, /<title>Site check - Acme Oy<\/title>/)
  assert.match(out, /<h1>\s*Site check\s*<\/h1>/)
  assert.match(out, /<p class="client">\s*Acme Oy\s*<\/p>/)
  assert.match(out, /<img\s+class="logo"\s+src="data:image\/png;base64,AAAA"\s+alt="Acme Oy logo"/)
  assert.match(out, /5 October 2026/)
  for (const id of ['summary', 'fixes', 'pages', 'method']) assert.match(out, new RegExp(`<h2 id="${id}">`))
  assert.match(out, /The page returns an error/)
  assert.match(out, /How to fix:/)
  assert.match(out, /Fix the thing/)
  assert.match(out, /No problems found on this page/)
})

test('renderHtml: defaults to a plain title without a client or logo', () => {
  const out = renderHtml(report)
  assert.match(out, /<title>Website audit<\/title>/)
  assert.doesNotMatch(out, /class="client"|class="logo"/)
})

test('renderHtml: text from audited sites is escaped', () => {
  const evil = '<script>alert(1)</script> "quoted"'
  const bad = page('https://a.test/x?q="><script>', [issue('missing-title', 'error', { context: evil })], {
    facts: { ...facts, title: evil }
  })
  const out = renderHtml(buildReport({ pages: [bad], site: [], now: NOW }), { title: evil, client: evil })
  assert.doesNotMatch(out, /<script>alert/)
  assert.doesNotMatch(out, /x\?q="><script>/)
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  // The only script element is the print helper.
  assert.equal(out.match(/<script/g).length, 1)
})

test('renderHtml: is self-contained and links only with http(s) or none', () => {
  const out = renderHtml(report, { logo: 'data:image/png;base64,AAAA' })
  assert.doesNotMatch(out, /<link\b|@import|url\(|<script[^>]*\bsrc=|<iframe/i)
  const sources = [...out.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1])
  assert.ok(sources.length > 0)
  assert.ok(sources.every((value) => /^(https?:\/\/|data:image\/)/.test(value)))
})

test('renderHtml: a report with no problems and no Lighthouse data still renders', () => {
  const clean = buildReport({ pages: [page('https://a.test/', [])], site: [], now: NOW })
  const out = renderHtml(clean)
  assert.match(out, /Nothing to fix/)
  assert.doesNotMatch(out, /class="rings"/)
})

test('renderHtml: a page that could not be fetched has no facts and says so', () => {
  const failed = page('https://a.test/', [issue('fetch-failed', 'error')], {
    status: null,
    finalUrl: null,
    facts: null
  })
  const out = renderHtml(buildReport({ pages: [failed], site: [], now: NOW }))
  assert.match(out, /Not reachable/)
  assert.doesNotMatch(out, /class="facts"/)
})

// Every issue type a check can produce needs plain-language wording.
test('advice: covers every issue type in the checks and in Lighthouse', async () => {
  const files = ['src/lighthouse.js']
  const dir = new URL('../src/checks/', import.meta.url)
  for (const entry of await readdir(dir, { recursive: true }))
    if (entry.endsWith('.js')) files.push(`src/checks/${entry}`)
  const types = new Set()
  for (const file of files) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    for (const match of source.matchAll(/\btype: '([a-z0-9-]+)'/g)) types.add(match[1])
  }
  assert.ok(types.size > 25, `found only ${types.size} issue types`)
  const missing = [...types].filter((type) => !ADVICE[type])
  assert.deepEqual(missing, [])
  for (const { title, why, fix } of Object.values(ADVICE)) assert.ok(title && why && fix)
})
