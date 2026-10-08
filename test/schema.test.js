import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { run } from '../src/cli.js'
import { runLighthouse } from '../src/lighthouse.js'
import { SCHEMA_VERSION } from '../src/report.js'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

const schema = JSON.parse(await readFile(new URL('../schema/report.schema.json', import.meta.url), 'utf8'))
// allowUnionTypes: fields such as `actual` are a number or a string and `facts` an object or null.
const ajv = new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schema)
const check = (report) => {
  validate(report)
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`)
}

const url = (name) => `${FIXTURE_HOST}/${name}`

// Lighthouse through the real runLighthouse with a fake Chrome and a result with every optional field, so the
// digest is built by the code and not by hand. `behave(n)` says what the nth run does: a score, or 'fail'.
const FAILING = Array.from({ length: 12 }, (_, i) => `audit-${i}`)

const audit = (id, extra = {}) => ({ id, title: id, score: 0, scoreDisplayMode: 'binary', ...extra })

// An audit with a saving of every kind and an affected item with every field.
const UNUSED_CSS = audit('unused-css', {
  scoreDisplayMode: 'metricSavings',
  description: 'Remove unused rules. [Learn more](https://web.dev/x).',
  metricSavings: { LCP: 300, CLS: 0.02, INP: 0.2 },
  details: {
    overallSavingsMs: 100,
    overallSavingsBytes: 2048,
    items: [
      {
        url: 'a.css',
        sourceLocation: { url: 'a.css', line: 2 },
        node: { selector: 'div > b', snippet: '<b>', nodeLabel: 'Bold', explanation: 'Why' },
        label: 'c',
        wastedMs: 80,
        wastedBytes: 1000,
        totalBytes: 5000
      }
    ]
  }
})

const METRIC_AUDITS = {
  'first-contentful-paint': audit('first-contentful-paint', { score: 1, numericValue: 1000 }),
  'largest-contentful-paint': audit('largest-contentful-paint', { score: 1, numericValue: 5000 }),
  'total-blocking-time': audit('total-blocking-time', { score: 1, numericValue: 300 }),
  'cumulative-layout-shift': audit('cumulative-layout-shift', { score: 1, numericValue: 0.5 }),
  'speed-index': audit('speed-index', { score: 1 }),
  'lcp-breakdown-insight': audit('lcp-breakdown-insight', {
    scoreDisplayMode: 'informative',
    details: { type: 'list', items: [{ type: 'node', selector: 'main > img', snippet: '<img>' }] }
  })
}

function lhr(performance) {
  return {
    lighthouseVersion: '13.5.0',
    configSettings: { formFactor: 'mobile' },
    categories: {
      performance: { score: performance, auditRefs: [{ id: 'unused-css' }, ...FAILING.map((id) => ({ id }))] },
      accessibility: { score: null, auditRefs: [] },
      'best-practices': { score: 1, auditRefs: [] },
      seo: { score: 0.9, auditRefs: [] }
    },
    audits: {
      ...METRIC_AUDITS,
      'unused-css': UNUSED_CSS,
      ...Object.fromEntries(FAILING.map((id, i) => [id, audit(id, { score: i / 20 })]))
    },
    runWarnings: ['slow CPU']
  }
}

// A runner for run(): Lighthouse itself is real, Chrome and the Lighthouse call are fakes.
function lighthouseRunner(behave) {
  let n = 0
  const lighthouse = async () => {
    const outcome = behave(n++)
    if (outcome === 'fail') throw new Error('Chrome crashed')
    return { lhr: lhr(outcome) }
  }
  const launch = async () => ({ port: 1, kill: async () => {} })
  return (urls, options) => runLighthouse(urls, { ...options, launch, lighthouse })
}

// Pages that between them produce every kind of issue, an unreachable page and a page without HTML.
const NAMES = [
  'good.html',
  'bad-missing.html',
  'bad-overlong.html',
  'bad-images.html',
  'bad-markup.html',
  'bad-canonical.html',
  'bad-empty.html',
  'duplicate.html',
  'noindex.html',
  'noindex-header.html',
  'blocked.html',
  'rich.html',
  'redirect-twice',
  'not-html',
  'missing-page',
  'timeout'
]

// Every kind of page and issue the fixtures produce, plus both Lighthouse levels.
async function fullReport(t, extra = [], behave = (n) => 0.4 + (n % 2) / 10) {
  mockFixtureFetch(t)
  const out = []
  t.mock.method(console, 'log', (...a) => out.push(a.join(' ')))
  t.mock.method(console, 'error', () => {})
  const lighthouse = lighthouseRunner(behave)
  const args = [
    ...NAMES.map(url),
    '--sitemap',
    url('sitemap.xml'),
    '--sitemap',
    url('sitemap-quality.xml'),
    '--urls-file',
    new URL('./fixtures/urls.txt', import.meta.url).pathname,
    '--lighthouse',
    '--lighthouse-page',
    url('good.html'),
    '--lighthouse-runs',
    '2',
    '--json',
    '--delay',
    '0',
    ...extra
  ]
  await run(args, { lighthouse })
  return JSON.parse(out[0])
}

test('schema: a report with every kind of page, issue and Lighthouse level matches it', async (t) => {
  const report = await fullReport(t)
  assert.deepEqual(check(report), [])
  assert.equal(report.schemaVersion, SCHEMA_VERSION)
  assert.equal(schema.properties.schemaVersion.const, SCHEMA_VERSION)
  // The report must actually contain what the schema describes, or this test proves little.
  assert.ok(report.pages.some((p) => p.lighthouse?.audits[0]?.items))
  assert.ok(report.pages.some((p) => p.lighthouse && !p.lighthouse.audits[0]?.items))
  assert.ok(report.pages.some((p) => p.facts === null))
  assert.ok(report.site.length > 0 && report.skipped.length > 0)
  assert.ok(report.pages.flatMap((p) => p.issues).some((i) => i.selector && i.html && i.parentHtml))
  assert.ok(report.pages.flatMap((p) => p.issues).some((i) => i.actual !== undefined && i.expected))
  assert.ok(report.lighthouseAudits)
})

test('schema: Lighthouse output built by the real code matches, with the digest fields the schema lists', async (t) => {
  const report = await fullReport(t)
  const digest = report.pages.find((p) => p.lighthouse?.audits[0]?.items).lighthouse
  assert.equal(digest.runs, 2)
  assert.ok(digest.scoreSpread.performance)
  assert.equal(digest.lcpElement.selector, 'main > img')
  assert.ok(digest.omittedAudits > 0)
  const audit = digest.audits.find((a) => a.id === 'unused-css')
  assert.deepEqual(Object.keys(audit.savings).toSorted(), ['bytes', 'metrics', 'ms'])
  assert.deepEqual(Object.keys(audit.savings.metrics).toSorted(), ['cls', 'lcp'])
  assert.deepEqual(Object.keys(audit.items[0]).toSorted(), [
    'explanation',
    'label',
    'line',
    'nodeLabel',
    'selector',
    'snippet',
    'totalBytes',
    'url',
    'wastedBytes',
    'wastedMs'
  ])
})

test('schema: failed Lighthouse runs match it - partial, total and a page that gave no HTML', async (t) => {
  const partial = await fullReport(t, ['--lighthouse-runs', '3'], (n) => (n % 3 === 0 ? 0.5 : 'fail'))
  assert.deepEqual(check(partial), [])
  assert.ok(partial.pages.some((p) => p.lighthouse?.runs === 1))
  const total = await fullReport(t, [], () => 'fail')
  assert.deepEqual(check(total), [])
  const failed = total.pages.filter((p) => p.lighthouse === null)
  assert.ok(failed.length > 0)
  for (const page of failed) assert.ok(page.issues.some((i) => i.type === 'lighthouse-failed' && i.id))
})

test('schema: a report without Lighthouse matches it', async (t) => {
  mockFixtureFetch(t)
  const out = []
  t.mock.method(console, 'log', (...a) => out.push(a.join(' ')))
  await run([url('good.html'), '--json', '--delay', '0'])
  const report = JSON.parse(out[0])
  assert.deepEqual(check(report), [])
  assert.equal('lighthouseAudits' in report, false)
})

const lighthouseOf = (r) => r.pages.find((p) => p.lighthouse).lighthouse

// Each change makes a valid report invalid, so the schema is strict enough to notice drift.
const BREAKING = {
  'an unknown top-level field': (r) => (r.extra = 1),
  'a missing schemaVersion': (r) => delete r.schemaVersion,
  'another schemaVersion': (r) => (r.schemaVersion = 2),
  'an unknown severity': (r) => (r.pages[0].issues[0].severity = 'fatal'),
  'an unknown issue field': (r) => (r.pages[0].issues[0].surprise = true),
  'a site issue without urls': (r) => delete r.site[0].urls,
  'a mistyped fact': (r) => (r.pages[0].facts.wordCount = '5'),
  'a negative count': (r) => (r.summary.errors = -1),
  'a mistyped metric': (r) => (lighthouseOf(r).metrics.lcp = 'slow'),
  'an unknown audit field': (r) => (lighthouseOf(r).audits[0].junk = 1),
  'a final URL without a status': (r) => (r.pages.find((p) => p.status === null).finalUrl = 'https://a.test/'),
  'an issue without an id': (r) => delete r.pages.find((p) => p.issues.length).issues[0].id,
  "an audit category outside Lighthouse's four": (r) => (lighthouseOf(r).audits[0].category = 'best-practice'),
  'no successful run': (r) => (lighthouseOf(r).runs = 0),
  'more audits than the cap': (r) => (lighthouseOf(r).audits = Array(11).fill(lighthouseOf(r).audits[0]))
}

test('schema: drift is caught - unknown, missing and mistyped fields all fail', async (t) => {
  const report = await fullReport(t)
  assert.deepEqual(check(report), [])
  for (const [name, change] of Object.entries(BREAKING)) {
    const copy = structuredClone(report)
    change(copy)
    assert.notDeepEqual(check(copy), [], name)
  }
})
