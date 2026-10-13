import { test } from 'node:test'
import assert from 'node:assert/strict'
import robotsParser from 'robots-parser'
import { checkRobotsTxt } from '../src/checks/site/robots.js'
import {
  checkSitemapDeclared,
  checkSitemapEntries,
  checkSitemapFiles,
  checkSitemapHosts
} from '../src/checks/site/sitemap.js'
import { checkRobotsHeader, googleRules, mergeRobotsIssues } from '../src/checks/page/robots-header.js'
import { fetchPage } from '../src/fetch.js'
import { auditPage } from '../src/runner.js'
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
  const issues = checkRobotsHeader({ robotsHeader: 'noindex, nofollow', status: 200 })
  assert.deepEqual(types(issues), ['noindex', 'nofollow'])
  assert.deepEqual(
    issues.map((i) => i.severity),
    ['warning', 'info']
  )
  assert.equal(issues[0].context, 'X-Robots-Tag: noindex, nofollow')
  assert.deepEqual(types(checkRobotsHeader({ robotsHeader: 'none', status: 200 })), ['noindex', 'nofollow'])
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

test('loadRobots: beforeHop is awaited before every request, redirect hops included', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) =>
    String(input) === 'http://x.test/robots.txt'
      ? new Response(null, { status: 301, headers: { location: 'https://x.test/robots.txt' } })
      : new Response('User-agent: *\nAllow: /', { headers: { 'content-type': 'text/plain' } })
  )
  const hops = []
  const robots = await loadRobots('http://x.test', { beforeHop: async (url) => hops.push(url) })
  assert.equal(robots.status, 'ok')
  assert.deepEqual(hops, ['http://x.test/robots.txt', 'https://x.test/robots.txt'])
})

test('loadRobots: a network failure is a failed read with its reason', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
  })
  assert.deepEqual(await loadRobots('https://x.test'), { status: 'failed', reason: 'ECONNRESET' })
})

test('loadRobots: only the first 500 KiB are read', async (t) => {
  respond(t, 200, `${'#'.repeat(500 * 1024)}\nUser-agent: *\nDisallow: /`)
  const { parser } = await loadRobots('https://x.test')
  assert.equal(parser.isDisallowed('https://x.test/a', 'Googlebot'), false)
})

test('loadRobots: a connection that drops after the first 500 KiB does not fail the read', async (t) => {
  const rules = 'User-agent: *\nDisallow: /private/\n'
  const chunks = [rules.padEnd(500 * 1024 + 1, '#')]
  const body = new ReadableStream({
    pull(controller) {
      if (chunks.length) controller.enqueue(new TextEncoder().encode(chunks.shift()))
      else controller.error(Object.assign(new TypeError('terminated'), { cause: { code: 'ECONNRESET' } }))
    }
  })
  respond(t, 200, body)
  const robots = await loadRobots('https://x.test')
  assert.equal(robots.status, 'ok')
  assert.equal(robots.parser.isDisallowed('https://x.test/private/a', 'Googlebot'), true)
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

test('robots.txt check: unreachable and failed reads are info, a missing file gives nothing, each origin is read once', async () => {
  const asked = []
  const files = {
    'https://a.test': { status: 'unreachable', code: 503 },
    'https://b.test': { status: 'missing' },
    'https://c.test': { status: 'failed', reason: 'timed out after 15s' }
  }
  const issues = await checkRobotsTxt(
    [page('https://a.test/1'), page('https://a.test/2'), page('https://b.test/'), page('https://c.test/')],
    {
      load: async (origin) => (asked.push(origin), files[origin])
    }
  )
  assert.deepEqual(asked, ['https://a.test', 'https://b.test', 'https://c.test'])
  assert.deepEqual(
    issues.map(({ type, urls, severity }) => [type, urls, severity]),
    [
      ['robots-txt-unreachable', ['https://a.test/1', 'https://a.test/2'], 'info'],
      ['robots-txt-failed', ['https://c.test/'], 'info']
    ]
  )
  assert.match(issues[1].message, /timed out after 15s/)
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

const listing = (url) => ({ sitemap: 'https://a.test/sitemap.xml', url })
const listed = (...urls) => new Map(urls.map((url) => [url, [listing(url)]]))
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
    ['https://a.test/1', [{ sitemap: 'https://a.test/s1.xml', url: 'https://a.test/1' }]],
    [
      'https://a.test/2',
      [
        { sitemap: 'https://a.test/s1.xml', url: 'https://a.test/2' },
        { sitemap: 'https://a.test/s2.xml', url: 'https://a.test/2' }
      ]
    ]
  ])
  const pages = [
    page('https://a.test/1', { issues: [noindexIssue] }),
    page('https://a.test/2', { issues: [noindexIssue] })
  ]
  assert.equal(checkSitemapEntries(pages, map)[0].context, 'https://a.test/s1.xml, https://a.test/s2.xml')
})

// Review fixes.

test('X-Robots-Tag: only a 200 response is checked, error pages are often noindex on purpose', () => {
  assert.deepEqual(checkRobotsHeader({ robotsHeader: 'noindex', status: 404 }), [])
  assert.deepEqual(checkRobotsHeader({ robotsHeader: 'noindex', status: 503 }), [])
  assert.deepEqual(types(checkRobotsHeader({ robotsHeader: 'noindex', status: 200 })), ['noindex'])
})

test('X-Robots-Tag: a digit in a date is not a user agent, a prefix has to start with a letter', () => {
  assert.deepEqual(googleRules('unavailable_after: 1 July 2028, 16:00 GMT, noindex'), [
    'unavailable_after: 1 july 2028',
    '16:00 gmt',
    'noindex'
  ])
})

test('X-Robots-Tag: a generic header after one for another crawler is read as that crawler (known limit)', () => {
  assert.deepEqual(googleRules('bingbot: nofollow, noindex'), [])
})

test('noindex in the meta tag and the header is one finding with both sources', async () => {
  const html =
    '<html lang="en"><head><meta name="robots" content="noindex, nofollow"><meta name="viewport" content="x"></head>'
  const result = await auditPage('https://a.test/', {
    fetchPage: async (url) => ({
      url,
      finalUrl: url,
      status: 200,
      redirects: [],
      contentType: 'text/html',
      html,
      robotsHeader: 'noindex, nofollow'
    })
  })
  const robots = result.issues.filter((i) => ['noindex', 'nofollow'].includes(i.type))
  assert.deepEqual(
    robots.map((i) => i.type),
    ['noindex', 'nofollow']
  )
  assert.match(robots[0].context, /X-Robots-Tag: noindex, nofollow and <meta name="robots"/)
})

test('a 404 with a noindex header is only an http-status error', async () => {
  const result = await auditPage('https://a.test/', {
    fetchPage: async (url) => ({
      url,
      finalUrl: url,
      status: 404,
      redirects: [],
      contentType: 'text/html',
      html: null,
      robotsHeader: 'noindex'
    })
  })
  assert.deepEqual(types(result.issues), ['http-status'])
})

test('sitemap check: pages that did not load get no sitemap findings', () => {
  const pages = [page('https://a.test/gone', { status: 404, issues: [noindexIssue], redirects: [{ status: 301 }] })]
  assert.deepEqual(checkSitemapEntries(pages, listed('https://a.test/gone')), [])
})

test('sitemap check: a redirect is only blamed on a sitemap that lists the URL that was fetched', () => {
  const redirected = (url) => page(url, { finalUrl: 'https://a.test/blog/', redirects: [{ url, status: 301 }] })
  const other = new Map([['https://a.test/blog', [{ sitemap: 'https://a.test/s.xml', url: 'https://a.test/blog/' }]]])
  assert.deepEqual(checkSitemapEntries([redirected('https://a.test/blog')], other), [])
  const same = new Map([['https://a.test/blog', [{ sitemap: 'https://a.test/s.xml', url: 'https://a.test/blog' }]]])
  assert.deepEqual(types(checkSitemapEntries([redirected('https://a.test/blog')], same)), ['sitemap-url-redirects'])
})

test('robots.txt check: origins are read at the same time and the issues keep their order', async () => {
  const started = []
  const release = []
  const gate = (origin) =>
    new Promise((resolve) => {
      started.push(origin)
      release.push(() => resolve(robots(origin, 'User-agent: *\nDisallow: /')))
    })
  const pending = checkRobotsTxt([page('https://a.test/x'), page('https://b.test/y')], { load: gate })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(started, ['https://a.test', 'https://b.test'])
  release.reverse().forEach((fn) => fn())
  assert.deepEqual(
    (await pending).map((i) => i.urls[0]),
    ['https://a.test/x', 'https://b.test/y']
  )
})

test('loadRobots: more than five redirects count as no file, a body that cannot be read is a failed read', async (t) => {
  let hops = 0
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(null, { status: 301, headers: { location: `/r${++hops}` } })
  )
  assert.deepEqual(await loadRobots('https://x.test'), { status: 'missing' })
  assert.equal(hops, 6)
  t.mock.method(globalThis, 'fetch', async () => {
    const body = new ReadableStream({ pull: (controller) => controller.error(new Error('reset')) })
    return new Response(body, { status: 200 })
  })
  assert.deepEqual(await loadRobots('https://x.test'), { status: 'failed', reason: 'reset' })
})

test('noindex from a long header and the meta tag keep both sources in the context', () => {
  const header = `X-Robots-Tag: googlebot: noindex, ${'max-snippet: 20, '.repeat(8)}notranslate`
  const merged = mergeRobotsIssues([
    { type: 'noindex', context: header.slice(0, 117) + '...' },
    { type: 'other', context: 'x' },
    { type: 'noindex', context: '<meta name="robots" content="noindex">' }
  ])
  assert.deepEqual(
    merged.map((i) => i.type),
    ['noindex', 'other']
  )
  assert.ok(merged[0].context.length <= 120)
  assert.match(merged[0].context, /^X-Robots-Tag: googlebot: noindex.*\.\.\. and <meta name="robots" content="noind/)
})

test('robots.txt check: no more than eight origins are read at once', async () => {
  let running = 0
  let peak = 0
  const pages = Array.from({ length: 20 }, (_, i) => page(`https://h${i}.test/`))
  await checkRobotsTxt(pages, {
    load: async () => {
      peak = Math.max(peak, ++running)
      await new Promise((resolve) => setImmediate(resolve))
      running--
      return { status: 'missing' }
    }
  })
  assert.equal(peak, 8)
})

const ok = (...sitemaps) => ({
  status: 'ok',
  parser: robotsParser('https://a.test/robots.txt', sitemaps.map((s) => `Sitemap: ${s}`).join('\n'))
})
const file = (fields) => ({
  url: 'https://a.test/sitemap.xml',
  kind: 'urlset',
  tooLarge: false,
  entries: 0,
  emptyLocs: 0,
  locs: [],
  lastmods: [],
  ...fields
})

test('sitemap files: size, entries, bad and duplicate locs and bad dates are reported per file', () => {
  const issues = checkSitemapFiles([
    file({ entries: 50_001, tooLarge: true }),
    file({
      url: 'https://a.test/b.xml',
      emptyLocs: 2,
      locs: ['/relative', 'ftp://a.test/x', 'https://a.test/1', 'https://a.test/1', 'http://', 'https://[broken'],
      lastmods: [
        { loc: 'https://a.test/1', value: '2026-03-31' },
        { loc: 'https://a.test/1', value: '2026-02-30' },
        { loc: 'https://a.test/1', value: '31/03/2026' },
        { loc: 'https://a.test/1', value: '2026-03-31T10:00:00+02:00' },
        { loc: 'https://a.test/1', value: '2026-03-31T10:00' }
      ]
    })
  ])
  const byType = Object.fromEntries(issues.map((i) => [i.type, i]))
  assert.deepEqual(Object.keys(byType), [
    'sitemap-too-many-urls',
    'sitemap-too-large',
    'sitemap-empty-loc',
    'sitemap-loc-relative',
    'sitemap-loc-malformed',
    'sitemap-loc-not-http',
    'sitemap-duplicate-loc',
    'sitemap-invalid-lastmod'
  ])
  assert.deepEqual(byType['sitemap-too-many-urls'].urls, ['https://a.test/sitemap.xml'])
  assert.equal(byType['sitemap-too-large'].context, 'https://a.test/sitemap.xml')
  assert.deepEqual(byType['sitemap-empty-loc'].urls, ['https://a.test/b.xml'])
  assert.equal(
    byType['sitemap-invalid-lastmod'].context,
    'https://a.test/b.xml: "2026-02-30", "31/03/2026", "2026-03-31T10:00"'
  )
  assert.equal(byType['sitemap-duplicate-loc'].context, 'https://a.test/b.xml: https://a.test/1')
  assert.deepEqual(checkSitemapFiles([file({ entries: 50_000 })]), [])
})

test('sitemap hosts: another host is only reported when its robots.txt does not name the sitemap', async () => {
  const files = [
    file({ locs: ['https://a.test/1', 'https://named.test/1', 'https://silent.test/1', 'https://down.test/1'] })
  ]
  const robots = {
    'https://named.test': ok('https://a.test/sitemap.xml'),
    'https://silent.test': ok('https://other.test/sitemap.xml'),
    'https://down.test': { status: 'failed', reason: 'timeout' }
  }
  const issues = await checkSitemapHosts(files, { load: async (origin) => robots[origin] })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].type, 'sitemap-off-host')
  assert.equal(issues[0].severity, 'info')
  assert.equal(issues[0].context, 'https://a.test/sitemap.xml lists https://silent.test, https://down.test')
  assert.deepEqual(
    await checkSitemapHosts([file({ locs: ['https://a.test/1'] })], { load: async () => assert.fail() }),
    []
  )
})

test('no-sitemap-declared: only a robots.txt that was read and has no Sitemap line is reported', async () => {
  const pages = ['https://a.test/1', 'https://b.test/', 'https://c.test/', 'https://d.test/'].map((url) => ({
    url,
    finalUrl: url,
    status: 200
  }))
  const robots = {
    'https://a.test': ok(),
    'https://b.test': ok('https://b.test/s.xml'),
    'https://c.test': { status: 'missing' }
  }
  const issues = await checkSitemapDeclared(pages, { load: async (origin) => robots[origin] })
  assert.equal(issues.length, 1)
  assert.equal(issues[0].type, 'no-sitemap-declared')
  assert.equal(issues[0].context, 'https://a.test/robots.txt')
  assert.deepEqual(issues[0].urls, ['https://a.test/1'])
})

test('sitemap hosts: equivalent spellings of the sitemap address match, and a redirected sitemap belongs to its final host', async () => {
  const named = ok('https://A.TEST/sitemap.xml')
  const files = [file({ locs: ['https://b.test/1'] })]
  assert.deepEqual(await checkSitemapHosts(files, { load: async () => named }), [])
  const moved = [
    file({ url: 'https://old.test/s.xml', finalUrl: 'https://new.test/s.xml', locs: ['https://new.test/1'] })
  ]
  assert.deepEqual(await checkSitemapHosts(moved, { load: async () => assert.fail() }), [])
})
