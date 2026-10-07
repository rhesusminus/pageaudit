import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lighthouseIssues } from '../src/lighthouse-issues.js'
import { ADVICE } from '../src/advice.js'

const summary = (metrics = {}, scores = {}, extra = {}) => ({
  scores: { performance: 100, accessibility: 100, 'best-practices': 100, seo: 100, ...scores },
  metrics: { lcp: 1000, cls: 0, tbt: 0, ...metrics },
  ...extra
})
const URL_ = 'https://a.test/'
const found = (s) => lighthouseIssues(URL_, s).map((i) => [i.type, i.severity])

test('lighthouseIssues: a good page has none', () => {
  assert.deepEqual(lighthouseIssues(URL_, summary()), [])
})

test('lighthouseIssues: metrics are info past good and a warning past poor, with the limits themselves fine', () => {
  assert.deepEqual(found(summary({ lcp: 2500, cls: 0.1, tbt: 200 })), [])
  assert.deepEqual(found(summary({ lcp: 2501, cls: 0.11, tbt: 201 })), [
    ['lcp-slow', 'info'],
    ['cls-high', 'info'],
    ['tbt-high', 'info']
  ])
  assert.deepEqual(
    found(summary({ lcp: 4000, cls: 0.25, tbt: 600 })).map(([, s]) => s),
    ['info', 'info', 'info']
  )
  assert.deepEqual(
    found(summary({ lcp: 4001, cls: 0.26, tbt: 601 })).map(([, s]) => s),
    ['warning', 'warning', 'warning']
  )
})

test('lighthouseIssues: scores under 90 are info and under 50 a warning, never an error', () => {
  const issues = found(summary({}, { performance: 89, accessibility: 49, 'best-practices': 50, seo: 90 }))
  assert.deepEqual(issues, [
    ['score-low-performance', 'info'],
    ['score-low-accessibility', 'warning'],
    ['score-low-best-practices', 'info']
  ])
  const worst = found(
    summary({ lcp: 99999, cls: 9, tbt: 99999 }, { performance: 0, accessibility: 0, 'best-practices': 0, seo: 0 })
  )
  assert.ok(worst.every(([, severity]) => severity !== 'error'))
})

test('lighthouseIssues: missing metrics and scores are not issues', () => {
  const none = { scores: { performance: null, seo: undefined }, metrics: { lcp: null, cls: undefined } }
  assert.deepEqual(lighthouseIssues(URL_, none), [])
  assert.deepEqual(lighthouseIssues(URL_, {}), [])
})

test('lighthouseIssues: an issue has the usual fields, the measured value and the limit', () => {
  const [lcp] = lighthouseIssues(URL_, summary({ lcp: 3200 }))
  assert.deepEqual(Object.keys(lcp), [
    'url',
    'id',
    'type',
    'severity',
    'category',
    'source',
    'message',
    'context',
    'actual',
    'expected'
  ])
  assert.match(lcp.id, /^lcp-slow-[0-9a-f]{8}$/)
  assert.equal(lcp.category, 'performance')
  assert.equal(lcp.message, 'Largest Contentful Paint is 3.2 s in the lab test (good is 2.5 s or less)')
  assert.equal(lcp.actual, 3200)
  assert.equal(lcp.expected, 'at most 2500 ms')
  const [cls] = lighthouseIssues(URL_, summary({ cls: 0.31 }))
  assert.equal(cls.expected, 'at most 0.1')
  const [score] = lighthouseIssues(URL_, summary({}, { 'best-practices': 40 }))
  assert.equal(score.category, 'best-practice')
  assert.equal(score.expected, 'at least 90')
})

test('lighthouseIssues: the slow LCP names the element when Lighthouse found it', () => {
  const element = { selector: 'div.hero > img', snippet: '<img class="hero" src="h.jpg">' }
  const [lcp] = lighthouseIssues(URL_, summary({ lcp: 5000 }, {}, { lcpElement: element }))
  assert.equal(lcp.context, element.snippet)
  assert.equal(lcp.selector, element.selector)
  assert.equal(lcp.html, element.snippet)
  const [plain] = lighthouseIssues(URL_, summary({ lcp: 5000 }))
  assert.equal(plain.context, 'Largest Contentful Paint 5.0 s')
  assert.equal('selector' in plain, false)
})

test('lighthouseIssues: every rule has plain-language advice that says it is lab data where it should', () => {
  for (const type of ['lcp-slow', 'cls-high', 'tbt-high', 'score-low-performance']) {
    assert.match(ADVICE[type].why, /one test run on one machine/)
  }
})
