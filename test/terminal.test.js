import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripVTControlCharacters } from 'node:util'
import chalk from 'chalk'
import { buildReport } from '../src/report.js'
import {
  formatIssueTable,
  formatLighthouse,
  formatNotChecked,
  formatPagesTable,
  formatReport,
  formatSiteTable,
  formatSummary,
  wrapText
} from '../src/terminal.js'
import { auditLine, issue, lhBlock, page, pages, site } from './helpers/report-pages.js'

const CONTEXT = '<img src="/averyveryverylongimagefilename-that-goes-on-and-on-and-on/hero-banner-final-v2.png">'

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

// The lines of the issue table's Context column, without padding.
const contextLines = (plain) =>
  plain
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .slice(1)
    .map((l) => l.split('│')[4].slice(1).trimEnd())

test('formatIssueTable: context breaks at spaces and splits only a word longer than the column', () => {
  const context = '<title>The Ultimate Guide to Choosing the Best Gentle Shampoo</title>'
  const plain = plainColored(() => formatIssueTable([issue('warning', 'seo', 'Title is long', context)], 80))
  assert.deepEqual(contextLines(plain), ['<title>The Ultimate Guide', 'to Choosing the Best', 'Gentle Shampoo</title>'])
  // A word longer than the column is split after a hyphen or a slash.
  const plainImages = stripVTControlCharacters(renderColored())
  assert.deepEqual(contextLines(plainImages).slice(0, 3), [
    '<img src="/averyveryverylongimagefilename-',
    'that-goes-on-and-on-and-on/hero-banner-',
    'final-v2.png">'
  ])
})

test('wrapText: a word that does not fit moves to the next line whole', () => {
  assert.deepEqual(wrapText('style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0"', 25).split('\n'), [
    'style="mask-type:alpha"',
    'maskUnits=',
    '"userSpaceOnUse" x="0"'
  ])
})

test('wrapText: a word wider than the line is split after a slash, = ? & _ or -', () => {
  assert.deepEqual(wrapText('https://nodejs.org/en/blog', 25).split('\n'), ['https://nodejs.org/en/', 'blog'])
  // The rest of the line is used when a part of the word fits there.
  assert.deepEqual(wrapText('see https://a.test/one/two/three', 16).split('\n'), [
    'see https://',
    'a.test/one/two/',
    'three'
  ])
})

test('wrapText: a word with nowhere to break is split on lines of its own', () => {
  assert.deepEqual(wrapText(`x ${'a'.repeat(25)}`, 10).split('\n'), [
    'x',
    'a'.repeat(10),
    'a'.repeat(10),
    'a'.repeat(5)
  ])
})

test('wrapText: wraps by display width and never splits a character', () => {
  assert.deepEqual(wrapText('日本語のタイトル', 5).split('\n'), ['日本', '語の', 'タイ', 'トル'])
  assert.deepEqual(wrapText('👍🏽👍🏽👍🏽', 4).split('\n'), ['👍🏽👍🏽', '👍🏽'])
})

test('wrapText: keeps line breaks and empty text', () => {
  assert.equal(wrapText('a\nb c', 10), 'a\nb c')
  assert.equal(wrapText('', 10), '')
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
  assert.equal(contextLines(plain).join('').replaceAll(' ', ''), title.replaceAll(' ', ''))
})

// The text of one column of a table, its lines joined with spaces.
const columnText = (plain, column) =>
  plain
    .split('\n')
    .filter((l) => l.startsWith('│'))
    .slice(1)
    .map((l) => l.split('│')[column].trim())
    .filter(Boolean)
    .join(' ')

const LONG_WORD_MESSAGE = 'No X-Content-Type-Options-and-X-Frame-Options: nosniff header'

test('formatIssueTable: a message word longer than the column is split, not cut off', () => {
  const plain = plainColored(() => formatIssueTable([issue('info', 'seo', LONG_WORD_MESSAGE, '<x>')], 80))
  assert.doesNotMatch(plain, /…/)
  assert.equal(columnText(plain, 3).replaceAll(' ', ''), LONG_WORD_MESSAGE.replaceAll(' ', ''))
  assert.deepEqual([...tableWidths(plain)], [80])
})

test('formatSiteTable: a message word longer than the column is split, not cut off', () => {
  const issues = [{ ...site[0], message: LONG_WORD_MESSAGE, context: 'https://a.test: no header' }]
  const plain = plainColored(() => formatSiteTable(issues, 80))
  assert.doesNotMatch(plain, /…/)
  const text = `${LONG_WORD_MESSAGE} https://a.test: no header`
  assert.equal(columnText(plain, 3).replaceAll(' ', ''), text.replaceAll(' ', ''))
  assert.deepEqual([...tableWidths(plain)], [80])
})

// The widths of the columns of a table, from its top border.
const columnWidthsOf = (plain) =>
  plain
    .split('\n')[0]
    .slice(1, -1)
    .split('┬')
    .map((c) => c.length)

test('formatIssueTable: short contexts get a narrow column and the issue the rest', () => {
  const issues = [issue('error', 'seo', 'Missing <title>', '<head>'), issue('warning', 'seo', 'No <h1>', '<body>')]
  for (const columns of [80, 114]) {
    const plain = plainColored(() => formatIssueTable(issues, columns))
    // "Context" is the widest, plus a space on each side.
    assert.deepEqual(columnWidthsOf(plain), [10, 15, columns - 5 - 25 - 9, 9])
  }
})

test('formatSiteTable: short URLs get a narrow column and the issue the rest', () => {
  const issues = [{ ...site[0], urls: ['https://a.test/', 'https://a.test/about'] }]
  const plain = plainColored(() => formatSiteTable(issues, 100))
  assert.deepEqual(columnWidthsOf(plain), [10, 15, 100 - 5 - 25 - 22, 22])
  assert.deepEqual(columnText(plain, 4).split(' '), issues[0].urls)
})

test('formatSiteTable: long URLs share the width by weight and wrap', () => {
  const plain = plainColored(() => formatSiteTable(site, 114))
  assert.deepEqual(columnWidthsOf(plain), [10, 15, 38, 46])
})

test('formatIssueTable: lists errors first, then warnings, then infos', () => {
  const plain = stripVTControlCharacters(formatIssueTable([images[2], images[1], images[0]]))
  const severities = plain.match(/│ (error|warning|info) /g).map((m) => m.slice(2, -1))
  assert.deepEqual(severities, ['error', 'warning', 'info'])
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

test('formatLighthouse: counts the audits left out by the cap in the "more" line', () => {
  const audits = Array.from({ length: 10 }, (_, i) => auditLine(`a${i}`))
  const text = stripVTControlCharacters(formatLighthouse(lhBlock(audits, { omittedAudits: 4 }), 100))
  assert.match(text, /\.\.\.and 6 more/)
  const withShown = stripVTControlCharacters(formatLighthouse(lhBlock(audits.slice(0, 3)), 100))
  assert.doesNotMatch(withShown, /more/)
})

test('formatLighthouse: with several runs, names the run and the scores that moved', () => {
  const scoreSpread = { performance: [88, 98], seo: [100, 100], pwa: null }
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([], { runs: 3, scoreSpread }), 100))
  assert.match(text, /^ {2}Middle of 3 runs; scores ranged: performance 88-98$/m)
  assert.doesNotMatch(text, /seo 100-100|pwa/)
})

test('formatLighthouse: says when the scores did not move between runs', () => {
  const block = lhBlock([], { runs: 2, scoreSpread: { seo: [50, 50] } })
  const text = stripVTControlCharacters(formatLighthouse(block, 100))
  assert.match(text, /Middle of 2 runs; the scores did not change/)
})

test('formatLighthouse: a single run has no runs line', () => {
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([]), 100))
  assert.doesNotMatch(text, /runs/)
})

test('formatLighthouse: the runs line is wrapped and indented at 80 columns', () => {
  const ids = ['performance', 'accessibility', 'best-practices', 'seo']
  const scoreSpread = Object.fromEntries(ids.map((id) => [id, [10, 99]]))
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([], { runs: 5, scoreSpread }), 80))
  const lines = text.split('\n').filter((line) => /runs|seo 10-99/.test(line))
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.ok(line.length <= 80, line)
    assert.match(line, /^ {2}\S/)
  }
})

test('formatLighthouse: names the largest element on screen after the metrics', () => {
  const lcpElement = { selector: 'main#main > section > div > p', snippet: '<p>' }
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([], { lcpElement }), 100))
  assert.match(text, /FCP .*\n {2}Largest element on screen: main#main > section > div > p$/m)
  assert.doesNotMatch(text, /<p>/)
  assert.doesNotMatch(stripVTControlCharacters(formatLighthouse(lhBlock([]), 100)), /Largest element/)
})

test('formatLighthouse: a long largest-element selector is wrapped and indented at 80 columns', () => {
  const selector = 'body > div.page-wrapper > main#content > section.hero-banner > div.container > picture > img'
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([], { lcpElement: { selector, snippet: null } }), 80))
  const lines = text.split('\n').filter((line) => /Largest|picture|img/.test(line))
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.ok(line.length <= 80, line)
    assert.match(line, /^ {2}\S/)
  }
})

const coverage = (notRun, settings = {}) => ({
  settings: { lighthouse: false, lighthousePages: 0, checkLinks: false, sitemaps: [], ...settings },
  notRun
})

test('formatReport: lists the checks that were asked for but did not run, before the totals', () => {
  const notRun = [
    { check: 'lighthouse', reason: 'not asked for (--lighthouse or --lighthouse-page)' },
    { check: 'orphan-page', reason: 'only 6 of 1657 URLs were audited' }
  ]
  const settings = { checkLinks: true, sitemaps: ['https://a.test/sitemap.xml'] }
  const report = buildReport({ pages, site, coverage: coverage(notRun, settings) })
  const text = stripVTControlCharacters(formatReport(report, 100))
  assert.match(text, /\nNot checked\n {2}orphan pages: only 6 of 1657 URLs were audited\n\n\d+ pages,/)
  assert.doesNotMatch(text, /Lighthouse: not asked for/)
})

test('formatNotChecked: leaves out the checks that were not asked for', () => {
  const notRun = [
    { check: 'lighthouse', reason: 'not asked for (--lighthouse or --lighthouse-page)' },
    { check: 'links', reason: 'not asked for (--check-links)' }
  ]
  assert.equal(formatNotChecked(coverage(notRun), 100), '')
  assert.equal(formatNotChecked(undefined, 100), '')
})

test('formatNotChecked: leaves out orphan pages when links were checked without a sitemap', () => {
  const notRun = [{ check: 'orphan-page', reason: 'needs a --sitemap, the list of pages that should be linked' }]
  assert.equal(formatNotChecked(coverage(notRun, { checkLinks: true }), 100), '')
})

test('formatNotChecked: shows Lighthouse when it was asked for and could not run', () => {
  const notRun = [{ check: 'lighthouse', reason: 'no page it was asked for returned HTML' }]
  const text = (settings) => stripVTControlCharacters(formatNotChecked(coverage(notRun, settings), 100))
  assert.match(text({ lighthouse: true }), /Lighthouse: no page it was asked for returned HTML/)
  assert.match(text({ lighthousePages: 2 }), /Lighthouse: no page it was asked for returned HTML/)
})

test('formatNotChecked: a long reason is wrapped and indented at 80 columns', () => {
  const reason =
    'checked 500 link targets, 1234 linked from fewer pages were not checked, so some pages may look orphaned'
  const settings = { checkLinks: true, sitemaps: ['https://a.test/sitemap.xml'] }
  const text = stripVTControlCharacters(formatNotChecked(coverage([{ check: 'orphan-page', reason }], settings), 80))
  const lines = text.split('\n').slice(2)
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.ok(line.length <= 80, line)
    assert.match(line, /^ {2}\S/)
  }
})

test('formatLighthouse: prints each warning of the run after the audits', () => {
  const warnings = [
    'The page loaded too slowly to finish within the time limit.',
    'Audit largest-contentful-paint-element failed: unknown error'
  ]
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([auditLine('a')], { warnings }), 100))
  assert.match(
    text,
    /└.*\n {2}Lighthouse warning: The page loaded too slowly .* time limit\.\n {2}Lighthouse warning: Audit/
  )
  assert.doesNotMatch(stripVTControlCharacters(formatLighthouse(lhBlock([]), 100)), /warning/)
})

test('formatLighthouse: a long warning is wrapped and indented at 80 columns', () => {
  const warning =
    'Chrome extensions negatively affected this page load performance. Try auditing the page in incognito mode or from a Chrome profile without extensions.'
  const text = stripVTControlCharacters(formatLighthouse(lhBlock([], { warnings: [warning] }), 80))
  const lines = text.split('\n').slice(text.split('\n').findIndex((line) => line.includes('Lighthouse warning')))
  assert.equal(lines.length, 3)
  for (const line of lines) {
    assert.ok(line.length <= 80, line)
    assert.match(line, /^ {2}\S/)
  }
})
