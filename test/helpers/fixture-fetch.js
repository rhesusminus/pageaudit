import { readFile } from 'node:fs/promises'

const FIXTURES = new URL('../fixtures/', import.meta.url)
export const FIXTURE_HOST = 'https://fixtures.test'

const CONTENT_TYPES = { xml: 'application/xml', txt: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8' }
const REDIRECTS = { 'redirect-once': '/good.html', 'redirect-twice': '/redirect-once' }

// Replaces globalThis.fetch for the duration of a test. Requests to
// https://fixtures.test/<name> are answered from test/fixtures/<name>, with a
// content type chosen by extension. Special paths simulate other responses:
// /not-html (JSON content type), /timeout, /redirect-once (301 to /good.html)
// and /redirect-twice (301 to /redirect-once). Unknown names answer 404, and
// other origins fail like a DNS error (ENOTFOUND).
export function mockFixtureFetch(t) {
  return t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input)
    if (url.origin !== FIXTURE_HOST) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }
    const name = url.pathname.slice(1)
    if (name === 'timeout') {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    }
    if (name === 'not-html') {
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }
    if (REDIRECTS[name]) {
      return new Response(null, { status: 301, headers: { location: REDIRECTS[name] } })
    }
    let body
    try {
      body = await readFile(new URL(name, FIXTURES), 'utf8')
    } catch {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    }
    const type = CONTENT_TYPES[name.split('.').pop()] ?? CONTENT_TYPES.html
    return new Response(body, { headers: { 'content-type': type } })
  })
}
