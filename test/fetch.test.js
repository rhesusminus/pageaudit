import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchPage, USER_AGENT } from '../src/fetch.js'

const fetchHtml = async (url) => (await fetchPage(url)).html

const respond = (t, body, contentType) =>
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'content-type': contentType } }))

// "Café" encoded as ISO-8859-1 (0xE9), which is invalid UTF-8.
const latin1 = (html) => Uint8Array.from(html, (c) => c.charCodeAt(0))

test('fetch: decodes UTF-8 by default', async (t) => {
  respond(t, '<title>Café</title>', 'text/html')
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>')
})

test('fetch: honors the charset in the Content-Type header', async (t) => {
  respond(t, latin1('<title>Café</title>'), 'text/html; charset=ISO-8859-1')
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>')
})

test('fetch: falls back to <meta charset> when the header has none', async (t) => {
  respond(t, latin1('<meta charset="iso-8859-1"><title>Café</title>'), 'text/html')
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/)
})

test('fetch: a UTF-8 BOM wins over the header charset', async (t) => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf])
  respond(
    t,
    new Uint8Array([...bom, ...new TextEncoder().encode('<title>Café</title>')]),
    'text/html; charset=iso-8859-1'
  )
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>')
})

test('fetch: a UTF-16LE BOM is honored', async (t) => {
  const body = new Uint8Array([0xff, 0xfe, ...[...'<title>Café</title>'].flatMap((c) => [c.charCodeAt(0), 0])])
  respond(t, body, 'text/html')
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>')
})

test("fetch: charset= inside another meta tag's content is not a declaration", async (t) => {
  const html = '<meta name="description" content="Set charset=koi8-r here"><meta charset="utf-8"><title>Café</title>'
  respond(t, html, 'text/html')
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/)
})

test('fetch: honors <meta http-equiv="content-type"> charset', async (t) => {
  respond(
    t,
    latin1('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Café</title>'),
    'text/html'
  )
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/)
})

test('fetch: a meta-declared UTF-16 charset is treated as UTF-8', async (t) => {
  respond(t, '<meta charset="utf-16"><title>Café</title>', 'text/html')
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/)
})

test('fetch: an unknown header charset falls through to <meta charset>', async (t) => {
  respond(t, latin1('<meta charset="iso-8859-1"><title>Café</title>'), 'text/html; charset=bogus')
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/)
})

test('fetch: unknown charset falls back to UTF-8 instead of throwing', async (t) => {
  respond(t, '<title>ok</title>', 'text/html; charset=not-a-charset')
  assert.equal(await fetchHtml('https://x.test/'), '<title>ok</title>')
})

test('fetch: a timeout while reading the body gets the friendly message', async (t) => {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
    }
  })
  respond(t, body, 'text/html')
  await assert.rejects(fetchHtml('https://x.test/'), /Could not fetch https:\/\/x\.test\/: timed out after 15s/)
})

test('fetch: a cause with a message but no code is surfaced', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: new Error('bad port') })
  })
  await assert.rejects(fetchHtml('http://x.test:6000/'), /Could not fetch http:\/\/x\.test:6000\/: bad port/)
})

test('fetch: a cause with a code prefers the code', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    })
  })
  await assert.rejects(fetchHtml('http://x.test/'), /Could not fetch http:\/\/x\.test\/: ECONNREFUSED$/)
})

// Answers each request from a map of URL -> Response factory and records the requests.
function serve(t, routes) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    requests.push({ url: String(input), init })
    const route = routes[String(input)]
    if (!route) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
    return route()
  })
  return requests
}

const html =
  (body = '<title>ok</title>') =>
  () =>
    new Response(body, { headers: { 'content-type': 'text/html' } })
const redirect =
  (location, status = 301) =>
  () =>
    new Response(null, { status, headers: { location } })

test('fetch: sends the pageaudit User-Agent and does not let fetch follow redirects', async (t) => {
  const requests = serve(t, { 'https://x.test/': html() })
  await fetchPage('https://x.test/')
  assert.match(USER_AGENT, /^pageaudit\/\d+\.\d+\.\d+ /)
  assert.equal(requests[0].init.headers['user-agent'], USER_AGENT)
  assert.equal(requests[0].init.redirect, 'manual')
})

test('fetch: follows redirects and records every hop', async (t) => {
  serve(t, {
    'http://x.test/a': redirect('https://x.test/a'),
    'https://x.test/a': redirect('/b', 302),
    'https://x.test/b': html()
  })
  const page = await fetchPage('http://x.test/a')
  assert.equal(page.url, 'http://x.test/a')
  assert.equal(page.finalUrl, 'https://x.test/b')
  assert.equal(page.status, 200)
  assert.equal(page.html, '<title>ok</title>')
  assert.deepEqual(page.redirects, [
    { url: 'http://x.test/a', status: 301, location: 'https://x.test/a' },
    { url: 'https://x.test/a', status: 302, location: 'https://x.test/b' }
  ])
})

test('fetch: a redirect loop stops after 10 hops', async (t) => {
  serve(t, { 'https://x.test/a': redirect('/b'), 'https://x.test/b': redirect('/a') })
  await assert.rejects(fetchPage('https://x.test/a'), (err) => err.reason === 'more than 10 redirects')
})

test('fetch: a redirect to a non-http protocol fails', async (t) => {
  serve(t, { 'https://x.test/': redirect('ftp://x.test/file') })
  await assert.rejects(fetchPage('https://x.test/'), /unsupported protocol ftp: in redirect location/)
})

test('fetch: error statuses and non-HTML responses return no html', async (t) => {
  serve(t, {
    'https://x.test/missing': () => new Response('gone', { status: 404, headers: { 'content-type': 'text/html' } }),
    'https://x.test/data': () => new Response('{}', { headers: { 'content-type': 'application/json' } })
  })
  assert.deepEqual(await fetchPage('https://x.test/missing'), {
    url: 'https://x.test/missing',
    finalUrl: 'https://x.test/missing',
    status: 404,
    redirects: [],
    contentType: 'text/html',
    html: null,
    robotsHeader: null
  })
  const data = await fetchPage('https://x.test/data')
  assert.equal(data.status, 200)
  assert.equal(data.contentType, 'application/json')
  assert.equal(data.html, null)
})

test('fetch: invalid and non-http URLs are rejected before any request', async (t) => {
  const requests = serve(t, {})
  await assert.rejects(fetchPage('not a url'), /invalid URL "not a url"/)
  await assert.rejects(fetchPage('ftp://x.test/'), /unsupported protocol ftp: in URL/)
  assert.equal(requests.length, 0)
})
