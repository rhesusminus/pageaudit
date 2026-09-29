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

test('fetch: a UTF-8 BOM wins over the header charset', async (t) => {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  respond(t, new Uint8Array([...bom, ...new TextEncoder().encode('<title>Café</title>')]), 'text/html; charset=iso-8859-1');
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>');
});

test('fetch: a UTF-16LE BOM is honored', async (t) => {
  const body = new Uint8Array([0xff, 0xfe, ...[...'<title>Café</title>'].flatMap((c) => [c.charCodeAt(0), 0])]);
  respond(t, body, 'text/html');
  assert.equal(await fetchHtml('https://x.test/'), '<title>Café</title>');
});

test('fetch: charset= inside another meta tag\'s content is not a declaration', async (t) => {
  const html = '<meta name="description" content="Set charset=koi8-r here"><meta charset="utf-8"><title>Café</title>';
  respond(t, html, 'text/html');
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/);
});

test('fetch: honors <meta http-equiv="content-type"> charset', async (t) => {
  respond(t, latin1('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Café</title>'), 'text/html');
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/);
});

test('fetch: a meta-declared UTF-16 charset is treated as UTF-8', async (t) => {
  respond(t, '<meta charset="utf-16"><title>Café</title>', 'text/html');
  assert.match(await fetchHtml('https://x.test/'), /<title>Café<\/title>/);
});

test('fetch: an unknown header charset falls through to <meta charset>', async (t) => {
  respond(t, latin1('<meta charset="iso-8859-1"><title>Café</title>'), 'text/html; charset=bogus');
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

test('fetch: a cause with a message but no code is surfaced', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: new Error('bad port') });
  });
  await assert.rejects(fetchHtml('http://x.test:6000/'), /Could not fetch http:\/\/x\.test:6000\/: bad port/);
});

test('fetch: a cause with a code prefers the code', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  });
  await assert.rejects(fetchHtml('http://x.test/'), /Could not fetch http:\/\/x\.test\/: ECONNREFUSED$/);
});
