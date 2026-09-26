import { readFile } from 'node:fs/promises';

const FIXTURES = new URL('../fixtures/', import.meta.url);
export const FIXTURE_HOST = 'https://fixtures.test';

// Replaces globalThis.fetch for the duration of a test. Requests to
// https://fixtures.test/<name> are answered from test/fixtures/<name>.
// Special paths simulate failures: /not-found, /not-html, /timeout.
export function mockFixtureFetch(t) {
  return t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    if (url.origin !== FIXTURE_HOST) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }
    const name = url.pathname.slice(1);
    if (name === 'timeout') {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    }
    if (name === 'not-html') {
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    }
    let html;
    try {
      html = await readFile(new URL(name, FIXTURES), 'utf8');
    } catch {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } });
    }
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
}
