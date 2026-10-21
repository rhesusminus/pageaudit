import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkLinks } from '../src/checks/site/links.js'
import { internalLinks } from '../src/checks/page/index.js'
import { hostThrottle } from '../src/concurrency.js'
import { checkLinkTargets, linksComplete, linkTargets } from '../src/links.js'
import { parse } from '../src/parse.js'

// Starts every request at once, so tests do not wait for the per-host delay.
const noPace = async () => {}

// An audited HTML page with the given internal link targets.
const page = (url, links = [], fields = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues: [],
  facts: {},
  links,
  ...fields
})

// A request stub that answers from a table of { status, finalUrl, redirects, html, contentType } or throws
// { reason }, and records calls. An answer with html is an HTML page, one without is a plain text body.
function stubRequest(table) {
  const calls = []
  const request = async (url) => {
    calls.push(url)
    const { html = null, contentType, ...answer } = { status: 200, ...table[url] }
    if (answer.reason) throw Object.assign(new Error('fetch failed'), { reason: answer.reason })
    const type = contentType ?? (html === null ? 'text/plain' : 'text/html; charset=utf-8')
    return {
      finalUrl: url,
      redirects: [],
      ...answer,
      headers: new Headers({ 'content-type': type }),
      read: async () => ({ bytes: Buffer.from(html ?? ''), truncated: false }),
      discard: async () => {}
    }
  }
  return { request, calls }
}

const withCanonical = (href) => `<html><head><link rel="canonical" href="${href}"></head><body></body></html>`

const outcomesOf = (entries) =>
  new Map(entries.map(([url, outcome]) => [url, { finalUrl: url, redirects: [], ...outcome }]))
const brief = (issues) => issues.map(({ type, context, urls }) => [type, context, urls])

test('internalLinks: resolved against <base>, fragments dropped, deduplicated by exact URL, never cut short', () => {
  const long = `/${'a'.repeat(2100)}`
  const $ = parse(`<head><base href="https://a.test/dir/"></head><body>
    <a href="x">X</a><a href="x#part">X again</a><a href="/x/">X with slash</a><a href="#top">Top</a>
    <a href="https://www.a.test/w">www</a><a href="https://other.test/">Out</a><a href="mailto:a@a.test">Mail</a>
    <a href="${long}">Long</a></body>`)
  assert.deepEqual(internalLinks($, 'https://a.test/page'), [
    'https://a.test/dir/x',
    'https://a.test/x/',
    'https://www.a.test/w',
    `https://a.test${long}`
  ])
})

test('linkTargets: each target lists its linking pages, the most linked first', () => {
  const pages = [
    page('https://a.test/1', ['https://a.test/rare', 'https://a.test/nav']),
    page('https://a.test/2', ['https://a.test/nav'])
  ]
  assert.deepEqual(linkTargets(pages), [
    { url: 'https://a.test/nav', from: ['https://a.test/1', 'https://a.test/2'] },
    { url: 'https://a.test/rare', from: ['https://a.test/1'] }
  ])
})

test('checkLinkTargets: audited pages cost no request, by the URL given or the final URL', async () => {
  const pages = [
    page(
      'https://a.test/old',
      ['https://a.test/old', 'https://a.test/new', 'https://a.test/gone', 'https://a.test/other'],
      {
        finalUrl: 'https://a.test/new',
        redirects: [{ url: 'https://a.test/old', status: 301, location: 'https://a.test/new' }]
      }
    ),
    page('https://a.test/gone', [], { finalUrl: null, status: null, facts: null, links: null })
  ]
  const { request, calls } = stubRequest({})
  const { outcomes, unchecked } = await checkLinkTargets(pages, { request, pace: noPace })
  assert.deepEqual(calls, ['https://a.test/other'])
  assert.equal(unchecked, 0)
  assert.equal(outcomes.get('https://a.test/old').redirects.length, 1)
  assert.deepEqual(outcomes.get('https://a.test/new'), {
    status: 200,
    finalUrl: 'https://a.test/new',
    redirects: [],
    canonical: null
  })
  assert.match(outcomes.get('https://a.test/gone').failed, /could not be fetched/)
})

test('checkLinkTargets: counts the pages whose own links could not all be read', async () => {
  const pages = [
    page('https://a.test/1'),
    page('https://a.test/deep', [], { facts: null, links: null, issues: [{ type: 'check-failed' }] }),
    page('https://a.test/large', [], { issues: [{ type: 'html-too-large' }] }),
    page('https://a.test/gone', [], { finalUrl: null, status: null, facts: null, links: null })
  ]
  const { unread } = await checkLinkTargets(pages, { request: stubRequest({}).request, pace: noPace })
  assert.equal(unread, 2)
})

test('checkLinkTargets: past the cap the targets linked from the fewest pages are left unchecked', async () => {
  const pages = [
    page('https://a.test/1', ['https://a.test/rare', 'https://a.test/nav']),
    page('https://a.test/2', ['https://a.test/nav'])
  ]
  const { request, calls } = stubRequest({})
  const { outcomes, unchecked } = await checkLinkTargets(pages, { request, pace: noPace, max: 1 })
  assert.deepEqual(calls, ['https://a.test/nav'])
  assert.equal(unchecked, 1)
  assert.equal(outcomes.has('https://a.test/rare'), false)
  assert.deepEqual(checkLinks(pages, outcomes), [])
})

test('checkLinkTargets: a failed request becomes an outcome with the reason', async () => {
  const { request } = stubRequest({ 'https://a.test/slow': { reason: 'timed out after 15s' } })
  const { outcomes } = await checkLinkTargets([page('https://a.test/', ['https://a.test/slow'])], {
    request,
    pace: noPace
  })
  assert.deepEqual(outcomes.get('https://a.test/slow'), { failed: 'timed out after 15s' })
})

test('checkLinkTargets: an HTML target gives its canonical, resolved like an audited page, other answers none', async () => {
  const { request } = stubRequest({
    'https://a.test/collections/hair/products/oil': { html: withCanonical('/products/oil') },
    'https://a.test/plain': { html: '<html><head><title>No canonical</title></head></html>' },
    'https://a.test/file.pdf': { contentType: 'application/pdf' },
    'https://a.test/missing': { status: 404, html: withCanonical('/elsewhere') }
  })
  const targets = Object.keys({
    'https://a.test/collections/hair/products/oil': 0,
    'https://a.test/plain': 0,
    'https://a.test/file.pdf': 0,
    'https://a.test/missing': 0
  })
  const { outcomes } = await checkLinkTargets([page('https://a.test/', targets)], { request, pace: noPace })
  assert.deepEqual(
    targets.map((url) => outcomes.get(url).canonical),
    ['https://a.test/products/oil', null, null, null]
  )
})

test('checkLinkTargets: an audited target gives the canonical of its facts, and a body that fails is a failed target', async () => {
  const audited = page('https://a.test/b', [], { facts: { canonical: 'https://a.test/c' } })
  const request = async (url) => ({
    status: 200,
    finalUrl: url,
    redirects: [],
    headers: new Headers({ 'content-type': 'text/html' }),
    read: async () => {
      throw new Error('timed out after 15s')
    },
    discard: async () => {}
  })
  const { outcomes } = await checkLinkTargets(
    [page('https://a.test/', ['https://a.test/b', 'https://a.test/slow-body']), audited],
    { request, pace: noPace }
  )
  assert.equal(outcomes.get('https://a.test/b').canonical, 'https://a.test/c')
  assert.deepEqual(outcomes.get('https://a.test/slow-body'), { failed: 'timed out after 15s' })
})

test('checkLinkTargets: a target that redirected is not read, and HTML is asked for first', async () => {
  const accepted = []
  let read = false
  const request = async (url, { accept }) => {
    accepted.push(accept)
    return {
      status: 200,
      finalUrl: 'https://a.test/new',
      redirects: [{ url, status: 301, location: 'https://a.test/new' }],
      headers: new Headers({ 'content-type': 'text/html' }),
      read: async () => {
        read = true
        return { bytes: Buffer.from(''), truncated: false }
      },
      discard: async () => {}
    }
  }
  const { outcomes } = await checkLinkTargets([page('https://a.test/', ['https://a.test/old'])], {
    request,
    pace: noPace
  })
  assert.equal(outcomes.get('https://a.test/old').canonical, null)
  assert.equal(read, false)
  assert.deepEqual(accepted, ['text/html,application/xhtml+xml,*/*;q=0.8'])
})

test('checkLinkTargets: pace is awaited before every request it makes, redirect hops included', async () => {
  const pace = async () => {}
  const passed = []
  const request = async (url, { beforeHop }) => {
    passed.push(beforeHop)
    return { status: 200, finalUrl: url, redirects: [], headers: new Headers(), discard: async () => {} }
  }
  await checkLinkTargets([page('https://a.test/', ['https://a.test/x', 'https://a.test/y'])], { request, pace })
  assert.deepEqual(passed, [pace, pace])
})

test('hostThrottle: requests to one host start at least the delay apart, other hosts do not wait', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const wait = hostThrottle(40)
  await wait('https://a.test/1')
  await wait('https://b.test/1')
  let started = false
  const second = wait('https://a.test/2').then(() => (started = true))
  t.mock.timers.tick(39)
  await Promise.resolve()
  assert.equal(started, false)
  t.mock.timers.tick(1)
  await second
  assert.equal(started, true)
})

test('hostThrottle: waiters that are all overdue still start the delay apart', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const wait = hostThrottle(40)
  const started = []
  const waiters = [1, 2, 3].map((n) => wait(`https://a.test/${n}`).then(() => started.push([n, Date.now()])))
  // The event loop is busy for 200 ms, as when a large page is checked, so every timer is late.
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  await flush()
  t.mock.timers.tick(200)
  await flush()
  assert.deepEqual(started, [
    [1, 0],
    [2, 200]
  ])
  t.mock.timers.tick(40)
  await Promise.all(waiters)
  assert.deepEqual(started.at(-1), [3, 240])
})

test('checkLinks: broken, unreachable and redirecting targets, one issue each with the pages linking to them', () => {
  const targets = [
    'https://a.test/404',
    'https://a.test/500',
    'https://a.test/slow',
    'https://a.test/moved',
    'https://a.test/chain',
    'https://a.test/ok'
  ]
  const pages = [page('https://a.test/1', targets), page('https://a.test/2', ['https://a.test/404'])]
  const outcomes = outcomesOf([
    ['https://a.test/404', { status: 404 }],
    ['https://a.test/500', { status: 503 }],
    ['https://a.test/slow', { failed: 'timed out after 15s' }],
    ['https://a.test/moved', { status: 200, finalUrl: 'https://a.test/moved/', redirects: [{ status: 301 }] }],
    [
      'https://a.test/chain',
      { status: 200, finalUrl: 'https://a.test/end', redirects: [{ status: 301 }, { status: 302 }] }
    ],
    ['https://a.test/ok', { status: 200 }],
    ...pages.map((p) => [p.url, { status: 200 }])
  ])
  assert.deepEqual(brief(checkLinks(pages, outcomes)), [
    ['broken-link', 'https://a.test/404 (HTTP 404)', ['https://a.test/1', 'https://a.test/2']],
    ['link-target-unreachable', 'https://a.test/500 (HTTP 503)', ['https://a.test/1']],
    ['link-target-unreachable', 'https://a.test/slow (timed out after 15s)', ['https://a.test/1']],
    ['link-to-redirect', 'https://a.test/moved -> https://a.test/moved/ (301)', ['https://a.test/1']],
    ['link-to-redirect', 'https://a.test/chain -> https://a.test/end (301, 302)', ['https://a.test/1']]
  ])
})

test('checkLinks: a target whose canonical is another page is one issue, a trailing slash or a redirect is not', () => {
  const targets = [
    'https://a.test/collections/hair/products/oil',
    'https://a.test/products/oil?utm_source=menu',
    'https://a.test/self',
    'https://a.test/moved',
    'https://a.test/gone',
    'https://a.test/none',
    'https://a.test/script'
  ]
  const pages = [page('https://a.test/1', targets), page('https://a.test/2', [targets[0]])]
  const outcomes = outcomesOf([
    ['https://a.test/collections/hair/products/oil', { status: 200, canonical: 'https://a.test/products/oil' }],
    ['https://a.test/products/oil?utm_source=menu', { status: 200, canonical: 'https://a.test/products/oil' }],
    ['https://a.test/self', { status: 200, canonical: 'https://a.test/self/' }],
    [
      'https://a.test/moved',
      { status: 200, finalUrl: 'https://a.test/new', redirects: [{ status: 301 }], canonical: 'https://a.test/x' }
    ],
    ['https://a.test/gone', { status: 404, canonical: 'https://a.test/x' }],
    ['https://a.test/none', { status: 200, canonical: null }],
    ['https://a.test/script', { status: 200, canonical: 'javascript:alert(1)' }],
    ...pages.map((p) => [p.url, { status: 200 }])
  ])
  assert.deepEqual(brief(checkLinks(pages, outcomes)), [
    [
      'link-to-non-canonical',
      'https://a.test/collections/hair/products/oil -> canonical https://a.test/products/oil',
      ['https://a.test/1', 'https://a.test/2']
    ],
    [
      'link-to-non-canonical',
      'https://a.test/products/oil?utm_source=menu -> canonical https://a.test/products/oil',
      ['https://a.test/1']
    ],
    ['link-to-redirect', 'https://a.test/moved -> https://a.test/new (301)', ['https://a.test/1']],
    ['broken-link', 'https://a.test/gone (HTTP 404)', ['https://a.test/1']]
  ])
})

test('checkLinks: login pages and rate limits are not broken, and a redirect to an error is only the error', () => {
  const targets = ['https://a.test/401', 'https://a.test/403', 'https://a.test/429', 'https://a.test/old']
  const outcomes = outcomesOf([
    ['https://a.test/401', { status: 401 }],
    ['https://a.test/403', { status: 403 }],
    ['https://a.test/429', { status: 429 }],
    ['https://a.test/old', { status: 410, finalUrl: 'https://a.test/new', redirects: [{ status: 301 }] }]
  ])
  assert.deepEqual(brief(checkLinks([page('https://a.test/1', targets)], outcomes)), [
    ['link-target-unreachable', 'https://a.test/429 (HTTP 429)', ['https://a.test/1']],
    ['broken-link', 'https://a.test/old -> https://a.test/new (HTTP 410)', ['https://a.test/1']]
  ])
})

test('checkLinks: orphan pages are sitemap pages no other page links to, also not through a redirect', () => {
  const listed = new Map(
    ['/', '/linked', '/via-redirect', '/self', '/lonely'].map((path) => [`https://a.test${path}`, []])
  )
  const pages = [
    page('https://a.test/', ['https://a.test/linked/', 'https://a.test/old', 'https://a.test/lonely/']),
    page('https://a.test/linked'),
    page('https://a.test/via-redirect'),
    page('https://a.test/self', ['https://a.test/self']),
    page('https://a.test/lonely'),
    page('https://a.test/not-in-sitemap')
  ]
  // Every link has an outcome, as when the orphan check runs. /lonely/ is broken, so it is no link to /lonely.
  const outcomes = outcomesOf([
    ['https://a.test/linked/', { status: 200, finalUrl: 'https://a.test/linked', redirects: [{ status: 301 }] }],
    ['https://a.test/old', { status: 200, finalUrl: 'https://a.test/via-redirect', redirects: [{ status: 301 }] }],
    ['https://a.test/lonely/', { status: 404 }],
    ['https://a.test/self', { status: 200 }]
  ])
  const orphans = checkLinks(pages, outcomes, { orphans: true, listed }).filter((issue) => issue.type === 'orphan-page')
  assert.deepEqual(brief(orphans), [
    ['orphan-page', '2 of 5 sitemap pages', ['https://a.test/self', 'https://a.test/lonely']]
  ])
  assert.deepEqual(
    checkLinks(pages, outcomes, { listed }).filter((issue) => issue.type === 'orphan-page'),
    []
  )
})

test('checkLinks: addresses in the context are kept whole, the final address is what the link should become', () => {
  const target = `https://a.test/${'vanha-osoite-'.repeat(8)}`
  const finalUrl = `https://a.test/${'uusi-osoite-'.repeat(8)}`
  const outcomes = outcomesOf([[target, { status: 200, finalUrl, redirects: [{ status: 301 }] }]])
  const [issue] = checkLinks([page('https://a.test/1', [target])], outcomes)
  assert.equal(issue.context, `${target} -> ${finalUrl} (301)`)
})

test('checkLinks: a long failure reason is cut, the address is not', () => {
  const target = `https://a.test/${'osoite-'.repeat(20)}`
  const outcomes = new Map([[target, { failed: `invalid redirect location "${'x'.repeat(5000)}"` }]])
  const [issue] = checkLinks([page('https://a.test/1', [target])], outcomes)
  assert.ok(issue.context.startsWith(`${target} (invalid redirect location`))
  assert.ok(issue.context.length < target.length + 130)
})

test('checkLinkTargets: a page reached through a redirect with a fragment is known without it', async () => {
  const pages = [
    page('https://a.test/old', ['https://a.test/target'], {
      finalUrl: 'https://a.test/target#section',
      redirects: [{ url: 'https://a.test/old', status: 301, location: 'https://a.test/target#section' }]
    })
  ]
  const { request, calls } = stubRequest({})
  const { outcomes } = await checkLinkTargets(pages, { request, pace: noPace })
  assert.deepEqual(calls, [])
  assert.equal(outcomes.get('https://a.test/target').status, 200)
})

test('linksComplete: only when nothing was left unchecked and every destination is known', () => {
  const ok = outcomesOf([
    ['https://a.test/a', { status: 200 }],
    ['https://a.test/b', { status: 404 }]
  ])
  assert.equal(linksComplete({ outcomes: ok, unchecked: 0, unread: 0 }), true)
  assert.equal(linksComplete({ outcomes: ok, unchecked: 1, unread: 0 }), false)
  assert.equal(linksComplete({ outcomes: ok, unchecked: 0, unread: 1 }), false)
  for (const unknown of [{ failed: 'timed out after 15s' }, { status: 503 }, { status: 429 }]) {
    const outcomes = outcomesOf([
      ['https://a.test/a', { status: 200 }],
      ['https://a.test/alias', unknown]
    ])
    assert.equal(linksComplete({ outcomes, unchecked: 0, unread: 0 }), false, JSON.stringify(unknown))
  }
})
