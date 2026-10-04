import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSite } from '../src/checks/site/index.js'
import { runAudit } from '../src/runner.js'

// Builds a page from head/body parts. canonical is written as given (may be relative).
const html = ({ title, description, h1s = [], canonical }) =>
  `<html><head>${title === undefined ? '' : `<title>${title}</title>`}` +
  `${description === undefined ? '' : `<meta name="description" content="${description}">`}` +
  `${canonical === undefined ? '' : `<link rel="canonical" href="${canonical}">`}</head>` +
  `<body>${h1s.map((h) => `<h1>${h}</h1>`).join('')}</body></html>`

// Audits a site whose pages are given as { url: htmlParts | Response fields }.
async function audit(site) {
  const fetchPage = async (url) => {
    const spec = site[url]
    return {
      url,
      finalUrl: spec.finalUrl ?? url,
      status: spec.status ?? 200,
      redirects: [],
      contentType: 'text/html',
      html: spec.status ? null : html(spec)
    }
  }
  return runAudit(Object.keys(site), { fetchPage, delay: 0 })
}

const brief = (issues) => issues.map(({ type, urls }) => [type, urls])

test('site: reports titles, descriptions and h1s shared by different pages', async () => {
  const pages = await audit({
    'https://a.test/1': { title: 'Shop', description: 'Buy things', h1s: ['Welcome'] },
    'https://a.test/2': { title: 'shop', description: 'Buy   things', h1s: ['Welcome', 'Other'] },
    'https://a.test/3': { title: 'About', description: 'About us', h1s: ['Other'] }
  })
  const issues = checkSite(pages)
  assert.deepEqual(brief(issues), [
    ['duplicate-title', ['https://a.test/1', 'https://a.test/2']],
    ['duplicate-description', ['https://a.test/1', 'https://a.test/2']],
    ['duplicate-h1', ['https://a.test/1', 'https://a.test/2']],
    ['duplicate-h1', ['https://a.test/2', 'https://a.test/3']]
  ])
  const [title] = issues
  assert.equal(title.severity, 'warning')
  assert.equal(title.message, 'Same title on 2 pages')
  assert.equal(title.context, '<title>Shop</title>')
  assert.equal(issues[1].context, '<meta name="description" content="Buy things">')
})

test('site: missing and empty values are never duplicates of each other', async () => {
  const pages = await audit({
    'https://a.test/1': {},
    'https://a.test/2': { title: '  ', description: '' },
    'https://a.test/3': {}
  })
  assert.deepEqual(checkSite(pages), [])
})

test('site: pages sharing a canonical are one page, so their duplicates are expected', async () => {
  const pages = await audit({
    'https://a.test/list': { title: 'List', canonical: 'https://a.test/list' },
    'https://a.test/list?sort=asc': { title: 'List', canonical: '/list/' },
    'https://a.test/other': { title: 'List', canonical: 'https://a.test/other' }
  })
  const issues = checkSite(pages)
  assert.deepEqual(brief(issues), [
    ['duplicate-title', ['https://a.test/list', 'https://a.test/list?sort=asc', 'https://a.test/other']],
    ['canonical-elsewhere', ['https://a.test/list?sort=asc']]
  ])
  assert.equal(issues[1].severity, 'info')
  assert.equal(issues[1].context, 'https://a.test/list/')
})

test('site: two inputs that land on the same final URL are not duplicates', async () => {
  const pages = await audit({
    'http://a.test/': { title: 'Home', finalUrl: 'https://a.test/' },
    'https://a.test/': { title: 'Home' }
  })
  assert.deepEqual(checkSite(pages), [])
})

test('site: a self-referencing canonical is not reported, trailing slash or not', async () => {
  const pages = await audit({
    'https://a.test/x': { title: 'X', canonical: 'https://a.test/x/' },
    'https://a.test/y/': { title: 'Y', canonical: '/y' }
  })
  assert.deepEqual(checkSite(pages), [])
})

test('site: pages that failed or returned an error status are ignored', async () => {
  const pages = await audit({
    'https://a.test/1': { title: 'Home' },
    'https://a.test/2': { status: 404 },
    'https://a.test/3': { status: 500 }
  })
  assert.deepEqual(checkSite(pages), [])
})

test('site: inputs that land on the same page report a foreign canonical once', async () => {
  const pages = await audit({
    'http://a.test/x': { title: 'X', canonical: 'https://b.test/x', finalUrl: 'https://a.test/x' },
    'https://a.test/x': { title: 'X', canonical: 'https://b.test/x' }
  })
  assert.deepEqual(brief(checkSite(pages)), [['canonical-elsewhere', ['http://a.test/x', 'https://a.test/x']]])
})

test('site: a page repeating an h1 in different cases is listed once', async () => {
  const pages = await audit({
    'https://a.test/x': { title: 'X', h1s: ['Home', 'HOME'] },
    'https://a.test/y': { title: 'Y', h1s: ['home'] }
  })
  const issues = checkSite(pages)
  assert.deepEqual(brief(issues), [['duplicate-h1', ['https://a.test/x', 'https://a.test/y']]])
  assert.equal(issues[0].message, 'Same <h1> on 2 pages')
})

test('site: the page count ignores inputs that land on the same final page', async () => {
  const pages = await audit({
    'http://a.test/x': { title: 'Shop', finalUrl: 'https://a.test/x' },
    'https://a.test/x': { title: 'Shop' },
    'https://a.test/y': { title: 'Shop' }
  })
  const issues = checkSite(pages)
  assert.deepEqual(brief(issues), [['duplicate-title', ['http://a.test/x', 'https://a.test/x', 'https://a.test/y']]])
  assert.equal(issues[0].message, 'Same title on 2 pages')
})

test('site: a relative canonical is resolved against <base href>', async () => {
  const fetchPage = async (url) => ({
    url,
    finalUrl: url,
    status: 200,
    redirects: [],
    contentType: 'text/html',
    html: '<html><head><base href="https://b.test/dir/"><title>T</title><link rel="canonical" href="p"></head><body></body></html>'
  })
  const [page] = await runAudit(['https://a.test/x'], { fetchPage, delay: 0 })
  assert.equal(page.facts.canonical, 'https://b.test/dir/p')
  const relativeBase = async (url) => ({
    ...(await fetchPage(url)),
    html: '<html><head><base href="/dir/"><link rel="canonical" href="p"></head></html>'
  })
  const [other] = await runAudit(['https://a.test/x'], { fetchPage: relativeBase, delay: 0 })
  assert.equal(other.facts.canonical, 'https://a.test/dir/p')
})
