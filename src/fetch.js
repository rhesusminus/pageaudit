const TIMEOUT_MS = 15000;

function fetchError(url, err) {
  const reason = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (err.cause?.code ?? err.message);
  return new Error(`Could not fetch ${url}: ${reason}`);
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

export async function fetchHtml(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  let res;
  try {
    res = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
  } catch (err) {
    throw fetchError(url, err);
  }

  if (!res.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/html/i.test(type)) {
    throw new Error(`Not an HTML page (content-type: ${type || 'none'})`);
  }

  let bytes;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    throw fetchError(url, err);
  }
  return decode(bytes, type);
}
