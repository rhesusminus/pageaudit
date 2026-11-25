import assert from 'node:assert/strict'
import { test } from 'node:test'
import robotsParser from 'robots-parser'
import { auditOnePage } from '../src/api/audit-page.js'

const PAGE = 'https://one.test/page'
const ROBOTS = 'User-agent: *\nDisallow: /page\n'

const loadedPage = async (url) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  headers: new Headers({ 'content-type': 'text/html' }),
  html: '<!doctype html><html lang="en"><head><title>Page</title></head><body><h1>Page</h1></body></html>'
})

test('auditOnePage: reads robots.txt once for every check that needs it', async (t) => {
  const loadRobots = t.mock.fn(async (origin) => ({
    status: 'ok',
    parser: robotsParser(`${origin}/robots.txt`, ROBOTS),
    text: ROBOTS
  }))

  const { site, origins } = await auditOnePage(PAGE, { fetchPage: loadedPage, loadRobots })

  assert.equal(loadRobots.mock.callCount(), 1)
  assert.equal(loadRobots.mock.calls[0].arguments[0], 'https://one.test')
  const types = site.map((issue) => issue.type)
  assert.ok(types.includes('blocked-by-robots'))
  assert.ok(types.includes('no-sitemap-declared'))
  assert.equal(origins[0].origin, 'https://one.test')
})

test('auditOnePage: a page that could not be fetched gets no site checks and no robots.txt request', async (t) => {
  const loadRobots = t.mock.fn()
  const failed = async (url) => {
    throw Object.assign(new Error(`Could not fetch ${url}: ENOTFOUND`), { reason: 'ENOTFOUND' })
  }

  const { page, site, origins } = await auditOnePage(PAGE, { fetchPage: failed, loadRobots })

  assert.equal(page.status, null)
  assert.deepEqual(site, [])
  assert.deepEqual(origins, [])
  assert.equal(loadRobots.mock.callCount(), 0)
})
