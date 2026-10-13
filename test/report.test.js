import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adviceFor } from '../src/advice.js'
import { buildReport } from '../src/report.js'
import { auditLine, lhBlock, pages, site } from './helpers/report-pages.js'

const lhPage = (url, lighthouse) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues: [],
  facts: null,
  lighthouse
})

test('buildReport: totals pages and severities, including site issues, and keeps facts and a timestamp', () => {
  const report = buildReport({ pages, site, skipped: [{ input: 'x', source: 'argument', reason: 'not a valid URL' }] })
  assert.deepEqual(report.summary, { pages: 5, errors: 2, warnings: 4, infos: 1 })
  assert.deepEqual(Object.keys(report), [
    'schemaVersion',
    'generatedAt',
    'pages',
    'site',
    'skipped',
    'rules',
    'summary'
  ])
  assert.deepEqual(Object.keys(report.pages[0]), ['url', 'finalUrl', 'status', 'redirects', 'issues', 'facts'])
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(report.skipped.length, 1)
})

test('buildReport: the response details and link targets kept for the site checks stay out of the report', () => {
  const audited = pages.map((p) => ({ ...p, response: { headers: {}, bodyBytes: 10 }, links: ['https://a.test/x'] }))
  for (const reported of buildReport({ pages: audited, site }).pages) {
    assert.deepEqual(Object.keys(reported), ['url', 'finalUrl', 'status', 'redirects', 'issues', 'facts'])
  }
})

test('buildReport: rules explain each issue type in the report once', () => {
  const { rules } = buildReport({ pages, site })
  const used = new Set([...pages.flatMap((page) => page.issues), ...site].map((issue) => issue.type))
  assert.deepEqual(Object.keys(rules).toSorted(), [...used].filter((type) => adviceFor(type)).toSorted())
  assert.ok(Object.keys(rules).length > 0)
  for (const { title, why, fix } of Object.values(rules)) assert.ok(title && why && fix)
})

test('buildReport: caps free-text facts in the report but leaves the audited facts whole', () => {
  const facts = {
    title: 'T'.repeat(400),
    description: 'D'.repeat(400),
    h1s: Array.from({ length: 30 }, () => 'H'.repeat(400)),
    hreflang: Array.from({ length: 150 }, () => ({ lang: 'fi', href: `https://a.test/${'p'.repeat(3000)}` }))
  }
  const audited = { url: 'https://a.test/', finalUrl: 'https://a.test/', status: 200, redirects: [], issues: [], facts }
  const [out] = buildReport({ pages: [audited], site: [] }).pages
  assert.equal(Array.from(out.facts.title).length, 300)
  assert.ok(out.facts.title.endsWith('...'))
  assert.equal(Array.from(out.facts.description).length, 300)
  assert.equal(out.facts.h1s.length, 10)
  assert.ok(out.facts.h1s.every((h1) => Array.from(h1).length === 300))
  assert.equal(out.facts.hreflang.length, 100)
  assert.ok(out.facts.hreflang.every(({ lang, href }) => lang === 'fi' && Array.from(href).length === 2000))
  assert.equal(facts.title.length, 400)
  assert.equal(facts.h1s.length, 30)
  assert.equal(facts.hreflang.length, 150)
})

test('buildReport: a page without facts stays null', () => {
  const failed = { url: 'https://a.test/', finalUrl: null, status: null, redirects: [], issues: [], facts: null }
  assert.equal(buildReport({ pages: [failed], site: [] }).pages[0].facts, null)
})

test('buildReport: site issues get an id from their type, pages and context', () => {
  const { site: withIds } = buildReport({ pages, site })
  assert.match(withIds[0].id, /^duplicate-title-[0-9a-f]{8}$/)
  assert.deepEqual(buildReport({ pages, site: [...site].reverse() }).site[0].id, withIds[0].id)
  const twice = buildReport({ pages, site: [site[0], site[0]] }).site
  assert.notEqual(twice[0].id, twice[1].id)
})

test('buildReport: audit descriptions move to lighthouseAudits once, first one wins, missing fields are merged', () => {
  const report = buildReport({
    pages: [
      lhPage('https://a.test/1', lhBlock([auditLine('x', { description: 'First.' }), auditLine('constructor')])),
      lhPage(
        'https://a.test/2',
        lhBlock([auditLine('x', { description: 'Second.', learnMore: 'https://x.test/' }), auditLine('short')])
      ),
      lhPage('https://a.test/3', null)
    ],
    site: []
  })
  assert.deepEqual(report.lighthouseAudits, { x: { description: 'First.', learnMore: 'https://x.test/' } })
  assert.deepEqual(
    report.pages[0].lighthouse.audits.map((a) => Object.keys(a).includes('description')),
    [false, false]
  )
  assert.equal(report.pages[2].lighthouse, null)
  assert.equal(
    'lighthouseAudits' in buildReport({ pages: [lhPage('https://a.test/', lhBlock([auditLine('y')]))], site: [] }),
    false
  )
})
