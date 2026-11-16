// The app as the API and web tests use it: every host name resolves to one public address, so the destination check
// passes without a network, no audit reaches the internet, and each app has its own database.
import dns from 'node:dns/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { TestContext } from 'node:test'
import { beforeEach } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { build } from '../../src/api/app.ts'
import { mockFetch } from './mock-fetch.js'

export type App = ReturnType<typeof build>

const realFetch = globalThis.fetch
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

// No request leaves this machine: a test that queues an audit of another host gets a failed fetch at once, the same
// everywhere. A real fetch could hang until its timeout on a network that drops the packets, and closing the app waits
// for the audit in progress. Pages served on this machine (serveLocally) are fetched for real. A test that needs
// pages from elsewhere mocks fetch itself (mockFixtureFetch), which replaces this.
const offlineFetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (LOOPBACK.has(url.hostname)) return realFetch(input, init)
  return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
}

// Call once at the top of a test file. Every host name resolves to one public address, so the destination check
// passes, and no audit reaches the internet.
export const isolateNetwork = () =>
  beforeEach((t) => {
    ;(t as TestContext).mock.method(dns, 'lookup', async () => [{ address: '93.184.215.14', family: 4 }])
    mockFetch(t as TestContext, offlineFetch)
  })

// Each app gets its own in-memory database, so no test sees another test's audits. close() releases it afterwards.
export const makeApp = (t: TestContext, options: { publicUrl?: string; allowPrivateDestinations?: boolean } = {}) => {
  const app = build({}, { dbFilename: ':memory:', ...options })
  t.after(() => app.close())

  return app
}

// Polls the audit until the worker has finished with it, and returns it.
export const waitForAudit = async (app: App, id: string) => {
  for (;;) {
    const audit = (await app.inject({ method: 'GET', url: `/audits/${id}` })).json()
    if (audit.status === 'completed' || audit.status === 'failed') return audit
    await sleep(5)
  }
}

// Serves one page on 127.0.0.1, as a development site would, and returns its address without a scheme.
export const serveLocally = async (t: TestContext, html: string) => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  return `127.0.0.1:${(server.address() as AddressInfo).port}`
}
