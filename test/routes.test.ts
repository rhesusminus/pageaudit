import type { TestContext } from 'node:test'
import { test } from 'node:test'
import { build } from '../src/api/app.ts'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

// build() returns a fresh app per test, and close() releases it afterwards.
const makeApp = (t: TestContext) => {
  const app = build()
  t.after(() => app.close())

  return app
}

test('POST /audits: returns the fetched page facts', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const response = await app.inject({
    method: 'POST',
    url: '/audits',
    body: { url: `${FIXTURE_HOST}/good.html` }
  })

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.deepStrictEqual(response.json(), {
    url: `${FIXTURE_HOST}/good.html`,
    finalUrl: `${FIXTURE_HOST}/good.html`,
    status: 200
  })
})

test('POST /audits: reports the final URL after a redirect', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const response = await app.inject({
    method: 'POST',
    url: '/audits',
    body: { url: `${FIXTURE_HOST}/redirect-once` }
  })

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.strictEqual(response.json().finalUrl, `${FIXTURE_HOST}/good.html`)
})

test('POST /audits: rejects a body without a url (schema)', async (t: TestContext) => {
  const app = makeApp(t)

  const response = await app.inject({ method: 'POST', url: '/audits', body: {} })

  t.assert.strictEqual(response.statusCode, 400)
})

test('POST /audits: rejects a URL that cannot be audited', async (t: TestContext) => {
  const app = makeApp(t)

  const response = await app.inject({ method: 'POST', url: '/audits', body: { url: 'ftp://example.com' } })

  t.assert.strictEqual(response.statusCode, 400)
  t.assert.match(response.json().error, /unsupported protocol/)
})

test('POST /audits: answers 502 when the page cannot be fetched', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const response = await app.inject({
    method: 'POST',
    url: '/audits',
    body: { url: `${FIXTURE_HOST}/timeout` }
  })

  t.assert.strictEqual(response.statusCode, 502)
  t.assert.deepStrictEqual(response.json(), { error: 'Could not fetch page' })
})
