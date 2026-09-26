const TIMEOUT_MS = 15000;

function fetchError(url, err) {
  const reason = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (err.cause?.code ?? err.message);
  return new Error(`Could not fetch ${url}: ${reason}`);
}

const charsetFromHeader = (contentType) => /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];

// <meta charset> and <meta http-equiv content="...charset=..."> are only honored near the top of the document.
function charsetFromMeta(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return /<meta[^>]+charset\s*=\s*["']?([^\s"';>/]+)/i.exec(head)?.[1];
}

function decode(bytes, contentType) {
  const label = charsetFromHeader(contentType) ?? charsetFromMeta(bytes) ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
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
