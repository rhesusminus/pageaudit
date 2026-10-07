import { test } from 'node:test'
import assert from 'node:assert/strict'
import robotsParser from 'robots-parser'
import { checkRobotsTxt } from '../src/checks/site/robots.js'
import { checkSitemapEntries } from '../src/checks/site/sitemap.js'
import { checkRobotsHeader, googleRules } from '../src/checks/page/robots-header.js'
import { fetchPage } from '../src/fetch.js'
import { loadRobots } from '../src/robots.js'

const types = (issues) => issues.map((i) => i.type)

test('X-Robots-Tag: rules without an agent and for googlebot apply, other agents do not', () => {
  assert.deepEqual(googleRules('noindex'), ['noindex'])
  assert.deepEqual(googleRules('googlebot: noindex'), ['noindex'])
  assert.deepEqual(googleRules('bingbot: noindex'), [])
  assert.deepEqual(googleRules('nofollow, bingbot: noindex, googlebot: noarchive'), ['nofollow', 'noarchive'])
  assert.deepEqual(googleRules('max-snippet:-1, noindex'), ['max-snippet:-1', 'noindex'])
  assert.deepEqual(googleRules('unavailable_after: 2027-01-01'), ['unavailable_after: 2027-01-01'])
  assert.deepEqual(googleRules('NoIndex'), ['noindex'])
})

test('X-Robots-Tag: noindex and nofollow become issues with the header as context', () => {
  const issues = checkRobotsHeader({ robotsHeader: 'noindex, nofollow' })
  assert.deepEqual(types(issues), ['noindex', 'nofollow'])
  assert.deepEqual(
    issues.map((i) => i.severity),
    ['warning', 'info']
  )
  assert.equal(issues[0].context, 'X-Robots-Tag: noindex, nofollow')
  assert.deepEqual(types(checkRobotsHeader({ robotsHeader: 'none' })), ['noindex', 'nofollow'])
})

test('X-Robots-Tag: other agents, harmless rules and no header give no issues', () => {
  assert.deepEqual(checkRobotsHeader({ robotsHeader: 'bingbot: noindex' }), [])
  assert.deepEqual(checkRobotsHeader({ robotsHeader: 'unavailable_after: 2027-01-01' }), [])
  assert.deepEqual(checkRobotsHeader({ robotsHeader: null }), [])
  assert.deepEqual(checkRobotsHeader({}), [])
})

test('fetch: the X-Robots-Tag header is returned, repeated headers are joined', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    const headers = new Headers({ 'content-type': 'text/html' })
    headers.append('x-robots-tag', 'noindex')
    headers.append('x-robots-tag', 'nofollow')
    return new Response('<title>x</title>', { headers })
  })
  assert.equal((await fetchPage('https://x.test/')).robotsHeader, 'noindex, nofollow')
})

const respond = (t, status, body = '') =>
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(body, { status, headers: { 'content-type': 'text/plain' } })
  )

test('loadRobots: a 200 is parsed, other 4xx mean no file, 5xx and 429 are unreachable', async (t) => {
  respond(t, 200, 'User-agent: *\nDisallow: /private')
  const ok = await loadRobots('https://x.test')
  assert.equal(ok.status, 'ok')
  assert.equal(ok.parser.isDisallowed('https://x.test/private/a', 'Googlebot'), true)
  assert.equal(ok.parser.isDisallowed('https://x.test/public', 'Googlebot'), false)
  for (const status of [404, 403, 410]) {
    respond(t, status)
    assert.deepEqual(await loadRobots('https://x.test'), { status: 'missing' }, String(status))
  }
  for (const status of [500, 503, 429]) {
    respond(t, status)
    assert.deepEqual(await loadRobots('https://x.test'), { status: 'unreachable', code: status }, String(status))
  }
})

test('loadRobots: a network failure returns null', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
  })
  assert.equal(await loadRobots('https://x.test'), null)
})

test('loadRobots: only the first 500 KiB are read', async (t) => {
  respond(t, 200, `${'#'.repeat(500 * 1024)}\nUser-agent: *\nDisallow: /`)
  const { parser } = await loadRobots('https://x.test')
  assert.equal(parser.isDisallowed('https://x.test/a', 'Googlebot'), false)
})

const page = (url, fields = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues: [],
  facts: {},
  ...fields
})
const load = (files) => async (origin) => files[origin] ?? null
const robots = (origin, text) => ({ status: 'ok', parser: robotsParser(`${origin}/robots.txt`, text) })

test('robots.txt check: blocked pages are listed per origin, allowed ones are not', async () => {
  const pages = [page('https://a.test/'), page('https://a.test/private/x'), page('https://b.test/private/x')]
  const issues = await checkRobotsTxt(pages, {
    load: load({
      'https://a.test': robots('https://a.test', 'User-agent: *\nDisallow: /private/'),
      'https://b.test': robots('https://b.test', '')
    })
  })
  assert.deepEqual(
    issues.map(({ type, urls, severity }) => [type, urls, severity]),
    [['blocked-by-robots', ['https://a.test/private/x'], 'warning']]
  )
})

test('robots.txt check: the Googlebot group wins over *, longer allow rules win, wildcards work', async () => {
  const text = 'User-agent: *\nDisallow: /\nUser-agent: Googlebot\nDisallow: /a\nAllow: /a/ok\nDisallow: /*.pdf$'
  const pages = ['/a/x', '/a/ok', '/b', '/f.pdf', '/f.pdf?x=1'].map((path) => page(`https://a.test${path}`))
  const [issue] = await checkRobotsTxt(pages, { load: load({ 'https://a.test': robots('https://a.test', text) }) })
  assert.deepEqual(issue.urls, ['https://a.test/a/x', 'https://a.test/f.pdf'])
})

test('robots.txt check: the final URL is tested and the input URL is reported', async () => {
  const pages = [page('https://a.test/old', { finalUrl: 'https://a.test/new/x' })]
  const [issue] = await checkRobotsTxt(pages, {
    load: load({ 'https://a.test': robots('https://a.test', 'User-agent: *\nDisallow: /new/') })
  })
  assert.deepEqual(issue.urls, ['https://a.test/old'])
})

test('robots.txt check: unreachable is info, missing and network failures give nothing, each origin is read once', async () => {
  const asked = []
  const files = { 'https://a.test': { status: 'unreachable', code: 503 }, 'https://b.test': { status: 'missing' } }
  const issues = await checkRobotsTxt(
    [page('https://a.test/1'), page('https://a.test/2'), page('https://b.test/'), page('https://c.test/')],
    {
      load: async (origin) => (asked.push(origin), files[origin] ?? null)
    }
  )
  assert.deepEqual(asked, ['https://a.test', 'https://b.test', 'https://c.test'])
  assert.deepEqual(
    issues.map(({ type, urls, severity }) => [type, urls, severity]),
    [['robots-txt-unreachable', ['https://a.test/1', 'https://a.test/2'], 'info']]
  )
})

test('robots.txt check: pages that did not load are not tested', async () => {
  const pages = [
    page('https://a.test/private/', { status: 404 }),
    page('https://a.test/gone', { finalUrl: null, status: null })
  ]
  const issues = await checkRobotsTxt(pages, {
    load: async () => assert.fail('robots.txt was read for a page that did not load')
  })
  assert.deepEqual(issues, [])
})

const listed = (...urls) => new Map(urls.map((url) => [url, ['https://a.test/sitemap.xml']]))
const noindexIssue = { type: 'noindex' }

test('sitemap check: noindex, canonical elsewhere and redirects are reported for listed pages only', () => {
  const pages = [
    page('https://a.test/noindex', { issues: [noindexIssue] }),
    page('https://a.test/dup', { facts: { canonical: 'https://a.test/other' } }),
    page('https://a.test/old', {
      finalUrl: 'https://a.test/new',
      redirects: [{ url: 'https://a.test/old', status: 301 }]
    }),
    page('https://a.test/fine', { facts: { canonical: 'https://a.test/fine/' } }),
    page('https://a.test/not-listed', { issues: [noindexIssue] })
  ]
  const issues = checkSitemapEntries(pages, listed(...pages.slice(0, 4).map((p) => p.url)))
  assert.deepEqual(
    issues.map(({ type, urls, severity, context }) => [type, urls, severity, context]),
    [
      ['sitemap-url-noindex', ['https://a.test/noindex'], 'warning', 'https://a.test/sitemap.xml'],
      ['sitemap-url-not-canonical', ['https://a.test/dup'], 'warning', 'https://a.test/sitemap.xml'],
      ['sitemap-url-redirects', ['https://a.test/old'], 'info', 'https://a.test/sitemap.xml']
    ]
  )
})

test('sitemap check: without a sitemap, or with only clean pages, there are no issues', () => {
  assert.deepEqual(checkSitemapEntries([page('https://a.test/', { issues: [noindexIssue] })]), [])
  assert.deepEqual(checkSitemapEntries([page('https://a.test/')], listed('https://a.test/')), [])
  assert.deepEqual(
    checkSitemapEntries(
      [page('https://a.test/', { finalUrl: null, status: null, facts: null })],
      listed('https://a.test/')
    ),
    []
  )
})

test('sitemap check: the context names every sitemap the pages came from', () => {
  const map = new Map([
    ['https://a.test/1', ['https://a.test/s1.xml']],
    ['https://a.test/2', ['https://a.test/s1.xml', 'https://a.test/s2.xml']]
  ])
  const pages = [
    page('https://a.test/1', { issues: [noindexIssue] }),
    page('https://a.test/2', { issues: [noindexIssue] })
  ]
  assert.equal(checkSitemapEntries(pages, map)[0].context, 'https://a.test/s1.xml, https://a.test/s2.xml')
})
