import { readFile } from 'node:fs/promises'

const FIXTURES = new URL('../fixtures/', import.meta.url)
export const FIXTURE_HOST = 'https://fixtures.test'

const CONTENT_TYPES = { xml: 'application/xml', txt: 'text/plain; charset=utf-8', html: 'text/html; charset=utf-8' }
// Every fixture page is served with these, so the header checks only fire where a test asks for it.
const SECURE_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
}
// Fixture pages served with other response headers. An undefined value leaves out a secure default.
const HEADER_PAGES = {
  'noindex-header.html': { 'x-robots-tag': 'noindex' },
  'weak-headers.html': {
    'strict-transport-security': undefined,
    'x-content-type-options': undefined,
    'x-frame-options': undefined,
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    'content-security-policy-report-only': "frame-ancestors 'none'"
  }
}
const REDIRECTS = { 'redirect-once': '/good.html', 'redirect-twice': '/redirect-once' }

// Replaces globalThis.fetch for the duration of a test. Requests to
// https://fixtures.test/<name> are answered from test/fixtures/<name>, with a
// content type chosen by extension. Special paths simulate other responses:
// /noindex-header.html (a page served with an X-Robots-Tag: noindex header), /weak-headers.html (no security
// headers and a weak Content-Security-Policy), /not-html (JSON content type), /timeout, /redirect-once (301 to /good.html)
// and /redirect-twice (301 to /redirect-once), /server-error (500). Unknown names answer 404, and
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
    if (name === 'server-error') {
      return new Response('Internal error', { status: 500, headers: { 'content-type': 'text/html' } })
    }
    if (name === 'not-html') {
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }
    if (REDIRECTS[name]) {
      return new Response(null, { status: 301, headers: { location: REDIRECTS[name] } })
    }
    const headers = Object.entries({ ...SECURE_HEADERS, ...HEADER_PAGES[name] }).filter(
      ([, value]) => value !== undefined
    )
    let body
    try {
      body = await readFile(new URL(name, FIXTURES), 'utf8')
    } catch {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } })
    }
    const type = CONTENT_TYPES[name.split('.').pop()] ?? CONTENT_TYPES.html
    return new Response(body, { headers: [['content-type', type], ...headers] })
  })
}
