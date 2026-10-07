import { adviceFor } from '../src/advice.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripVTControlCharacters } from 'node:util'
import chalk from 'chalk'
import {
  buildReport,
  formatIssueTable,
  formatPagesTable,
  formatReport,
  formatSiteTable,
  formatSummary
} from '../src/report.js'

const CONTEXT = '<img src="/averyveryverylongimagefilename-that-goes-on-and-on-and-on/hero-banner-final-v2.png">'

const issue = (severity, category, message, context) => ({ type: 't', severity, category, message, context })

// chalk disables colors when stdout is not a TTY, which hides ANSI-related
// wrapping bugs, so force them on for the duration of the render.
function colored(render) {
  const previous = chalk.level
  chalk.level = 1
  try {
    const output = render()
    // eslint-disable-next-line no-control-regex
    assert.match(output, /\x1b\[/, 'expected colored output')
    return output
  } finally {
    chalk.level = previous
  }
}

const plainColored = (render) => stripVTControlCharacters(colored(render))
const tableWidths = (plain) =>
  new Set(
    plain
      .split('\n')
      .filter((l) => /^[│┌├└]/.test(l))
      .map((l) => l.length)
  )

const images = [
  issue('error', 'accessibility', 'Image missing alt attribute', CONTEXT),
  issue('warning', 'performance', 'Image missing width/height (causes layout shift)', CONTEXT),
  issue('info', 'accessibility', 'Image has empty alt (correct if decorative, review)', '<img alt="">')
]
const renderColored = () => colored(() => formatIssueTable(images))

test('formatIssueTable: colored cells are never split or leak escape fragments', () => {
  const plain = stripVTControlCharacters(renderColored())
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(plain, /\x1b|\[\d+m/, 'stray escape fragment')
  for (const word of ['error', 'warning', 'info', 'accessibility', 'performance']) {
    assert.match(plain, new RegExp(`│ ${word} +│`), `${word} was split`)
  }
})

test('formatIssueTable: context wraps at the full column width and keeps its text', () => {
  const plain = stripVTControlCharacters(renderColored())
  const rows = plain.split('\n').filter((l) => l.startsWith('│'))
  const contextLines = rows.map((l) => l.split('│')[4].slice(1, -1).trimEnd())
  assert.ok(contextLines.every((l) => l.length <= 44))
  assert.equal(contextLines.filter((l) => l.length === 44).length, 4)
  assert.equal(contextLines.join('').split(CONTEXT).length - 1, 2)
})

test('formatIssueTable: all table lines have equal width', () => {
  const plain = stripVTControlCharacters(renderColored())
  const widths = new Set(
    plain
      .split('\n')
      .filter((l) => /^[│┌├└]/.test(l))
      .map((l) => l.length)
  )
  assert.equal(widths.size, 1)
})

test('formatIssueTable: fits the terminal width, down to 80 columns', () => {
  for (const columns of [80, 100]) {
    assert.deepEqual([...tableWidths(plainColored(() => formatIssueTable(images, columns)))], [columns])
  }
})

test('formatIssueTable: wide characters wrap by display width without losing text', () => {
  const title = `<title>${'日本語のタイトル'.repeat(8)} 😀😀😀 emoji 🎉🎉</title>`
  const plain = plainColored(() => formatIssueTable([issue('warning', 'seo', 'Title is long', title)], 80))
  assert.doesNotMatch(plain, /…/, 'text was clipped')
  const context = plain
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .slice(1)
    .map((l) => l.split('│')[4].slice(1).trimEnd())
    .join('')
  assert.equal(context.replaceAll(' ', ''), title.replaceAll(' ', ''))
})

test('formatIssueTable: lists errors first, then warnings, then infos', () => {
  const plain = stripVTControlCharacters(formatIssueTable([images[2], images[1], images[0]]))
  const severities = plain.match(/│ (error|warning|info) /g).map((m) => m.slice(2, -1))
  assert.deepEqual(severities, ['error', 'warning', 'info'])
})

const page = (url, severities, fields = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues: severities.map((severity) => ({ url, ...issue(severity, 'seo', `A ${severity}`, '<x>') })),
  facts: { title: 'T', description: null, h1s: [] },
  ...fields
})

const pages = [
  page('https://a.test/clean', []),
  page('https://a.test/warn', ['warning', 'warning', 'info']),
  page('https://a.test/down', ['error'], { status: null }),
  page('https://a.test/also-clean', []),
  page('https://a.test/mixed', ['error', 'warning'])
]

const site = [
  {
    type: 'duplicate-title',
    severity: 'warning',
    category: 'seo',
    message: 'Same title on 2 pages',
    context: '<title>T</title>',
    urls: ['https://a.test/warn', `https://a.test/${'long-path/'.repeat(8)}`]
  }
]

test('buildReport: totals pages and severities, including site issues, and keeps facts and a timestamp', () => {
  const report = buildReport({ pages, site, skipped: [{ input: 'x', source: 'argument', reason: 'not a valid URL' }] })
  assert.deepEqual(report.summary, { pages: 5, errors: 2, warnings: 4, infos: 1 })
  assert.deepEqual(Object.keys(report), ['generatedAt', 'pages', 'site', 'skipped', 'rules', 'summary'])
  assert.deepEqual(Object.keys(report.pages[0]), ['url', 'finalUrl', 'status', 'redirects', 'issues', 'facts'])
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(report.skipped.length, 1)
})

test('buildReport: rules explain each issue type in the report once', () => {
  const { rules } = buildReport({ pages, site })
  const used = new Set([...pages.flatMap((page) => page.issues), ...site].map((issue) => issue.type))
  assert.deepEqual(Object.keys(rules).toSorted(), [...used].filter((type) => adviceFor(type)).toSorted())
  assert.ok(Object.keys(rules).length > 0)
  for (const { title, why, fix } of Object.values(rules)) assert.ok(title && why && fix)
})

test('formatPagesTable: worst pages first with right-aligned counts', () => {
  const plain = plainColored(() => formatPagesTable(pages, 100))
  const rows = plain
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .slice(1)
  assert.deepEqual(
    rows.map((l) =>
      l
        .split('│')
        .slice(1, -1)
        .map((c) => c.trim())
    ),
    [
      ['https://a.test/mixed', '200', '1', '1', '0'],
      ['https://a.test/down', 'failed', '1', '0', '0'],
      ['https://a.test/warn', '200', '0', '2', '1'],
      ['https://a.test/clean', '200', '0', '0', '0'],
      ['https://a.test/also-clean', '200', '0', '0', '0']
    ]
  )
  assert.match(rows[0], /│ +1 │ +1 │ +0 │$/)
  assert.deepEqual([...tableWidths(plain)], [100])
})

test('formatPagesTable: long URLs wrap inside the URL column', () => {
  const url = `https://a.test/${'segment/'.repeat(20)}`
  const plain = plainColored(() => formatPagesTable([page(url, ['error'])], 80))
  assert.deepEqual([...tableWidths(plain)], [80])
  const cells = plain
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .slice(1)
    .map((l) => l.split('│')[1].trim())
  assert.equal(cells.join(''), url)
})

test('formatSiteTable: lists every page involved, one per line', () => {
  const plain = plainColored(() => formatSiteTable(site, 90))
  assert.deepEqual([...tableWidths(plain)], [90])
  const pagesColumn = plain
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .slice(1)
    .map((l) => l.split('│')[4].trim())
  assert.equal(pagesColumn[0], 'https://a.test/warn')
  assert.equal(pagesColumn.slice(1).join(''), site[0].urls[1])
  assert.match(plain, /Same title on 2 pages/)
  assert.match(plain, /<title>T<\/title>/)
})

test('formatReport: details only for pages with issues, clean pages collapsed, site section and totals last', () => {
  const plain = plainColored(() => formatReport(buildReport({ pages, site }), 100))
  const headings = plain.split('\n').filter((l) => /^https:\/\//.test(l))
  assert.deepEqual(headings, ['https://a.test/mixed', 'https://a.test/down', 'https://a.test/warn'])
  assert.match(plain, /\n2 pages clean\n/)
  assert.ok(plain.indexOf('\nSite\n') > plain.indexOf('2 pages clean'))
  assert.ok(plain.trimEnd().endsWith('5 pages, 2 errors, 4 warnings, 1 info'))
})

test('formatReport: says so when there are no cross-page issues', () => {
  const plain = stripVTControlCharacters(formatReport(buildReport({ pages: [pages[0]], site: [] }), 100))
  assert.match(plain, /Site\n {2}No cross-page issues/)
  assert.match(plain, /1 page clean/)
  assert.ok(plain.trimEnd().endsWith('1 page, 0 errors, 0 warnings, 0 infos'))
})

test('formatSummary: pluralizes each count', () => {
  const line = (summary) => stripVTControlCharacters(formatSummary({ summary }))
  assert.equal(line({ pages: 1, errors: 1, warnings: 1, infos: 1 }), '\n1 page, 1 error, 1 warning, 1 info')
  assert.equal(line({ pages: 40, errors: 6, warnings: 19, infos: 0 }), '\n40 pages, 6 errors, 19 warnings, 0 infos')
})

test('formatReport: shows Lighthouse scores, metrics and failing audits', () => {
  const lighthouse = {
    scores: { performance: 95, seo: null },
    metrics: { fcp: 700, lcp: 900, tbt: 10, cls: 0.01, speedIndex: 800 },
    audits: [{ id: 'a', category: 'seo', title: 'No meta description', score: 0, displayValue: null, items: [] }],
    warnings: []
  }
  const page = {
    url: 'https://a.test/',
    finalUrl: 'https://a.test/',
    status: 200,
    redirects: [],
    issues: [],
    lighthouse
  }
  const report = buildReport({ pages: [page], site: [] })
  assert.deepEqual(report.pages[0].lighthouse, lighthouse)
  const text = stripVTControlCharacters(formatReport(report, 100))
  assert.match(text, /Lighthouse: performance 95 {2}seo n\/a/)
  assert.match(text, /LCP 900 ms, TBT 10 ms, CLS 0.01/)
  assert.match(text, /No meta description/)
  assert.doesNotMatch(text, /page clean/)
})

test('formatReport: a missing Lighthouse metric is shown as n/a', () => {
  const metrics = { fcp: null, lcp: 900, tbt: null, cls: null, speedIndex: null }
  const lighthouse = { scores: { seo: 90 }, metrics, audits: [], warnings: [] }
  const page = {
    url: 'https://a.test/',
    finalUrl: 'https://a.test/',
    status: 200,
    redirects: [],
    issues: [],
    lighthouse
  }
  const text = stripVTControlCharacters(formatReport(buildReport({ pages: [page], site: [] }), 100))
  assert.match(text, /FCP n\/a, LCP 900 ms, TBT n\/a, CLS n\/a, SI n\/a/)
  assert.doesNotMatch(text, /null/)
})

test('formatReport: Lighthouse cells are wrapped, not truncated', () => {
  const audit = {
    id: 'a',
    category: 'best-practices',
    title: 'Serve images in next-gen formats',
    score: 40,
    displayValue: 'Est savings of 1,230 KiB',
    items: []
  }
  const lighthouse = { scores: { seo: 90 }, metrics: {}, audits: [audit], warnings: [] }
  const page = {
    url: 'https://a.test/',
    finalUrl: 'https://a.test/',
    status: 200,
    redirects: [],
    issues: [],
    lighthouse
  }
  const text = stripVTControlCharacters(formatReport(buildReport({ pages: [page], site: [] }), 80))
  assert.match(text, /best-practices/)
  assert.doesNotMatch(text, /…/)
  assert.match(text, /1,230/)
})

test('buildReport: caps free-text facts in the report but leaves the audited facts whole', () => {
  const facts = {
    title: 'T'.repeat(400),
    description: 'D'.repeat(400),
    h1s: Array.from({ length: 30 }, () => 'H'.repeat(400))
  }
  const audited = { url: 'https://a.test/', finalUrl: 'https://a.test/', status: 200, redirects: [], issues: [], facts }
  const [out] = buildReport({ pages: [audited], site: [] }).pages
  assert.equal(Array.from(out.facts.title).length, 300)
  assert.ok(out.facts.title.endsWith('...'))
  assert.equal(Array.from(out.facts.description).length, 300)
  assert.equal(out.facts.h1s.length, 10)
  assert.ok(out.facts.h1s.every((h1) => Array.from(h1).length === 300))
  assert.equal(facts.title.length, 400)
  assert.equal(facts.h1s.length, 30)
})

test('buildReport: a page without facts stays null', () => {
  const failed = { url: 'https://a.test/', finalUrl: null, status: null, redirects: [], issues: [], facts: null }
  assert.equal(buildReport({ pages: [failed], site: [] }).pages[0].facts, null)
})
