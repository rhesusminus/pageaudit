import pkg from '../package.json' with { type: 'json' };

export const USER_AGENT = `pageaudit/${pkg.version} (+https://github.com/rhesusminus/pageaudit)`;
export const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class FetchError extends Error {
  constructor(url, reason) {
    super(`Could not fetch ${url}: ${reason}`);
    this.name = 'FetchError';
    this.reason = reason;
  }
}

function fetchError(url, err, timeout) {
  if (err instanceof FetchError) return err;
  const reason =
    err.name === 'TimeoutError' ? `timed out after ${timeout / 1000}s` : (err.cause?.code ?? err.cause?.message ?? err.message);
  return new FetchError(url, reason);
}

// Throws unless value is an absolute http or https URL.
function httpUrl(url, value, what) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new FetchError(url, `invalid ${what} ${JSON.stringify(value)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchError(url, `unsupported protocol ${parsed.protocol} in ${what}`);
  }
  return parsed;
}

// GET that follows redirects by hand so every hop is recorded. One timeout covers
// the whole chain and the body. Network failures throw a FetchError, HTTP error
// statuses do not.
export async function request(url, { timeout = DEFAULT_TIMEOUT_MS, accept = '*/*' } = {}) {
  const signal = AbortSignal.timeout(timeout);
  const redirects = [];
  let current = httpUrl(url, url, 'URL');
  try {
    for (;;) {
      const res = await fetch(current, { redirect: 'manual', signal, headers: { accept, 'user-agent': USER_AGENT } });
      const location = res.headers.get('location');
      if (!REDIRECT_STATUSES.has(res.status) || location === null) {
        return {
          finalUrl: current.href,
          status: res.status,
          redirects,
          headers: res.headers,
          async bytes() {
            try {
              return new Uint8Array(await res.arrayBuffer());
            } catch (err) {
              throw fetchError(url, err, timeout);
            }
          },
          discard: () => res.body?.cancel().catch(() => {}),
        };
      }
      await res.body?.cancel();
      if (redirects.length === MAX_REDIRECTS) throw new FetchError(url, `more than ${MAX_REDIRECTS} redirects`);
      let target;
      try {
        target = new URL(location, current).href;
      } catch {
        target = location;
      }
      const next = httpUrl(url, target, 'redirect location');
      redirects.push({ url: current.href, status: res.status, location: next.href });
      current = next;
    }
  } catch (err) {
    throw fetchError(url, err, timeout);
  }
}

const charsetParam = (value) => /charset\s*=\s*["']?([^\s;"']+)/i.exec(value)?.[1];

// Canonical encoding name for a label, or undefined if TextDecoder does not know it.
function resolve(label) {
  try {
    return label && new TextDecoder(label).encoding;
  } catch {
    return undefined;
  }
}

function charsetFromBom(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  return undefined;
}

const META_TAG = /<meta(?=[\s/])((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// Simplified WHATWG prescan: <meta charset> or <meta http-equiv="content-type" content="...charset=...">
// within the first 1024 bytes, ignoring comments. A UTF-16 declaration here is treated as UTF-8.
function charsetFromMeta(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  for (const [, attrs] of head.matchAll(META_TAG)) {
    const attr = {};
    for (const [, name, ...values] of attrs.matchAll(ATTRIBUTE)) {
      attr[name.toLowerCase()] ??= values.find((v) => v !== undefined) ?? '';
    }
    const label =
      attr.charset ?? (attr['http-equiv']?.toLowerCase() === 'content-type' ? charsetParam(attr.content ?? '') : undefined);
    const encoding = resolve(label?.trim());
    if (encoding) return encoding.startsWith('utf-16') ? 'utf-8' : encoding;
  }
  return undefined;
}

function decode(bytes, contentType) {
  const encoding = charsetFromBom(bytes) ?? resolve(charsetParam(contentType)) ?? charsetFromMeta(bytes) ?? 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}

// The page-fetching interface the runner depends on. A headless browser can
// replace it later as long as it returns the same shape. html is null unless
// the response is a 200 with an HTML content type.
export async function fetchPage(url, { timeout } = {}) {
  const res = await request(url, { timeout, accept: 'text/html,application/xhtml+xml' });
  const contentType = res.headers.get('content-type') ?? '';
  let html = null;
  if (res.status === 200 && /html/i.test(contentType)) {
    html = decode(await res.bytes(), contentType);
  } else {
    await res.discard();
  }
  return { url, finalUrl: res.finalUrl, status: res.status, redirects: res.redirects, contentType, html };
}
