import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/parse.js'
import { jsonLdSummary, pageAuthor, pageDates } from '../src/checks/page/authorship.js'
import { lastmodByPage } from '../src/input/sitemap.js'

const ldJson = (...values) =>
  values.map((value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`).join('')
const page = (head) => parse(`<html><head>${head}</head><body><p>x</p></body></html>`)

const node = (fields) => ({
  types: [],
  name: null,
  authors: [],
  publisher: null,
  datePublished: null,
  dateModified: null,
  sameAs: [],
  ...fields
})

test('jsonLd: @id references to authors and publishers are resolved across the graph', () => {
  const $ = page(
    ldJson({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          headline: 'How to wash your hair',
          author: { '@id': '#maija' },
          publisher: { '@id': '#org' },
          datePublished: '2026-03-02',
          dateModified: '2026-09-15'
        },
        { '@type': 'Person', '@id': '#maija', name: 'Maija Mallikas' },
        { '@type': 'Organization', '@id': '#org', name: 'Example Store', sameAs: 'https://x.test/store' }
      ]
    })
  )
  assert.deepEqual(jsonLdSummary($), [
    node({
      types: ['Article'],
      name: 'How to wash your hair',
      authors: ['Maija Mallikas'],
      publisher: 'Example Store',
      datePublished: '2026-03-02',
      dateModified: '2026-09-15'
    }),
    node({ types: ['Person'], name: 'Maija Mallikas' }),
    node({ types: ['Organization'], name: 'Example Store', sameAs: ['https://x.test/store'] })
  ])
})

test('jsonLd: inline, plain and listed authors, @value text and duplicate names', () => {
  const $ = page(
    ldJson(
      {
        '@type': 'NewsArticle',
        name: 'Name only',
        author: [{ '@type': 'Person', name: 'A' }, 'B', { name: 'A' }, { '@id': '#missing' }, 7],
        publisher: { '@type': 'Organization', name: { '@value': 'Yle' } }
      },
      { '@type': ['BlogPosting', 'CreativeWork'], headline: ['', 'Second headline'], datePublished: 20260101 }
    )
  )
  const [first, second] = jsonLdSummary($)
  assert.deepEqual([first.name, first.authors, first.publisher], ['Name only', ['A', 'B'], 'Yle'])
  assert.deepEqual(
    [second.types, second.name, second.datePublished],
    [['BlogPosting', 'CreativeWork'], 'Second headline', '20260101']
  )
})

test('jsonLd: a loop of references ends after one step', () => {
  const $ = page(
    ldJson({
      '@graph': [
        { '@type': 'Person', '@id': '#a', author: { '@id': '#b' } },
        { '@type': 'Person', '@id': '#b', author: { '@id': '#a' } }
      ]
    })
  )
  assert.deepEqual(
    jsonLdSummary($).map(({ authors }) => authors),
    [[], []]
  )
})

test('jsonLd: nodes, names, sameAs and text are capped, invalid blocks and untyped nodes are left out', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ '@type': 'Thing', name: `n${i}` }))
  const long = {
    '@type': 'Person',
    name: 'x'.repeat(200),
    author: Array.from({ length: 8 }, (_, i) => `a${i}`),
    sameAs: Array.from({ length: 7 }, (_, i) => `https://x.test/${i}`)
  }
  const $ = page(
    '<script type="application/ld+json">{ broken</script>' + ldJson({ name: 'untyped' }, long, { '@graph': many })
  )
  const summary = jsonLdSummary($)
  assert.equal(summary.length, 10)
  assert.equal(summary[0].name.length, 120)
  assert.equal(summary[0].authors.length, 5)
  assert.deepEqual(
    summary[0].sameAs,
    Array.from({ length: 5 }, (_, i) => `https://x.test/${i}`)
  )
  assert.equal(summary.at(-1).name, 'n8')
})

test('dates: JSON-LD first, then the article and og tags, and the Last-Modified header as sent', () => {
  const tags =
    '<meta property="article:published_time" content="2025-01-01"><meta property="og:updated_time" content="2025-06-01">'
  const fromTags = page(tags)
  assert.deepEqual(pageDates(fromTags, jsonLdSummary(fromTags), 'Mon, 19 Oct 2026 10:00:00 GMT'), {
    published: '2025-01-01',
    modified: '2025-06-01',
    lastModified: 'Mon, 19 Oct 2026 10:00:00 GMT'
  })
  const both = page(tags + ldJson({ '@type': 'WebPage' }, { '@type': 'Article', datePublished: '2026-03-02' }))
  assert.deepEqual(pageDates(both, jsonLdSummary(both), null), {
    published: '2026-03-02',
    modified: '2025-06-01',
    lastModified: null
  })
  const none = page('')
  assert.deepEqual(pageDates(none, [], null), { published: null, modified: null, lastModified: null })
})

test('author: the author meta tag wins, else the first JSON-LD node with authors', () => {
  const graph = ldJson({ '@type': 'WebPage' }, { '@type': 'Article', author: ['A', 'B'] })
  const fromJsonLd = page(graph)
  assert.equal(pageAuthor(fromJsonLd, jsonLdSummary(fromJsonLd)), 'A, B')
  const fromMeta = page(`<meta name="author" content="Maija">${graph}`)
  assert.equal(pageAuthor(fromMeta, jsonLdSummary(fromMeta)), 'Maija')
  assert.equal(pageAuthor(page(''), []), null)
})

test('sitemap lastmod: by page key from urlset files only, the first one wins', () => {
  const files = [
    { kind: 'index', lastmods: [{ loc: 'https://a.test/child.xml', value: '2026-01-01' }] },
    {
      kind: 'urlset',
      lastmods: [
        { loc: 'https://A.test/x/', value: '2026-02-01' },
        { loc: 'https://a.test/x', value: '2026-03-01' },
        { loc: '', value: '2026-04-01' },
        { loc: 'not a url', value: 'yesterday' }
      ]
    }
  ]
  const byPage = lastmodByPage(files)
  assert.equal(byPage.get('https://a.test/x'), '2026-02-01')
  assert.equal(byPage.get('not a url'), 'yesterday')
  assert.equal(byPage.has('https://a.test/child.xml'), false)
  assert.equal(byPage.size, 2)
})
