import type { TestContext } from 'node:test'
import { test } from 'node:test'
import { answersTo } from '../src/api/allowed-host.ts'
import { build } from '../src/api/app.ts'
import { type App, isolateNetwork, makeApp } from './helpers/app.ts'

isolateNetwork()

// The Host a browser sends after a site it visits has pointed its own name at this machine (DNS rebinding).
const REBOUND = { host: 'attacker.example:8080' }

const HOST_ERROR = { error: 'This server only answers at localhost, an IP address or the host of PUBLIC_URL' }

const storedAudits = async (app: App) =>
  (app.db.prepare('SELECT count(*) AS n FROM audits').get() as { n: number } | undefined)?.n

test('answersTo: localhost, IP addresses and the public host, on any port', (t: TestContext) => {
  const cases: Record<string, boolean> = {
    localhost: true,
    'localhost:8080': true,
    'LOCALHOST:8080': true,
    'app.localhost:8080': true,
    '127.0.0.1:8080': true,
    '192.168.1.20': true,
    '[::1]:8080': true,
    'audit.example': true,
    'AUDIT.example:443': true,
    'attacker.example:8080': false,
    'localhost.attacker.example': false,
    '127.0.0.1.attacker.example': false,
    'audit.example.attacker.example': false,
    'localhost@attacker.example': false,
    '': false
  }

  for (const [host, expected] of Object.entries(cases)) {
    t.assert.strictEqual(answersTo(host, 'audit.example'), expected, host)
  }
  t.assert.strictEqual(answersTo('audit.example'), false)
})

test('host: the API refuses a request for another host, so a rebound page cannot queue or read audits', async (t: TestContext) => {
  const app = makeApp(t, { allowPrivateDestinations: true })
  const { id } = (await app.inject({ method: 'POST', url: '/audits', body: { url: 'https://example.com/' } })).json()

  const queued = await app.inject({
    method: 'POST',
    url: '/audits',
    headers: REBOUND,
    body: { url: 'http://192.168.1.1/' }
  })
  const read = await app.inject({ method: 'GET', url: `/audits/${id}`, headers: REBOUND })

  for (const response of [queued, read]) {
    t.assert.strictEqual(response.statusCode, 421)
    t.assert.deepStrictEqual(response.json(), HOST_ERROR)
  }
  t.assert.strictEqual(await storedAudits(app), 1)
})

test('host: the pages and the form refuse a request for another host', async (t: TestContext) => {
  const app = makeApp(t, { allowPrivateDestinations: true })
  const html = { ...REBOUND, accept: 'text/html' }

  const home = await app.inject({ method: 'GET', url: '/', headers: html })
  // A rebound page is same-origin with this server, so the browser sends what a form of this site would.
  const form = await app.inject({
    method: 'POST',
    url: '/check',
    headers: { ...html, 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
    payload: new URLSearchParams({ url: '192.168.1.1' }).toString()
  })

  for (const response of [home, form]) {
    t.assert.strictEqual(response.statusCode, 421)
    t.assert.match(response.headers['content-type'] as string, /^text\/html/)
    t.assert.match(response.body, /This server does not answer at this address/)
  }
  t.assert.strictEqual(await storedAudits(app), 0)
})

test('host: the stylesheet and the script load at any host, so the refusal page has its style', async (t: TestContext) => {
  const app = makeApp(t)

  for (const url of ['/assets/app.css', '/assets/checker.js']) {
    t.assert.strictEqual((await app.inject({ method: 'GET', url, headers: REBOUND })).statusCode, 200, url)
  }
})

test('host: a path that leaves /assets/ is not a static file, and is refused or not found', async (t: TestContext) => {
  const app = makeApp(t)
  const { id } = (await app.inject({ method: 'POST', url: '/audits', body: { url: 'https://example.com/' } })).json()

  // A client that parses the address, as a browser and inject do, removes dot segments, also encoded ones, so these
  // reach the API route. Sent as they are, the static files take them and refuse a path that leaves their folder.
  for (const url of [`/assets/../audits/${id}`, `/assets/%2e%2e/audits/${id}`]) {
    const response = await app.inject({ method: 'GET', url, headers: REBOUND })
    t.assert.strictEqual(response.statusCode, 421, url)
    t.assert.deepStrictEqual(response.json(), HOST_ERROR)
  }
  // An encoded slash stays in the path, so the static files take it, and they serve only files from their folder.
  for (const url of [`/assets/..%2Faudits/${id}`, '/assets/..%2F..%2Fpackage.json']) {
    const response = await app.inject({ method: 'GET', url, headers: REBOUND })
    t.assert.strictEqual(response.statusCode, 404, url)
    t.assert.ok(!response.body.includes(id), url)
  }
})

test('host: X-Forwarded-Host does not count, even when Fastify trusts proxies', async (t: TestContext) => {
  const app = build({ trustProxy: true }, { dbFilename: ':memory:' })
  t.after(() => app.close())

  const response = await app.inject({
    method: 'GET',
    url: '/',
    headers: { ...REBOUND, 'x-forwarded-host': 'localhost', accept: 'text/html' }
  })

  t.assert.strictEqual(response.statusCode, 421)
  t.assert.match(response.body, /Open it at localhost instead/)
})

test('host: answers at localhost, IP addresses and the host of PUBLIC_URL', async (t: TestContext) => {
  const app = makeApp(t, { publicUrl: 'https://audit.example/some/path' })
  const answered = ['localhost:8080', 'app.localhost', '127.0.0.1:8080', '[::1]:8080', 'audit.example']

  for (const host of answered) {
    const response = await app.inject({ method: 'GET', url: '/', headers: { host } })
    t.assert.strictEqual(response.statusCode, 200, host)
  }
  t.assert.strictEqual((await app.inject({ method: 'GET', url: '/', headers: REBOUND })).statusCode, 421)
})
