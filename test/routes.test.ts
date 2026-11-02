import dns from 'node:dns/promises'
import type { TestContext } from 'node:test'
import { beforeEach, test } from 'node:test'
import { build } from '../src/api/app.ts'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'
import { mockFetch } from './helpers/mock-fetch.js'

beforeEach((t) => {
  const context = t as TestContext
  context.mock.method(dns, 'lookup', async () => [{ address: '93.184.215.14', family: 4 }])
})

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

test('POST /audits: rejects private destinations before making a request', async (t: TestContext) => {
  const fetched = mockFetch(t, async () => new Response('private data'))
  const app = makeApp(t)
  for (const url of ['http://localhost', 'http://127.1', 'http://10.0.0.1', 'http://[::1]', 'http://169.254.169.254']) {
    const response = await app.inject({ method: 'POST', url: '/audits', body: { url } })
    t.assert.strictEqual(response.statusCode, 400)
  }
  t.assert.strictEqual(fetched.mock.callCount(), 0)
})

test('POST /audits: rejects hostnames resolving to private addresses', async (t: TestContext) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '192.168.1.1', family: 4 }])
  const fetched = mockFetch(t, async () => new Response('private data'))
  const response = await makeApp(t).inject({ method: 'POST', url: '/audits', body: { url: 'https://internal.test' } })
  t.assert.strictEqual(response.statusCode, 400)
  t.assert.strictEqual(fetched.mock.callCount(), 0)
})

test('POST /audits: stops a public redirect chain before its private destination', async (t: TestContext) => {
  const fetched = mockFetch(
    t,
    async (url: URL) =>
      new Response(null, {
        status: 302,
        headers: { location: String(url).endsWith('/start') ? '/next' : 'http://10.0.0.1' }
      })
  )
  const response = await makeApp(t).inject({ method: 'POST', url: '/audits', body: { url: `${FIXTURE_HOST}/start` } })
  t.assert.strictEqual(response.statusCode, 502)
  t.assert.deepStrictEqual(
    fetched.mock.calls.map(({ arguments: [url] }: { arguments: [URL] }) => String(url)),
    [`${FIXTURE_HOST}/start`, `${FIXTURE_HOST}/next`]
  )
})

// Stores an audit through the API and returns its id.
const createAudit = async (t: TestContext, app: ReturnType<typeof makeApp>) => {
  mockFixtureFetch(t)
  const response = await app.inject({ method: 'POST', url: '/audits', body: { url: `${FIXTURE_HOST}/good.html` } })

  return response.json().id as string
}

test('audit IDs are independent UUIDv4 values usable for fetching and deleting', async (t: TestContext) => {
  const app = makeApp(t)
  const firstId = await createAudit(t, app)
  const secondId = await createAudit(t, app)
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  t.assert.match(firstId, uuidV4)
  t.assert.match(secondId, uuidV4)
  t.assert.notStrictEqual(firstId, secondId)

  const fetched = await app.inject({ method: 'GET', url: `/audits/${firstId}` })
  t.assert.strictEqual(fetched.statusCode, 200)
  t.assert.strictEqual(fetched.json().id, firstId)

  const deleted = await app.inject({ method: 'DELETE', url: `/audits/${firstId}` })
  t.assert.strictEqual(deleted.statusCode, 204)
  const other = await app.inject({ method: 'GET', url: `/audits/${secondId}` })
  t.assert.strictEqual(other.statusCode, 200)
  t.assert.strictEqual(other.json().id, secondId)
  await app.inject({ method: 'DELETE', url: `/audits/${secondId}` })
})

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
