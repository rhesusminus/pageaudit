import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { fromArgs } from '../src/input/args.js'
import { fromFile, parseUrlList } from '../src/input/file.js'
import { fromSitemap, parseSitemap } from '../src/input/sitemap.js'
import { normalize, resolveUrls } from '../src/input/resolve.js'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'

const fixturePath = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname
const values = (entries) => entries.map((e) => e.value)

test('args: every positional becomes an entry', () => {
  assert.deepEqual(fromArgs(['https://a.test/', 'b']), [
    { value: 'https://a.test/', source: 'argument' },
    { value: 'b', source: 'argument' }
  ])
})

test('file: skips blank lines and comments, keeps line numbers', async () => {
  const entries = await fromFile(fixturePath('urls.txt'))
  assert.deepEqual(values(entries), [
    'https://fixtures.test/good.html',
    'https://fixtures.test/good.html/',
    'HTTPS://FIXTURES.TEST/good.html#reviews',
    'https://fixtures.test/bad-missing.html?variant=b',
    'https://fixtures.test/bad-missing.html?variant=b#top',
    'ftp://fixtures.test/file.txt',
    'fixtures.test/no-scheme.html',
    'https://fixtures.test/bad-images.html'
  ])
  assert.equal(entries[0].source, `${fixturePath('urls.txt')}:2`)
  assert.equal(entries[3].source, `${fixturePath('urls.txt')}:6`)
})

test('file: a # inside a URL is a fragment, not a comment', () => {
  assert.deepEqual(values(parseUrlList('https://a.test/#x\nhttps://b.test/ # note\r\n#https://c.test/', 'f')), [
    'https://a.test/#x',
    'https://b.test/'
  ])
})

test('file: "-" reads the list from stdin', async () => {
  const entries = await fromFile('-', { stdin: Readable.from(['https://a.test/\n', '# c\nhttps://b.test/\n']) })
  assert.deepEqual(entries, [
    { value: 'https://a.test/', source: 'stdin:1' },
    { value: 'https://b.test/', source: 'stdin:3' }
  ])
})

test('file: a missing file fails with the path and error code', async () => {
  await assert.rejects(fromFile('/nope/urls.txt'), /Could not read \/nope\/urls\.txt: ENOENT/)
})

test('sitemap: parses <urlset> locs, ignoring image locs and whitespace', () => {
  const sitemap = parseSitemap(readFileSync(fixturePath('sitemap.xml'), 'utf8'))
  assert.deepEqual(sitemap, {
    kind: 'urlset',
    locs: [
      'https://fixtures.test/good.html',
      'https://fixtures.test/bad-missing.html',
      'https://fixtures.test/bad-images.html?ref=sitemap&page=1'
    ]
  })
})

test('sitemap: parses <sitemapindex> locs and rejects other documents', () => {
  assert.equal(parseSitemap(readFileSync(fixturePath('sitemap-index.xml'), 'utf8')).kind, 'index')
  assert.throws(() => parseSitemap('<html><body>hi</body></html>'), /not a sitemap \(root element is <html>\)/)
  assert.throws(() => parseSitemap(''), /root element is missing/)
})

test('sitemap: fetches a urlset', async (t) => {
  mockFixtureFetch(t)
  const { entries, skipped } = await fromSitemap(`${FIXTURE_HOST}/sitemap.xml`)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].source, `sitemap ${FIXTURE_HOST}/sitemap.xml`)
  assert.deepEqual(skipped, [])
})

test('sitemap: follows an index one level deep and skips failing or nested children', async (t) => {
  mockFixtureFetch(t)
  const index = `${FIXTURE_HOST}/sitemap-index.xml`
  const { entries, skipped } = await fromSitemap(index)
  assert.deepEqual(values(entries), values((await fromSitemap(`${FIXTURE_HOST}/sitemap.xml`)).entries))
  assert.deepEqual(skipped, [
    { input: index, source: `sitemap index ${index}`, reason: 'nested sitemap index (only one level is followed)' },
    {
      input: `${FIXTURE_HOST}/missing-sitemap.xml`,
      source: `sitemap index ${index}`,
      reason: 'could not read sitemap: HTTP 404'
    }
  ])
})

test('sitemap: reads a gzipped sitemap file', async (t) => {
  const xml = readFileSync(fixturePath('sitemap.xml'))
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response(gzipSync(xml), { headers: { 'content-type': 'application/gzip' } })
  )
  assert.equal((await fromSitemap('https://x.test/sitemap.xml.gz')).entries.length, 3)
})

test('sitemap: an unreadable sitemap fails with the reason', async (t) => {
  mockFixtureFetch(t)
  await assert.rejects(
    fromSitemap(`${FIXTURE_HOST}/nope.xml`),
    /Could not read sitemap https:\/\/fixtures\.test\/nope\.xml: HTTP 404$/
  )
  await assert.rejects(fromSitemap('https://elsewhere.test/sitemap.xml'), /: ENOTFOUND$/)
  await assert.rejects(fromSitemap(`${FIXTURE_HOST}/good.html`), /: not a sitemap \(root element is <html>\)$/)
})

test('resolve: normalize lowercases the host, drops the fragment and keeps the query', () => {
  assert.deepEqual(normalize('HTTPS://Example.COM/Path?q=1#top'), {
    url: 'https://example.com/Path?q=1',
    key: 'https://example.com/Path?q=1'
  })
})

test('resolve: normalize treats a trailing slash as the same page', () => {
  assert.equal(normalize('https://a.test/x/').key, normalize('https://a.test/x').key)
  assert.equal(normalize('https://a.test/x/').url, 'https://a.test/x/')
  assert.equal(normalize('https://a.test').key, normalize('https://a.test/').key)
  assert.notEqual(normalize('https://a.test/x?q=1').key, normalize('https://a.test/x?q=2').key)
})

test('resolve: normalize rejects non-http URLs with a reason', () => {
  assert.throws(() => normalize('mailto:a@b.test'), /unsupported protocol mailto: \(only http and https\)/)
  assert.throws(() => normalize('example.com'), /not a valid URL \(missing http:\/\/ or https:\/\/\)/)
  assert.throws(() => normalize('http://'), /^Error: not a valid URL$/)
})

test('resolve: merges inputs in order, dedupes and reports skipped inputs', async () => {
  const entries = [
    ...fromArgs(['https://fixtures.test/bad-images.html/']),
    ...(await fromFile(fixturePath('urls.txt')))
  ]
  const { urls, skipped, total } = resolveUrls(entries)
  assert.deepEqual(urls, [
    'https://fixtures.test/bad-images.html/',
    'https://fixtures.test/good.html',
    'https://fixtures.test/bad-missing.html?variant=b'
  ])
  assert.equal(total, 3)
  assert.deepEqual(
    skipped.map(({ input, reason }) => [input, reason]),
    [
      ['ftp://fixtures.test/file.txt', 'unsupported protocol ftp: (only http and https)'],
      ['fixtures.test/no-scheme.html', 'not a valid URL (missing http:// or https://)']
    ]
  )
  assert.equal(skipped[0].source, `${fixturePath('urls.txt')}:8`)
})

test('resolve: limit caps the list after deduplication', () => {
  const entries = fromArgs(['https://a.test/1', 'https://a.test/1/', 'https://a.test/2', 'https://a.test/3'])
  assert.deepEqual(resolveUrls(entries, { limit: 2 }), {
    urls: ['https://a.test/1', 'https://a.test/2'],
    skipped: [],
    total: 3,
    listed: new Map()
  })
})

test('resolve: listed maps each kept URL to the sitemaps it came from, also when another input came first', () => {
  const entries = [
    ...fromArgs(['https://a.test/1', 'https://a.test/9']),
    { value: 'https://a.test/1/', source: 'sitemap https://a.test/s1.xml', sitemap: 'https://a.test/s1.xml' },
    { value: 'https://a.test/2', source: 'sitemap https://a.test/s1.xml', sitemap: 'https://a.test/s1.xml' },
    { value: 'https://a.test/2', source: 'sitemap https://a.test/s2.xml', sitemap: 'https://a.test/s2.xml' },
    { value: 'not a url', source: 'sitemap https://a.test/s2.xml', sitemap: 'https://a.test/s2.xml' }
  ]
  const { listed } = resolveUrls(entries)
  assert.deepEqual(
    [...listed],
    [
      ['https://a.test/1', ['https://a.test/s1.xml']],
      ['https://a.test/2', ['https://a.test/s1.xml', 'https://a.test/s2.xml']]
    ]
  )
})
