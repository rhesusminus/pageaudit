import dns from 'node:dns/promises'
import type { TestContext } from 'node:test'
import { test } from 'node:test'
import { type App, makeApp, resolvePublicly, waitForAudit } from './helpers/app.ts'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'
import { mockFetch } from './helpers/mock-fetch.js'

resolvePublicly()

const postAudit = (app: App, url: string) => app.inject({ method: 'POST', url: '/audits', body: { url } })

// Queues an audit through the API, waits for it to finish and returns it.
const runAudit = async (app: App, url: string) => {
  const response = await postAudit(app, url)
  if (response.statusCode !== 202) throw new Error(`expected 202, got ${response.statusCode}: ${response.body}`)

  return waitForAudit(app, response.json().id)
}

test('POST /audits: queues the audit and links to it', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const response = await postAudit(app, `${FIXTURE_HOST}/good.html`)

  t.assert.strictEqual(response.statusCode, 202)
  const { id, status } = response.json()
  t.assert.strictEqual(status, 'queued')
  t.assert.strictEqual(response.headers.location, `/audits/${id}`)
  await waitForAudit(app, id)
})

test('GET /audits/:id: returns the completed audit with the fetched page facts', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const audit = await runAudit(app, `${FIXTURE_HOST}/good.html`)

  t.assert.strictEqual(audit.status, 'completed')
  t.assert.strictEqual(audit.error, null)
  t.assert.strictEqual(audit.url, `${FIXTURE_HOST}/good.html`)
  t.assert.strictEqual(audit.result.finalUrl, `${FIXTURE_HOST}/good.html`)
  t.assert.strictEqual(audit.result.status, 200)
})

test('GET /audits/:id: reports the final URL after a redirect', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const audit = await runAudit(app, `${FIXTURE_HOST}/redirect-once`)

  t.assert.strictEqual(audit.status, 'completed')
  t.assert.strictEqual(audit.result.finalUrl, `${FIXTURE_HOST}/good.html`)
})

test('GET /audits/:id: reports a page that cannot be fetched as a failed audit', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const audit = await runAudit(app, `${FIXTURE_HOST}/timeout`)

  t.assert.strictEqual(audit.status, 'failed')
  t.assert.strictEqual(audit.error, 'Could not fetch page')
  t.assert.strictEqual(audit.result, null)
})

test('POST /audits: answers with the validation message for a body without a url', async (t: TestContext) => {
  const response = await makeApp(t).inject({ method: 'POST', url: '/audits', body: {} })

  t.assert.strictEqual(response.statusCode, 400)
  t.assert.deepStrictEqual(response.json(), { error: "body must have required property 'url'" })
})

test('POST /audits: answers with the parser message for a malformed JSON body', async (t: TestContext) => {
  const response = await makeApp(t).inject({
    method: 'POST',
    url: '/audits',
    headers: { 'content-type': 'application/json' },
    payload: '{"url":'
  })

  t.assert.strictEqual(response.statusCode, 400)
  t.assert.match(response.json().error, /JSON/)
})

test('POST /audits: rejects a URL that cannot be audited', async (t: TestContext) => {
  const response = await postAudit(makeApp(t), 'ftp://example.com')

  t.assert.strictEqual(response.statusCode, 400)
  t.assert.match(response.json().error, /unsupported protocol/)
})

test('POST /audits: rejects a hostname that does not resolve', async (t: TestContext) => {
  t.mock.method(dns, 'lookup', async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND missing.test'), { code: 'ENOTFOUND' })
  })

  const response = await postAudit(makeApp(t), 'https://missing.test')

  t.assert.strictEqual(response.statusCode, 400)
  t.assert.deepStrictEqual(response.json(), { error: 'Could not resolve host missing.test' })
})

test('POST /audits: answers 503 when DNS fails temporarily', async (t: TestContext) => {
  t.mock.method(dns, 'lookup', async () => {
    throw Object.assign(new Error('getaddrinfo EAI_AGAIN flaky.test'), { code: 'EAI_AGAIN' })
  })

  const response = await postAudit(makeApp(t), 'https://flaky.test')

  t.assert.strictEqual(response.statusCode, 503)
  t.assert.deepStrictEqual(response.json(), { error: 'Could not resolve host flaky.test, try again later' })
})

test('POST /audits: rejects private destinations before making a request', async (t: TestContext) => {
  const fetched = mockFetch(t, async () => new Response('private data'))
  const app = makeApp(t)
  for (const url of ['http://localhost', 'http://127.1', 'http://10.0.0.1', 'http://[::1]', 'http://169.254.169.254']) {
    const response = await postAudit(app, url)
    t.assert.strictEqual(response.statusCode, 400)
  }
  t.assert.strictEqual(fetched.mock.callCount(), 0)
})

test('POST /audits: rejects hostnames resolving to private addresses', async (t: TestContext) => {
  t.mock.method(dns, 'lookup', async () => [{ address: '192.168.1.1', family: 4 }])
  const fetched = mockFetch(t, async () => new Response('private data'))
  const response = await postAudit(makeApp(t), 'https://internal.test')
  t.assert.strictEqual(response.statusCode, 400)
  t.assert.strictEqual(fetched.mock.callCount(), 0)
})

test('GET /audits/:id: fails an audit whose redirect chain leads to a private destination', async (t: TestContext) => {
  const fetched = mockFetch(
    t,
    async (url: URL) =>
      new Response(null, {
        status: 302,
        headers: { location: String(url).endsWith('/start') ? '/next' : 'http://10.0.0.1' }
      })
  )
  const audit = await runAudit(makeApp(t), `${FIXTURE_HOST}/start`)
  t.assert.strictEqual(audit.status, 'failed')
  t.assert.strictEqual(audit.error, 'Could not fetch page')
  t.assert.deepStrictEqual(
    fetched.mock.calls.map(({ arguments: [url] }: { arguments: [URL] }) => String(url)),
    [`${FIXTURE_HOST}/start`, `${FIXTURE_HOST}/next`]
  )
})

// Stores a finished audit through the API and returns its id.
const createAudit = async (t: TestContext, app: App) => {
  mockFixtureFetch(t)

  return (await runAudit(app, `${FIXTURE_HOST}/good.html`)).id as string
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

test('unknown routes answer 404 in the same error shape', async (t: TestContext) => {
  const response = await makeApp(t).inject({ method: 'GET', url: '/nope' })

  t.assert.strictEqual(response.statusCode, 404)
  t.assert.deepStrictEqual(response.json(), { error: 'Not found' })
})
