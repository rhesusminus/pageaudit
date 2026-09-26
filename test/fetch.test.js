import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHtml } from '../src/fetch.js';

const respond = (t, body, contentType) =>
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'content-type': contentType } }));

// "Café" encoded as ISO-8859-1 (0xE9), which is invalid UTF-8.
const latin1 = (html) => Uint8Array.from(html, (c) => c.charCodeAt(0));

test('fetch: decodes UTF-8 by default', async (t) => {
  respond(t, '<title>Café</title>', 'text/html');
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>');
});

test('fetch: honors the charset in the Content-Type header', async (t) => {
  respond(t, latin1('<title>Café</title>'), 'text/html; charset=ISO-8859-1');
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>');
});

test('fetch: falls back to <meta charset> when the header has none', async (t) => {
  respond(t, latin1('<meta charset="iso-8859-1"><title>Café</title>'), 'text/html');
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/);
});

test('fetch: unknown charset falls back to UTF-8 instead of throwing', async (t) => {
  respond(t, '<title>ok</title>', 'text/html; charset=not-a-charset');
  assert.equal(await fetchHtml('https://x.test/'), '<title>ok</title>');
});

test('fetch: a timeout while reading the body gets the friendly message', async (t) => {
  const body = new ReadableStream({
    pull(controller) {
      controller.error(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    },
  });
  respond(t, body, 'text/html');
  await assert.rejects(fetchHtml('https://x.test/'), /Could not fetch https:\/\/x\.test\/: timed out after 15s/);
});
