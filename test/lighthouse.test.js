import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lighthouseFailed, runLighthouse, shortSummary, summarize } from '../src/lighthouse.js'

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
      description:
        'Remove unused rules. [Learn more about unused CSS](https://web.dev/unused-css/). See [docs](https://x.test/).',
      details: {
        overallSavingsMs: 150.4,
        overallSavingsBytes: 20480.6,
        items: [
          { url: 'a.css', wastedBytes: 1000.2, totalBytes: 5000, wastedMs: 80.5 },
          {
            node: { selector: 'div.hero > b', snippet: '<b>', nodeLabel: 'Bold', explanation: '  Low\n contrast ' }
          },
          { label: 'c' },
          { source: { url: 'd.css' } },
          {},
          { url: 'e.css' },
          { url: 'f.css' }
        ]
      }
    }),
    'unminified-js': audit('unminified-js', 0.3, { scoreDisplayMode: 'metricSavings' }),
    'crashed-audit': audit('crashed-audit', null, { scoreDisplayMode: 'error', errorMessage: 'It broke' }),
    'manual-check': audit('manual-check', null, { scoreDisplayMode: 'manual' }),
    'not-in-category': audit('not-in-category', 0)
  },
  runWarnings: ['slow CPU']
}

test('summarize: rounds scores and metrics', () => {
  const { scores, metrics, warnings } = summarize(LHR)
  assert.deepEqual(scores, { performance: 91, seo: 50, accessibility: null })
  assert.deepEqual(metrics, { fcp: 764, lcp: 3101, tbt: 0, cls: 0.123, speedIndex: 800 })
  assert.deepEqual(warnings, ['slow CPU', 'Audit crashed-audit failed: It broke'])
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

test('summarize: keeps what a fix needs from at most three affected items', () => {
  const unused = summarize(LHR).audits.find((a) => a.id === 'unused-css')
  assert.deepEqual(unused.items, [
    { url: 'a.css', wastedMs: 81, wastedBytes: 1000, totalBytes: 5000 },
    { selector: 'div.hero > b', nodeLabel: 'Bold', snippet: '<b>', explanation: 'Low contrast' },
    { label: 'c' }
  ])
  assert.equal(unused.displayValue, null)
})

test('summarize: keeps the description with plain words, the first link and the savings', () => {
  const { audits } = summarize(LHR)
  const [unused, plain] = [audits.find((a) => a.id === 'unused-css'), audits.find((a) => a.id === 'meta-description')]
  assert.equal(unused.description, 'Remove unused rules. Learn more about unused CSS. See docs.')
  assert.equal(unused.learnMore, 'https://web.dev/unused-css/')
  assert.deepEqual(unused.savings, { ms: 150, bytes: 20481 })
  assert.deepEqual(Object.keys(plain), ['id', 'category', 'title', 'score', 'displayValue', 'items'])
})

test('summarize: caps long item text and long descriptions', () => {
  const lhr = structuredClone(LHR)
  lhr.audits['meta-description'].description = 'word '.repeat(200)
  lhr.audits['meta-description'].details = { items: [{ node: { snippet: 'x'.repeat(1000) } }] }
  const [audit] = summarize(lhr).audits
  assert.equal(Array.from(audit.description).length, 400)
  assert.equal(Array.from(audit.items[0].snippet).length, 300)
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

test('runLighthouse: a Lighthouse that cannot be loaded is not reported as a Chrome failure', async () => {
  const load = async () => {
    throw new Error("Cannot find package 'lighthouse'")
  }
  const results = await runLighthouse(['https://a.test/'], { load })
  assert.deepEqual(results, [{ error: "Could not load Lighthouse: Cannot find package 'lighthouse'" }])
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

test('runLighthouse: a synchronous kill, as chrome-launcher has, works and may throw', async () => {
  const f = fakes()
  let killed = 0
  const quiet = { ...f, launch: async () => ({ port: 9222, kill: () => void killed++ }) }
  assert.equal((await runLighthouse(['https://a.test/'], quiet))[0].summary.scores.seo, 50)
  const throwing = {
    ...f,
    launch: async () => ({
      port: 9222,
      kill: () => {
        throw new Error('already dead')
      }
    })
  }
  assert.equal((await runLighthouse(['https://a.test/'], throwing))[0].summary.scores.seo, 50)
  assert.equal(killed, 1)
})

test('lighthouseFailed: builds an info issue with the same keys as other page issues', () => {
  const issue = lighthouseFailed('https://a.test/', 'boom')
  assert.deepEqual(Object.keys(issue), ['url', 'type', 'severity', 'category', 'source', 'message', 'context'])
  assert.equal(issue.severity, 'info')
})

// Builds an lhr with one failing performance audit of the given shape.
const withAudit = (extra) => ({
  categories: { performance: { score: 0.5, auditRefs: [{ id: 'x' }] } },
  audits: { x: audit('x', 0, { scoreDisplayMode: 'metricSavings', ...extra }) }
})
const itemsOf = (extra) => summarize(withAudit(extra)).audits[0].items

test('summarize: a checklist audit keeps its failed checks and does not crash', () => {
  const details = {
    type: 'checklist',
    items: {
      noRedirects: { value: false, label: 'Avoids redirects' },
      serverResponseIsFast: { value: true, label: 'Server responds quickly' },
      usesCompression: { value: false }
    }
  }
  assert.deepEqual(itemsOf({ details }), [{ label: 'Avoids redirects' }, { label: 'usesCompression' }])
  assert.deepEqual(itemsOf({ details: { type: 'checklist', items: null } }), [])
  assert.deepEqual(itemsOf({ details: { items: 'odd' } }), [])
})

test('summarize: list details are flattened into tables, nodes and sections', () => {
  const details = {
    type: 'list',
    items: [
      { type: 'node', selector: 'img.hero', snippet: '<img class="hero">', nodeLabel: 'Hero' },
      { type: 'list-section', value: 'Request is not discoverable' },
      { type: 'table', items: [{ url: 'a.js', wastedMs: 40 }] }
    ]
  }
  assert.deepEqual(itemsOf({ details }), [
    { selector: 'img.hero', snippet: '<img class="hero">', nodeLabel: 'Hero' },
    { label: 'Request is not discoverable' },
    { url: 'a.js', wastedMs: 40 }
  ])
})

test('summarize: items with other shapes keep their address, line, message, entity and reason', () => {
  const details = {
    items: [
      { source: 'exception', description: 'TypeError: x is undefined', sourceLocation: { url: 'app.js', line: 9 } },
      { url: { type: 'link', url: 'b.js' }, source: { url: 'ignored.js' } },
      { source: { type: 'node', selector: 'html', snippet: '<html>' } }
    ]
  }
  assert.deepEqual(itemsOf({ details }), [
    { url: 'app.js', line: 10, label: 'TypeError: x is undefined' },
    { url: 'b.js' },
    { selector: 'html', snippet: '<html>' }
  ])
  const more = {
    items: [
      { entity: { type: 'link', text: 'Google Fonts', url: 'https://fonts.google.com' } },
      { node: { selector: 'img', snippet: '<img>' }, subItems: { items: [{ reason: 'Use a modern format' }] } },
      { url: '   ', source: { url: 'fallback.js' } }
    ]
  }
  assert.deepEqual(itemsOf({ details: more }), [
    { label: 'Google Fonts' },
    { selector: 'img', snippet: '<img>', explanation: 'Use a modern format' },
    { url: 'fallback.js' }
  ])
})

test('summarize: item text is tidied, nodeLabel that the snippet repeats is dropped, zero costs are left out', () => {
  const details = {
    items: [
      {
        node: {
          snippet: '<a class="x">Go</a>',
          nodeLabel: 'Go',
          explanation: 'Fix any of the following:\n  Contrast 3:1'
        },
        wastedMs: 0,
        wastedBytes: 0.2,
        totalBytes: 0
      }
    ]
  }
  assert.deepEqual(itemsOf({ details }), [{ snippet: '<a class="x">Go</a>', explanation: 'Contrast 3:1' }])
  const long = { node: { explanation: `${'y'.repeat(600)}` } }
  assert.equal(Array.from(itemsOf({ details: { items: [long] } })[0].explanation).length, 500)
})

test('summarize: savings come from metricSavings and fall back to the older fields; zero is no estimate', () => {
  const only = (extra) => summarize(withAudit(extra)).audits[0].savings
  assert.deepEqual(only({ metricSavings: { FCP: 800.4, LCP: 0, INP: 12, CLS: 0.04567 } }), {
    metrics: { fcp: 800, inp: 12, cls: 0.046 }
  })
  assert.deepEqual(only({ details: { overallSavingsMs: 90.2, debugData: { wastedBytes: 4096 } } }), {
    ms: 90,
    bytes: 4096
  })
  assert.equal(
    only({ details: { overallSavingsMs: 0, overallSavingsBytes: 0.3 }, metricSavings: { LCP: 0 } }),
    undefined
  )
})

test('summarize: descriptions cope with parentheses in links, relative links and no links', () => {
  const describe = (description) => summarize(withAudit({ description })).audits[0]
  const nested = describe('See [the guide (v2)](https://web.dev/a_(b)/).')
  assert.equal(nested.description, 'See the guide (v2).')
  assert.equal(nested.learnMore, 'https://web.dev/a_(b)/')
  const relative = describe('Read [more](/docs/x) first.')
  assert.equal(relative.description, 'Read more first.')
  assert.equal('learnMore' in relative, false)
  const none = describe('No links here.')
  assert.equal(none.description, 'No links here.')
  assert.equal('description' in describe(undefined), false)
})

test('summarize: keeps the ten worst audits and counts the rest', () => {
  const ids = Array.from({ length: 13 }, (_, i) => `a${i}`)
  const lhr = {
    categories: { seo: { score: 0.5, auditRefs: ids.map((id) => ({ id })) } },
    audits: Object.fromEntries(ids.map((id, i) => [id, audit(id, i / 20)]))
  }
  const { audits, omittedAudits } = summarize(lhr)
  assert.deepEqual(
    audits.map((a) => a.id),
    ids.slice(0, 10)
  )
  assert.equal(omittedAudits, 3)
  assert.equal('omittedAudits' in summarize(LHR), false)
})

test('shortSummary: keeps scores, metrics and one line per audit, without items, descriptions or savings', () => {
  const full = summarize(LHR)
  const short = shortSummary(full)
  assert.deepEqual(short.scores, full.scores)
  assert.deepEqual(short.metrics, full.metrics)
  assert.deepEqual(short.warnings, full.warnings)
  for (const a of short.audits) assert.deepEqual(Object.keys(a), ['id', 'category', 'title', 'score', 'displayValue'])
  assert.equal(short.audits.length, full.audits.length)
})

test('summarize: records the Lighthouse version, the form factor and the LCP element', () => {
  const lhr = structuredClone(LHR)
  lhr.lighthouseVersion = '13.5.0'
  lhr.configSettings = { formFactor: 'mobile' }
  lhr.audits['largest-contentful-paint-element'] = audit('largest-contentful-paint-element', 0, {
    details: {
      type: 'list',
      items: [
        { type: 'table', items: [{ node: { selector: 'div > img.hero', snippet: '<img class="hero">' } }] },
        { type: 'table', items: [{ phase: 'TTFB', timing: 200 }] }
      ]
    }
  })
  const out = summarize(lhr)
  assert.deepEqual(Object.keys(out).slice(0, 2), ['lighthouseVersion', 'formFactor'])
  assert.equal(out.lighthouseVersion, '13.5.0')
  assert.equal(out.formFactor, 'mobile')
  assert.deepEqual(out.lcpElement, { selector: 'div > img.hero', snippet: '<img class="hero">' })
  delete lhr.audits['largest-contentful-paint-element']
  lhr.audits['lcp-breakdown-insight'] = audit('lcp-breakdown-insight', null, {
    scoreDisplayMode: 'informative',
    details: {
      type: 'list',
      items: [
        { type: 'table', items: [{ subpart: 'timeToFirstByte', label: 'Time to first byte', duration: 518 }] },
        { type: 'node', selector: 'main > h1', snippet: '<h1>Hi</h1>', nodeLabel: 'Hi' }
      ]
    }
  })
  assert.deepEqual(summarize(lhr).lcpElement, { selector: 'main > h1', snippet: '<h1>Hi</h1>' })
  const bare = summarize(LHR)
  for (const key of ['lighthouseVersion', 'formFactor', 'lcpElement']) assert.equal(key in bare, false)
})

// Gives each run its own performance score, in the order the runs happen.
function scripted(performances, { fail = [] } = {}) {
  let n = 0
  return {
    launch: async () => ({ port: 1, kill: async () => {} }),
    lighthouse: async () => {
      const i = n++
      if (fail.includes(i)) throw new Error(`run ${i} failed`)
      const lhr = structuredClone(LHR)
      lhr.categories.performance.score = performances[i] / 100
      lhr.categories.seo.score = (performances[i] + 1) / 100
      lhr.audits['first-contentful-paint'].numericValue = performances[i] * 10
      return { lhr }
    },
    count: () => n
  }
}

test('runLighthouse: runs the page n times and keeps the median run with the spread of the scores', async () => {
  const f = scripted([60, 90, 70])
  const [result] = await runLighthouse(['https://a.test/'], { ...f, runs: 3 })
  assert.equal(f.count(), 3)
  assert.equal(result.summary.scores.performance, 70)
  assert.equal(result.summary.metrics.fcp, 700)
  assert.equal(result.summary.runs, 3)
  assert.deepEqual(result.summary.scoreSpread.performance, [60, 90])
  assert.deepEqual(result.summary.scoreSpread.seo, [61, 91])
  assert.equal(result.summary.scoreSpread.accessibility, null)
})

test('runLighthouse: a failed run is dropped, and only every run failing is an error', async () => {
  const some = scripted([60, 90, 70], { fail: [1] })
  const [kept] = await runLighthouse(['https://a.test/'], { ...some, runs: 3 })
  assert.equal(kept.summary.runs, 2)
  assert.equal(kept.summary.scores.performance, 60)
  const none = scripted([1, 2], { fail: [0, 1] })
  assert.deepEqual(await runLighthouse(['https://a.test/'], { ...none, runs: 2 }), [{ error: 'run 1 failed' }])
})

test('runLighthouse: a single run has no runs or spread', async () => {
  const f = scripted([60])
  const [result] = await runLighthouse(['https://a.test/'], f)
  assert.equal('runs' in result.summary, false)
  assert.equal('scoreSpread' in result.summary, false)
})

test('runLighthouse: a result that cannot be read is an error entry, not an exception', async () => {
  const launch = async () => ({ port: 1, kill: async () => {} })
  const broken = { launch, lighthouse: async () => ({ lhr: { audits: {} } }) }
  const [single] = await runLighthouse(['https://a.test/'], broken)
  assert.match(single.error, /undefined|null/)
  const [several] = await runLighthouse(['https://a.test/'], { ...broken, runs: 3 })
  assert.match(several.error, /undefined|null/)
})

test('runLighthouse: scoreSpread copes with runs that report different categories', async () => {
  let n = 0
  const launch = async () => ({ port: 1, kill: async () => {} })
  const lighthouse = async () => {
    const lhr = structuredClone(LHR)
    lhr.categories.performance.score = (n + 5) / 10
    if (n++ === 1) delete lhr.categories.seo
    return { lhr }
  }
  const [result] = await runLighthouse(['https://a.test/'], { launch, lighthouse, runs: 2 })
  assert.deepEqual(result.summary.scoreSpread.performance, [50, 60])
  assert.deepEqual(result.summary.scoreSpread.seo, [50, 50])
})

test('runLighthouse: the median handles a null performance score and takes the lower one for an even count', async () => {
  const median = async (scores) => {
    let n = 0
    const lighthouse = async () => {
      const lhr = structuredClone(LHR)
      lhr.categories.performance.score = scores[n++]
      lhr.categories.seo.score = n / 100
      return { lhr }
    }
    const launch = async () => ({ port: 1, kill: async () => {} })
    const [result] = await runLighthouse(['https://a.test/'], { launch, lighthouse, runs: scores.length })
    return result.summary.scores
  }
  assert.equal((await median([null, 0.8, 0.9])).performance, 80)
  assert.equal((await median([null, null, 0.9])).performance, null)
  assert.equal((await median([0.9, 0.5, 0.7, 0.6])).performance, 60)
  assert.equal((await median([0.7, 0.6])).performance, 60)
})

test('summarize: runs and the score spread sit right after the scores', () => {
  const out = summarize(LHR, { runs: 2, scoreSpread: { seo: [1, 2] } })
  const keys = Object.keys(out)
  assert.deepEqual(keys.slice(keys.indexOf('scores'), keys.indexOf('scores') + 3), ['scores', 'runs', 'scoreSpread'])
})
