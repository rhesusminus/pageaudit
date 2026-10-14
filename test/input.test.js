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
    ],
    entries: 3,
    emptyLocs: 0,
    lastmods: [{ loc: 'https://fixtures.test/good.html', value: '2026-09-01' }]
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
    {
      input: `${FIXTURE_HOST}/sitemap-nested-index.xml`,
      source: `sitemap index ${index}`,
      reason: 'nested sitemap index (only one level is followed)'
    },
    {
      input: `${FIXTURE_HOST}/missing-sitemap.xml`,
      source: `sitemap index ${index}`,
      reason: 'could not read sitemap: HTTP 404'
    }
  ])
})

test('sitemap: a sitemap read before in the run is not requested again and its facts are kept once', async (t) => {
  const requests = serveSitemaps(t, { '/urls.xml': '<urlset><url><loc>https://a.test/1</loc></url></urlset>' })
  const cache = new Map()
  const first = await fromSitemap('https://a.test/urls.xml', { cache })
  const again = await fromSitemap('https://a.test/urls.xml', { cache })
  assert.deepEqual([values(first.entries), first.files.length], [['https://a.test/1'], 1])
  assert.deepEqual([values(again.entries), again.files.length], [['https://a.test/1'], 0])
  assert.deepEqual(requests, ['https://a.test/urls.xml'])
})

// An index that lists a urlset and a nested index, which lists a second urlset.
const NESTED_SITE = {
  '/root.xml':
    '<sitemapindex><sitemap><loc>https://a.test/1.xml</loc></sitemap><sitemap><loc>https://a.test/nested.xml</loc></sitemap></sitemapindex>',
  '/nested.xml': '<sitemapindex><sitemap><loc>https://a.test/2.xml</loc></sitemap></sitemapindex>',
  '/1.xml': '<urlset><url><loc>https://a.test/1</loc></url></urlset>',
  '/2.xml': '<urlset><url><loc>https://a.test/2</loc></url></urlset>'
}

test('sitemap: a nested index given as a sitemap of its own is followed, whichever is read first', async (t) => {
  for (const order of [
    ['https://a.test/root.xml', 'https://a.test/nested.xml'],
    ['https://a.test/nested.xml', 'https://a.test/root.xml']
  ]) {
    const requests = serveSitemaps(t, NESTED_SITE)
    const cache = new Map()
    const results = []
    for (const url of order) results.push(await fromSitemap(url, { cache }))
    const all = (key) => results.flatMap((result) => result[key])
    const files = ['1.xml', '2.xml', 'nested.xml', 'root.xml'].map((name) => `https://a.test/${name}`)
    assert.deepEqual(values(all('entries')).sort(), ['https://a.test/1', 'https://a.test/2'], order[0])
    assert.deepEqual(
      all('files')
        .map((file) => file.url)
        .sort(),
      files,
      order[0]
    )
    assert.deepEqual(requests.toSorted(), files, order[0])
  }
})

test('sitemap: beforeHop is awaited before the index and every child sitemap', async (t) => {
  mockFixtureFetch(t)
  const hops = []
  await fromSitemap(`${FIXTURE_HOST}/sitemap-index.xml`, { beforeHop: async (url) => hops.push(url) })
  assert.deepEqual(
    hops,
    ['sitemap-index.xml', 'sitemap.xml', 'sitemap-nested-index.xml', 'missing-sitemap.xml'].map(
      (n) => `${FIXTURE_HOST}/${n}`
    )
  )
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

test('resolve: normalize hints at the address of a scheme-less input, http for a local server', () => {
  assert.throws(
    () => normalize('example.com'),
    /missing http:\/\/ or https:\/\/, did you mean https:\/\/example\.com\?\)/
  )
  assert.throws(() => normalize('127.0.0.1:3000'), /did you mean http:\/\/127\.0\.0\.1:3000\?/)
  assert.throws(() => normalize('[::1]:3000'), /did you mean http:\/\/\[::1\]:3000\?/)
  assert.throws(() => normalize('[::ffff:127.0.0.1]:8765'), /did you mean http:\/\/\[::ffff:127\.0\.0\.1\]:8765\?/)
  assert.throws(
    () => normalize('localhost:8765'),
    /unsupported protocol localhost: \(only http and https, did you mean http:\/\/localhost:8765\?\)/
  )
  assert.throws(() => normalize('example.com:80/a'), /did you mean https:\/\/example\.com:80\/a\?/)
  assert.throws(() => normalize('ftp://x.test'), /^Error: unsupported protocol ftp: \(only http and https\)$/)
})

test('resolve: normalize rejects non-http URLs with a reason', () => {
  assert.throws(() => normalize('mailto:a@b.test'), /unsupported protocol mailto: \(only http and https\)/)
  assert.throws(() => normalize('http://'), /^Error: not a valid URL$/)
  assert.throws(() => normalize('not a url'), /^Error: not a valid URL \(missing http:\/\/ or https:\/\/\)$/)
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
      [
        'fixtures.test/no-scheme.html',
        'not a valid URL (missing http:// or https://, did you mean https://fixtures.test/no-scheme.html?)'
      ]
    ]
  )
  assert.equal(skipped[0].source, `${fixturePath('urls.txt')}:8`)
})

test('parseUrlList: the word lighthouse after a URL marks the page, in any case, with tabs and a comment', () => {
  const entries = parseUrlList('https://a.test/ lighthouse\nhttps://b.test/\tLIGHTHOUSE  # note\nhttps://d.test/', 'f')
  assert.deepEqual(entries, [
    { value: 'https://a.test/', source: 'f:1', lighthouse: true },
    { value: 'https://b.test/', source: 'f:2', lighthouse: true },
    { value: 'https://d.test/', source: 'f:3' }
  ])
})

test('resolve: other text after a URL, such as a mistyped marker, skips the line instead of fetching an odd URL', () => {
  const entries = parseUrlList('https://c.test/page lighthuose\nhttps://x.test/d lighthouse,\nhttps://ok.test/', 'f')
  const { urls, skipped, marked } = resolveUrls(entries)
  assert.deepEqual(urls, ['https://ok.test/'])
  assert.deepEqual(marked, [])
  assert.deepEqual(
    skipped.map(({ input, source }) => [input, source]),
    [
      ['https://c.test/page lighthuose', 'f:1'],
      ['https://x.test/d lighthouse,', 'f:2']
    ]
  )
  assert.match(skipped[0].reason, /unexpected text after the URL .*: lighthuose/)
})

test('resolve: limit caps the list after deduplication', () => {
  const entries = fromArgs(['https://a.test/1', 'https://a.test/1/', 'https://a.test/2', 'https://a.test/3'])
  assert.deepEqual(resolveUrls(entries, { limit: 2 }), {
    urls: ['https://a.test/1', 'https://a.test/2'],
    skipped: [],
    total: 3,
    listed: new Map(),
    marked: []
  })
})

test('resolve: pages marked for Lighthouse are kept, also past the limit, and marking a duplicate marks the first', () => {
  const entries = [
    ...fromArgs(['https://a.test/1', 'https://a.test/2', 'https://a.test/3', 'https://a.test/4']),
    { value: 'https://a.test/4/', source: 'option', lighthouse: true },
    { value: 'https://a.test/1', source: 'f:1', lighthouse: true },
    { value: 'https://a.test/9', source: 'option', lighthouse: true }
  ]
  const { urls, total, marked } = resolveUrls(entries, { limit: 2 })
  assert.deepEqual(urls, ['https://a.test/1', 'https://a.test/2', 'https://a.test/4', 'https://a.test/9'])
  assert.deepEqual(marked, ['https://a.test/1', 'https://a.test/4', 'https://a.test/9'])
  assert.equal(total, 5)
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
      ['https://a.test/1', [{ sitemap: 'https://a.test/s1.xml', url: 'https://a.test/1/' }]],
      [
        'https://a.test/2',
        [
          { sitemap: 'https://a.test/s1.xml', url: 'https://a.test/2' },
          { sitemap: 'https://a.test/s2.xml', url: 'https://a.test/2' }
        ]
      ]
    ]
  )
})

test('resolve: the same URL twice in one sitemap is listed once', () => {
  const entry = { value: 'https://a.test/1', source: 'sitemap https://a.test/s.xml', sitemap: 'https://a.test/s.xml' }
  const { listed } = resolveUrls([entry, entry])
  assert.deepEqual(listed.get('https://a.test/1'), [{ sitemap: 'https://a.test/s.xml', url: 'https://a.test/1' }])
})

test('sitemap: keeps what validation needs, entries without a loc are counted but not listed', () => {
  const sitemap = parseSitemap(
    '<urlset><url><loc> https://a.test/1 </loc><lastmod>2026-13-01</lastmod></url><url><loc> </loc></url><url><lastmod>x</lastmod></url></urlset>'
  )
  assert.deepEqual(sitemap, {
    kind: 'urlset',
    locs: ['https://a.test/1'],
    entries: 3,
    emptyLocs: 2,
    lastmods: [
      { loc: 'https://a.test/1', value: '2026-13-01' },
      { loc: '', value: 'x' }
    ]
  })
})

test('sitemap: fromSitemap returns the facts of the index and of every child, before any limit', async (t) => {
  mockFixtureFetch(t)
  const { files } = await fromSitemap(`${FIXTURE_HOST}/sitemap-index.xml`)
  assert.deepEqual(
    files.map(({ url, kind }) => [url, kind]),
    [
      [`${FIXTURE_HOST}/sitemap-index.xml`, 'index'],
      [`${FIXTURE_HOST}/sitemap.xml`, 'urlset'],
      [`${FIXTURE_HOST}/sitemap-nested-index.xml`, 'index']
    ]
  )
  assert.ok(files.every((f) => !f.tooLarge && f.entries >= f.locs.length))
})

// A urlset that lists https://a.test/1, padded to `size` bytes.
const paddedUrlset = (size) => '<urlset><url><loc>https://a.test/1</loc></url></urlset>'.padEnd(size, ' ')
const SITEMAP_LIMIT = 50 * 1024 * 1024
const TOO_LARGE = 'sitemap is larger than 50 MB uncompressed, Google does not accept it'

test('sitemap: a child over 50 MB uncompressed, gzipped or not, is skipped but its facts are kept', async (t) => {
  const bodies = {
    '/root.xml': `<sitemapindex>${['big.xml.gz', 'big.xml', 'fits.xml.gz'].map((name) => `<sitemap><loc>https://a.test/${name}</loc></sitemap>`).join('')}</sitemapindex>`,
    '/big.xml.gz': gzipSync(paddedUrlset(SITEMAP_LIMIT + 1)),
    '/big.xml': paddedUrlset(SITEMAP_LIMIT + 1),
    '/fits.xml.gz': gzipSync(paddedUrlset(SITEMAP_LIMIT))
  }
  t.mock.method(globalThis, 'fetch', async (input) => new Response(bodies[new URL(input).pathname]))
  const { entries, skipped, files } = await fromSitemap('https://a.test/root.xml')
  assert.deepEqual(values(entries), ['https://a.test/1'])
  assert.deepEqual(
    skipped.map(({ input, reason }) => [input, reason]),
    [
      ['https://a.test/big.xml.gz', TOO_LARGE],
      ['https://a.test/big.xml', TOO_LARGE]
    ]
  )
  assert.deepEqual(
    files.map(({ url, tooLarge, locs }) => [url, tooLarge, locs.length]),
    [
      ['https://a.test/root.xml', false, 3],
      ['https://a.test/big.xml.gz', true, 0],
      ['https://a.test/big.xml', true, 0],
      ['https://a.test/fits.xml.gz', false, 1]
    ]
  )
})

test('sitemap: a gzipped file that grew past 50 MB when packed, but is 50 MB unpacked, is read', async (t) => {
  const packed = gzipSync(paddedUrlset(SITEMAP_LIMIT), { level: 0 })
  assert.ok(packed.length > SITEMAP_LIMIT)
  t.mock.method(globalThis, 'fetch', async () => new Response(packed))
  const { entries, skipped } = await fromSitemap('https://a.test/sitemap.xml.gz')
  assert.deepEqual([values(entries), skipped], [['https://a.test/1'], []])
})

test('sitemap: a plain file whose connection drops just past 50 MB is still reported as too large', async (t) => {
  const chunks = [paddedUrlset(SITEMAP_LIMIT + 1)]
  const body = new ReadableStream({
    pull(controller) {
      if (chunks.length) controller.enqueue(new TextEncoder().encode(chunks.shift()))
      else controller.error(Object.assign(new TypeError('terminated'), { cause: { code: 'ECONNRESET' } }))
    }
  })
  t.mock.method(globalThis, 'fetch', async () => new Response(body))
  const { skipped, files } = await fromSitemap('https://a.test/big.xml')
  assert.deepEqual(
    skipped.map(({ reason }) => reason),
    [TOO_LARGE]
  )
  assert.deepEqual(
    files.map(({ tooLarge }) => tooLarge),
    [true]
  )
})

test('sitemap: a --sitemap over 50 MB uncompressed is skipped but its facts are kept', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(gzipSync(paddedUrlset(SITEMAP_LIMIT + 1))))
  const { entries, skipped, files } = await fromSitemap('https://a.test/big.xml.gz')
  assert.deepEqual(entries, [])
  assert.deepEqual(skipped, [{ input: 'https://a.test/big.xml.gz', source: '--sitemap', reason: TOO_LARGE }])
  assert.deepEqual(
    files.map(({ url, tooLarge }) => [url, tooLarge]),
    [['https://a.test/big.xml.gz', true]]
  )
})

// Serves `bodies` by path on https://a.test, redirects http to https and answers 404 for any other path.
// Returns the URLs requested, in order.
function serveSitemaps(t, bodies) {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input)
    requests.push(url.href)
    if (url.protocol === 'http:')
      return new Response(null, { status: 301, headers: { location: url.href.replace('http:', 'https:') } })
    const body = bodies[url.pathname]
    return body ? new Response(body) : new Response('gone', { status: 404 })
  })
  return requests
}

test('sitemap: every file is read once, however often an index lists it, and an index that lists itself is not read again', async (t) => {
  const loc = (path) => `<sitemap><loc>https://a.test/${path}</loc></sitemap>`
  const requests = serveSitemaps(t, {
    // Asked for as http, read from https after a redirect, and listing its https address.
    '/root.xml': `<sitemapindex>${['urls.xml', 'child.xml', 'gone.xml', 'urls.xml', 'child.xml', 'gone.xml', 'root.xml'].map(loc).join('')}</sitemapindex>`,
    '/urls.xml': '<urlset><url><loc>https://a.test/1</loc></url></urlset>',
    '/child.xml': '<sitemapindex><sitemap><loc/></sitemap></sitemapindex>'
  })
  const { entries, skipped, files } = await fromSitemap('http://a.test/root.xml')
  assert.deepEqual(requests, [
    'http://a.test/root.xml',
    'https://a.test/root.xml',
    'https://a.test/urls.xml',
    'https://a.test/child.xml',
    'https://a.test/gone.xml'
  ])
  assert.deepEqual(values(entries), ['https://a.test/1'])
  assert.deepEqual(
    skipped.map(({ input, reason }) => [input, reason]),
    [
      ['https://a.test/child.xml', 'nested sitemap index (only one level is followed)'],
      ['https://a.test/gone.xml', 'could not read sitemap: HTTP 404']
    ]
  )
  assert.deepEqual(
    files.map((f) => [f.url, f.emptyLocs]),
    [
      ['http://a.test/root.xml', 0],
      ['https://a.test/urls.xml', 0],
      ['https://a.test/child.xml', 1]
    ]
  )
})

test('sitemap: a child that redirects to a file read before is not read or counted again', async (t) => {
  const requests = serveSitemaps(t, {
    '/root.xml':
      '<sitemapindex><sitemap><loc>http://a.test/1.xml</loc></sitemap><sitemap><loc>https://a.test/1.xml</loc></sitemap></sitemapindex>',
    '/1.xml': '<urlset><url><loc>https://a.test/1</loc></url></urlset>'
  })
  const { entries, files } = await fromSitemap('https://a.test/root.xml')
  assert.deepEqual(requests, ['https://a.test/root.xml', 'http://a.test/1.xml', 'https://a.test/1.xml'])
  assert.deepEqual(values(entries), ['https://a.test/1', 'https://a.test/1'])
  assert.deepEqual(
    files.map((file) => file.url),
    ['https://a.test/root.xml', 'http://a.test/1.xml']
  )
})
