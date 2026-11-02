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
  const { id, ...body } = response.json()
  t.assert.deepStrictEqual(body, {
    url: `${FIXTURE_HOST}/good.html`,
    finalUrl: `${FIXTURE_HOST}/good.html`
  })
  t.assert.ok(id)
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

// Stores an audit through the API and returns its id.
const createAudit = async (t: TestContext, app: ReturnType<typeof makeApp>) => {
  mockFixtureFetch(t)
  const response = await app.inject({ method: 'POST', url: '/audits', body: { url: `${FIXTURE_HOST}/good.html` } })

  return response.json().id as string
}

test('DELETE /audits/:id: removes the audit so it can no longer be fetched', async (t: TestContext) => {
  const app = makeApp(t)
  const id = await createAudit(t, app)

  const deleted = await app.inject({ method: 'DELETE', url: `/audits/${id}` })
  const fetched = await app.inject({ method: 'GET', url: `/audits/${id}` })

  t.assert.strictEqual(deleted.statusCode, 204)
  t.assert.strictEqual(fetched.statusCode, 404)
})

test('DELETE /audits/:id: answers 404 for an unknown audit', async (t: TestContext) => {
  const app = makeApp(t)

  const response = await app.inject({ method: 'DELETE', url: '/audits/does-not-exist' })

  t.assert.strictEqual(response.statusCode, 404)
  t.assert.deepStrictEqual(response.json(), { error: 'Audit not found' })
})

test('DELETE /audits/:id: answers 404 when the audit is already deleted', async (t: TestContext) => {
  const app = makeApp(t)
  const id = await createAudit(t, app)
  await app.inject({ method: 'DELETE', url: `/audits/${id}` })

  const response = await app.inject({ method: 'DELETE', url: `/audits/${id}` })

  t.assert.strictEqual(response.statusCode, 404)
})
