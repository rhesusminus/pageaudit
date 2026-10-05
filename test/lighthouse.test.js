import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lighthouseFailed, runLighthouse, summarize } from '../src/lighthouse.js'

const audit = (id, score, extra = {}) => ({ id, title: `Title ${id}`, score, scoreDisplayMode: 'binary', ...extra })

const LHR = {
  categories: {
    performance: {
      score: 0.91,
      auditRefs: [{ id: 'largest-contentful-paint' }, { id: 'unused-css' }, { id: 'unminified-js' }]
    },
    seo: { score: 0.5, auditRefs: [{ id: 'meta-description' }, { id: 'is-crawlable' }] },
    accessibility: { score: null, auditRefs: [] }
  },
  audits: {
    'first-contentful-paint': audit('first-contentful-paint', 1, { numericValue: 764.4 }),
    'largest-contentful-paint': audit('largest-contentful-paint', 0.4, { numericValue: 3100.6, displayValue: '3.1 s' }),
    'total-blocking-time': audit('total-blocking-time', 1, { numericValue: 0 }),
    'cumulative-layout-shift': audit('cumulative-layout-shift', 0.5, { numericValue: 0.123456 }),
    'speed-index': audit('speed-index', 1, { numericValue: 800 }),
    'meta-description': audit('meta-description', 0),
    'is-crawlable': audit('is-crawlable', 1),
    'unused-css': audit('unused-css', 0.6, {
      scoreDisplayMode: 'numeric',
      details: { items: [{ url: 'a.css' }, { node: { snippet: '<b>' } }, { label: 'c' }, { url: 'd.css' }, {}] }
    }),
    'unminified-js': audit('unminified-js', 0.3, { scoreDisplayMode: 'metricSavings' }),
    'manual-check': audit('manual-check', null, { scoreDisplayMode: 'manual' }),
    'not-in-category': audit('not-in-category', 0)
  },
  runWarnings: ['slow CPU']
}

test('summarize: rounds scores and metrics', () => {
  const { scores, metrics, warnings } = summarize(LHR)
  assert.deepEqual(scores, { performance: 91, seo: 50, accessibility: null })
  assert.deepEqual(metrics, { fcp: 764, lcp: 3101, tbt: 0, cls: 0.123, speedIndex: 800 })
  assert.deepEqual(warnings, ['slow CPU'])
})

test('summarize: keeps only failing audits that belong to a category, worst first', () => {
  const { audits } = summarize(LHR)
  assert.deepEqual(
    audits.map((a) => [a.id, a.category, a.score]),
    [
      ['meta-description', 'seo', 0],
      ['unminified-js', 'performance', 30],
      ['largest-contentful-paint', 'performance', 40],
      ['unused-css', 'performance', 60]
    ]
  )
})

test('summarize: lists at most three item labels per audit', () => {
  const unused = summarize(LHR).audits.find((a) => a.id === 'unused-css')
  assert.deepEqual(unused.items, ['a.css', '<b>', 'c'])
  assert.equal(unused.displayValue, null)
})

function fakes({ lhr = LHR, fail = [] } = {}) {
  const calls = { launched: 0, killed: 0, urls: [] }
  return {
    calls,
    launch: async () => {
      calls.launched++
      return { port: 9222, kill: async () => calls.killed++ }
    },
    lighthouse: async (url, flags) => {
      calls.urls.push(url)
      assert.equal(flags.port, 9222)
      if (fail.includes(url)) throw new Error('boom')
      return { lhr }
    }
  }
}

test('runLighthouse: one Chrome for all pages, results in input order', async () => {
  const f = fakes({ fail: ['https://b.test/'] })
  const progress = []
  const results = await runLighthouse(['https://a.test/', 'https://b.test/'], {
    ...f,
    onProgress: (n) => progress.push(n)
  })
  assert.equal(results[0].summary.scores.seo, 50)
  assert.deepEqual(results[1], { error: 'boom' })
  assert.deepEqual(progress, [1, 2])
  assert.deepEqual(f.calls, { launched: 1, killed: 1, urls: ['https://a.test/', 'https://b.test/'] })
})

test('runLighthouse: a runtime error from Lighthouse becomes an error entry', async () => {
  const f = fakes({ lhr: { ...LHR, runtimeError: { message: 'NO_FCP' } } })
  assert.deepEqual(await runLighthouse(['https://a.test/'], f), [{ error: 'NO_FCP' }])
  assert.equal(f.calls.killed, 1)
})

test('runLighthouse: Chrome that cannot start fails every page without throwing', async () => {
  const launch = async () => {
    throw new Error('no Chrome installations found')
  }
  const results = await runLighthouse(['https://a.test/', 'https://b.test/'], { launch, lighthouse: async () => ({}) })
  assert.deepEqual(results, Array(2).fill({ error: 'Could not start Chrome: no Chrome installations found' }))
})

test('runLighthouse: a Chrome that fails to close still returns the results', async () => {
  const f = fakes()
  const launch = async () => ({ port: 9222, kill: async () => Promise.reject(new Error('already dead')) })
  const results = await runLighthouse(['https://a.test/'], { ...f, launch })
  assert.equal(results[0].summary.scores.seo, 50)
})

test('lighthouseFailed: builds a warning with the same keys as other page issues', () => {
  const issue = lighthouseFailed('https://a.test/', 'boom')
  assert.deepEqual(Object.keys(issue), ['url', 'type', 'severity', 'category', 'source', 'message', 'context'])
  assert.equal(issue.severity, 'warning')
})
