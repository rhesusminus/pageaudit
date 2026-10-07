import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FetchError } from '../src/fetch.js'
import { auditPage, runAudit } from '../src/runner.js'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

const GOOD = `<html lang="en"><head><title>Good page title here</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:title" content="Good"><meta property="og:description" content="Good page.">
<meta property="og:image" content="https://a.test/og.png"><meta name="twitter:card" content="summary">
<meta name="description" content="A description that is long enough to not be flagged as a short one, really.">
<link rel="canonical" href="https://a.test/good"></head><body><h1>Hello</h1></body></html>`

const page = (url, fields = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  contentType: 'text/html',
  html: GOOD,
  ...fields
})
const types = (result) => result.issues.map((i) => i.type)

test('auditPage: a good page has no issues and exposes facts for the site checks', async () => {
  const result = await auditPage('https://a.test/good', { fetchPage: async (url) => page(url) })
  const { facts, ...rest } = result
  assert.deepEqual(rest, {
    url: 'https://a.test/good',
    finalUrl: 'https://a.test/good',
    status: 200,
    redirects: [],
    issues: []
  })
  assert.equal(facts.title, 'Good page title here')
  assert.deepEqual(facts.h1s, ['Hello'])
  assert.equal(facts.canonical, 'https://a.test/good')
  assert.ok(facts.wordCount > 0)
})

test('auditPage: every issue carries the page URL', async () => {
  const result = await auditPage('https://a.test/x', {
    fetchPage: async (url) => page(url, { html: '<img src="a.jpg">' })
  })
  assert.ok(result.issues.length > 0)
  assert.ok(result.issues.every((i) => i.url === 'https://a.test/x'))
})

test('auditPage: a network error becomes a fetch-failed error', async () => {
  const result = await auditPage('https://a.test/', {
    fetchPage: async (url) => {
      throw new FetchError(url, 'ENOTFOUND')
    }
  })
  assert.deepEqual(types(result), ['fetch-failed'])
  assert.equal(result.issues[0].severity, 'error')
  assert.equal(result.issues[0].message, 'Could not fetch the page: ENOTFOUND')
  assert.equal(result.status, null)
  assert.equal(result.facts, null)
})

test('auditPage: a non-200 status is an error and skips the HTML checks', async () => {
  const result = await auditPage('https://a.test/', {
    fetchPage: async (url) => page(url, { status: 404, html: null })
  })
  assert.deepEqual(types(result), ['http-status'])
  assert.equal(result.issues[0].severity, 'error')
  assert.match(result.issues[0].message, /HTTP 404/)
  assert.equal(result.facts, null)
})

test('auditPage: a non-HTML page is info and skips the HTML checks', async () => {
  const result = await auditPage('https://a.test/f.pdf', {
    fetchPage: async (url) => page(url, { contentType: 'application/pdf', html: null })
  })
  assert.deepEqual(types(result), ['not-html'])
  assert.equal(result.issues[0].severity, 'info')
  assert.match(result.issues[0].message, /application\/pdf/)
})

test('auditPage: one redirect is info, a chain is a warning', async () => {
  const hop = (url, location) => ({ url, status: 301, location })
  const once = await auditPage('http://a.test/', {
    fetchPage: async (url) => page(url, { finalUrl: 'https://a.test/', redirects: [hop(url, 'https://a.test/')] })
  })
  assert.deepEqual(types(once), ['redirect'])
  assert.equal(once.issues[0].context, 'http://a.test/ -> https://a.test/')

  const chain = await auditPage('http://a.test/', {
    fetchPage: async (url) =>
      page(url, {
        finalUrl: 'https://a.test/b',
        redirects: [hop(url, 'https://a.test/'), hop('https://a.test/', 'https://a.test/b')]
      })
  })
  assert.deepEqual(types(chain), ['redirect-chain'])
  assert.equal(chain.issues[0].severity, 'warning')
  assert.equal(chain.issues[0].context, 'http://a.test/ -> https://a.test/ -> https://a.test/b')
})

test('auditPage: passes the timeout to fetchPage', async () => {
  let options
  await auditPage('https://a.test/', {
    timeout: 1234,
    fetchPage: async (url, opts) => {
      options = opts
      return page(url)
    }
  })
  assert.deepEqual(options, { timeout: 1234 })
})

test('runAudit: keeps input order and never exceeds the concurrency limit', async () => {
  const urls = Array.from({ length: 10 }, (_, i) => `https://h${i}.test/`)
  let inFlight = 0
  let maxInFlight = 0
  const fetchPage = async (url) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5 + (urls.indexOf(url) % 3) * 5))
    inFlight--
    return page(url)
  }
  const pages = await runAudit(urls, { fetchPage, concurrency: 3, delay: 0 })
  assert.deepEqual(
    pages.map((p) => p.url),
    urls
  )
  assert.equal(maxInFlight, 3)
})

test('runAudit: spaces requests to the same host but not across hosts', async () => {
  const starts = []
  const fetchPage = async (url) => {
    starts.push({ host: new URL(url).host, at: performance.now() })
    return page(url)
  }
  const urls = ['https://a.test/1', 'https://b.test/1', 'https://a.test/2', 'https://a.test/3']
  const began = performance.now()
  await runAudit(urls, { fetchPage, concurrency: 4, delay: 50 })
  const aStarts = starts.filter((s) => s.host === 'a.test').map((s) => s.at)
  for (let i = 1; i < aStarts.length; i++)
    assert.ok(aStarts[i] - aStarts[i - 1] >= 45, `a.test gap ${aStarts[i] - aStarts[i - 1]}`)
  assert.ok(starts.find((s) => s.host === 'b.test').at - began < 40, 'b.test was delayed')
})

test('runAudit: a failing page does not stop the others and progress counts every page', async () => {
  const progress = []
  const fetchPage = async (url) => {
    if (url.includes('bad')) throw new FetchError(url, 'timed out after 15s')
    return page(url)
  }
  const urls = ['https://a.test/1', 'https://a.test/bad', 'https://a.test/3']
  const pages = await runAudit(urls, { fetchPage, delay: 0, onProgress: (done, total) => progress.push([done, total]) })
  assert.deepEqual(pages.map(types), [[], ['fetch-failed'], []])
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3]
  ])
})

test('runAudit: an empty list resolves to no pages', async () => {
  assert.deepEqual(await runAudit([], { fetchPage: async () => assert.fail('fetched') }), [])
})

test('runAudit: runs the real fetch and checks over the fixture pages', async (t) => {
  mockFixtureFetch(t)
  const urls = ['good.html', 'bad-missing.html', 'redirect-twice', 'nope.html', 'not-html', 'timeout'].map(
    (n) => `${FIXTURE_HOST}/${n}`
  )
  const pages = await runAudit(urls, { delay: 0 })
  assert.deepEqual(pages.map(types), [
    [],
    ['missing-title', 'missing-description', 'missing-canonical', 'missing-h1'],
    ['redirect-chain'],
    ['http-status'],
    ['not-html'],
    ['fetch-failed']
  ])
  assert.equal(pages[2].finalUrl, `${FIXTURE_HOST}/good.html`)
  assert.equal(pages[5].issues[0].message, 'Could not fetch the page: timed out after 15s')
})

test('auditPage: issues keep a fixed key order whichever check built them', async () => {
  const result = await auditPage('https://a.test/', {
    fetchPage: async (url) => page(url, { html: '<img src="a.jpg"><h3>x</h3>' })
  })
  const order = ['url', 'id', 'type', 'severity', 'category', 'source', 'message', 'context', 'selector', 'html']
  for (const issue of result.issues) {
    const keys = Object.keys(issue)
    assert.deepEqual(keys, order.filter((key) => keys.includes(key)).concat(keys.filter((key) => !order.includes(key))))
    assert.deepEqual(keys.slice(0, 8), order.slice(0, 8))
  }
})

test('auditPage: issues carry a stable id and the evidence of the element', async () => {
  const run = () =>
    auditPage('https://a.test/', {
      fetchPage: async (url) => page(url, { html: '<main><img src="a.jpg"><img src="b.jpg"></main>' })
    })
  const { issues } = await run()
  const alts = issues.filter((i) => i.type === 'missing-alt')
  assert.equal(alts.length, 2)
  assert.notEqual(alts[0].id, alts[1].id)
  assert.match(alts[0].id, /^missing-alt-[0-9a-f]{8}$/)
  assert.equal(alts[1].selector, 'html > body > main > img:nth-of-type(2)')
  assert.equal(alts[1].html, '<img src="b.jpg">')
  assert.match(alts[1].parentHtml, /^<main>/)
  assert.deepEqual(
    (await run()).issues.map((i) => i.id),
    issues.map((i) => i.id)
  )
})
