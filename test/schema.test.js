import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { run } from '../src/cli.js'
import { SCHEMA_VERSION } from '../src/report.js'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

const schema = JSON.parse(await readFile(new URL('../schema/report.schema.json', import.meta.url), 'utf8'))
const ajv = new Ajv2020({ strict: true, strictTypes: false, allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schema)
const check = (report) => {
  validate(report)
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`)
}

const url = (name) => `${FIXTURE_HOST}/${name}`

// A Lighthouse result with every optional field, so the schema is tested against all of them.
const fullSummary = {
  lighthouseVersion: '13.5.0',
  formFactor: 'mobile',
  scores: { performance: 40, accessibility: null, 'best-practices': 100, seo: 90 },
  runs: 2,
  scoreSpread: { performance: [40, 50], accessibility: null },
  metrics: { fcp: 1000, lcp: 5000, tbt: 300, cls: 0.5, speedIndex: null },
  lcpElement: { selector: 'main > img', snippet: null },
  audits: [
    {
      id: 'unused-css',
      category: 'performance',
      title: 'Reduce unused CSS',
      score: 0,
      displayValue: null,
      description: 'Remove unused rules.',
      learnMore: 'https://web.dev/x',
      savings: { ms: 100, bytes: 2048, metrics: { lcp: 300, cls: 0.02 } },
      items: [
        {
          url: 'a.css',
          line: 3,
          selector: 'div > b',
          nodeLabel: 'Bold',
          snippet: '<b>',
          explanation: 'Why',
          label: 'c',
          wastedMs: 80,
          wastedBytes: 1000,
          totalBytes: 5000
        }
      ]
    }
  ],
  omittedAudits: 3,
  warnings: ['slow CPU']
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
async function fullReport(t, extra = []) {
  mockFixtureFetch(t)
  const out = []
  t.mock.method(console, 'log', (...a) => out.push(a.join(' ')))
  t.mock.method(console, 'error', () => {})
  const lighthouse = async (urls) => urls.map(() => ({ summary: fullSummary }))
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
