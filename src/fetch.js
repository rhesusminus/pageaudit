const TIMEOUT_MS = 15000;

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
    const reason = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000}s` : (err.cause?.code ?? err.message);
    throw new Error(`Could not fetch ${url}: ${reason}`);
  }

  if (!res.ok) {
    throw new Error(`Could not fetch ${url}: HTTP ${res.status}`);
  }
  const type = res.headers.get('content-type') ?? '';
  if (!/html/i.test(type)) {
    throw new Error(`Not an HTML page (content-type: ${type || 'none'})`);
  }
  return res.text();
}
