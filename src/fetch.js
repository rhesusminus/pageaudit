import pkg from '../package.json' with { type: 'json' }

export const USER_AGENT = `pageaudit/${pkg.version} (+https://github.com/rhesusminus/pageaudit)`
export const DEFAULT_TIMEOUT_MS = 15000
// Googlebot only reads the first 2 MB of an HTML file, so a page is checked the way it sees it and no more is read.
export const HTML_MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 10
// The encodings Googlebot accepts. Node's fetch decodes all three but only asks for gzip and deflate itself,
// so a server that only offers brotli would otherwise look like it does not compress.
const ACCEPT_ENCODING = 'gzip, deflate, br'
// Googlebot sends no Accept-Language. Node's fetch sends "*" when the header is missing, and some sites answer that
// with a redirect to a random translation, so an empty list, no language preferred, is sent instead.
const ACCEPT_LANGUAGE = ''
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export class FetchError extends Error {
  constructor(url, reason) {
    super(`Could not fetch ${url}: ${reason}`)
    this.name = 'FetchError'
    this.reason = reason
  }
}

function fetchError(url, err, timeout) {
  if (err instanceof FetchError) return err
  const reason =
    err.name === 'TimeoutError'
      ? `timed out after ${timeout / 1000}s`
      : (err.cause?.code ?? err.cause?.message ?? err.message)
  return new FetchError(url, reason)
}

// Throws unless value is an absolute http or https URL.
function httpUrl(url, value, what) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new FetchError(url, `invalid ${what} ${JSON.stringify(value)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchError(url, `unsupported protocol ${parsed.protocol} in ${what}`)
  }
  return parsed
}

// The first `maxBytes` of a body, and whether there was more. Reading stops there, so the rest is never held in
// memory and a failure after the limit cannot spoil what came before it. `maxBytes` can also be a function that
// picks the limit from the first chunk of the body, for a limit that depends on what the body is.
async function readLimited(body, maxBytes) {
  const chunks = []
  let size = 0
  let limit = typeof maxBytes === 'function' ? Infinity : maxBytes
  const reader = body.getReader()
  while (size <= limit) {
    const { done, value } = await reader.read()
    if (done) return { bytes: Buffer.concat(chunks, size), truncated: false }
    if (chunks.length === 0 && typeof maxBytes === 'function') limit = maxBytes(value)
    chunks.push(value)
    size += value.length
  }
  await reader.cancel().catch(() => {})
  return { bytes: Buffer.concat(chunks, limit), truncated: true }
}

// The final answer of a request: where it ended up and how to read the body.
function answer(url, res, current, redirects, timeout) {
  return {
    finalUrl: current.href,
    status: res.status,
    redirects,
    headers: res.headers,
    // { bytes, truncated }: at most `maxBytes` of the body, see readLimited().
    async read(maxBytes) {
      try {
        return res.body ? await readLimited(res.body, maxBytes) : { bytes: new Uint8Array(), truncated: false }
      } catch (err) {
        throw fetchError(url, err, timeout)
      }
    },
    discard: () => res.body?.cancel().catch(() => {})
  }
}

function redirectTarget(url, location, current) {
  let target
  try {
    target = new URL(location, current).href
  } catch {
    target = location
  }
  return httpUrl(url, target, 'redirect location')
}

// GET that follows redirects by hand so every hop is recorded. One timeout covers
// the whole chain and the body. Network failures throw a FetchError, HTTP error
// statuses do not. `maxRedirects` is the number of hops followed before giving up.
// `beforeHop(url)` is awaited before every request of the chain, for pacing requests per host. Time spent waiting
// for it does not count toward the timeout, a long --delay must not make a quick server look slow.
export async function request(
  url,
  { timeout = DEFAULT_TIMEOUT_MS, accept = '*/*', maxRedirects = MAX_REDIRECTS, beforeHop } = {}
) {
  const redirects = []
  let current = httpUrl(url, url, 'URL')
  let spent = 0
  try {
    for (;;) {
      await beforeHop?.(current.href)
      const started = Date.now()
      // The rest of the budget, which also covers reading the body of the last hop.
      const signal = AbortSignal.timeout(Math.max(timeout - spent, 0))
      const res = await fetch(current, {
        redirect: 'manual',
        signal,
        headers: {
          accept,
          'accept-encoding': ACCEPT_ENCODING,
          'accept-language': ACCEPT_LANGUAGE,
          'user-agent': USER_AGENT
        }
      })
      spent += Date.now() - started
      const location = res.headers.get('location')
      if (!REDIRECT_STATUSES.has(res.status) || location === null) return answer(url, res, current, redirects, timeout)
      await res.body?.cancel()
      if (redirects.length === maxRedirects) {
        throw Object.assign(new FetchError(url, `more than ${maxRedirects} redirects`), { tooManyRedirects: true })
      }
      const next = redirectTarget(url, location, current)
      redirects.push({ url: current.href, status: res.status, location: next.href })
      current = next
    }
  } catch (err) {
    throw fetchError(url, err, timeout)
  }
}

const charsetParam = (value) => /charset\s*=\s*["']?([^\s;"']+)/i.exec(value)?.[1]

// Canonical encoding name for a label, or undefined if TextDecoder does not know it.
function resolve(label) {
  try {
    return label && new TextDecoder(label).encoding
  } catch {
    return undefined
  }
}

function charsetFromBom(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  return undefined
}

const META_TAG = /<meta(?=[\s/])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g

// Simplified WHATWG prescan: <meta charset> or <meta http-equiv="content-type" content="...charset=...">
// within the first 1024 bytes, ignoring comments. A UTF-16 declaration here is treated as UTF-8.
function charsetFromMeta(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  for (const [, attrs] of head.matchAll(META_TAG)) {
    const attr = {}
    for (const [, name, ...values] of attrs.matchAll(ATTRIBUTE)) {
      attr[name.toLowerCase()] ??= values.find((v) => v !== undefined) ?? ''
    }
    const label =
      attr.charset ??
      (attr['http-equiv']?.toLowerCase() === 'content-type' ? charsetParam(attr.content ?? '') : undefined)
    const encoding = resolve(label?.trim())
    if (encoding) return encoding.startsWith('utf-16') ? 'utf-8' : encoding
  }
  return undefined
}

function decode(bytes, contentType) {
  const encoding = charsetFromBom(bytes) ?? resolve(charsetParam(contentType)) ?? charsetFromMeta(bytes) ?? 'utf-8'
  return new TextDecoder(encoding).decode(bytes)
}

// The response headers the header checks read, lowercase. A header that was not sent is left out.
const CHECKED_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-content-type-options',
  'x-frame-options',
  'content-encoding'
]

const checkedHeaders = (headers) =>
  Object.fromEntries(CHECKED_HEADERS.filter((name) => headers.has(name)).map((name) => [name, headers.get(name)]))

// The page-fetching interface the runner depends on. A headless browser can
// replace it later as long as it returns the same shape and awaits `beforeHop(url)` before every request, which is
// how the per-host delay reaches redirect hops. html is null unless
// the response is a 200 with an HTML content type, and holds at most the first HTML_MAX_BYTES of it: truncated is
// true when there was more. robotsHeader is the X-Robots-Tag value or null.
// headers holds the CHECKED_HEADERS that were sent, and bodyBytes the decompressed size of the html (null without html).
export async function fetchPage(url, { timeout, beforeHop } = {}) {
  const res = await request(url, { timeout, beforeHop, accept: 'text/html,application/xhtml+xml' })
  const contentType = res.headers.get('content-type') ?? ''
  let html = null
  let bodyBytes = null
  let truncated = false
  if (res.status === 200 && /html/i.test(contentType)) {
    const body = await res.read(HTML_MAX_BYTES)
    html = decode(body.bytes, contentType)
    bodyBytes = body.bytes.length
    truncated = body.truncated
  } else {
    await res.discard()
  }
  return {
    url,
    finalUrl: res.finalUrl,
    status: res.status,
    redirects: res.redirects,
    contentType,
    html,
    truncated,
    robotsHeader: res.headers.get('x-robots-tag'),
    headers: checkedHeaders(res.headers),
    bodyBytes
  }
}
