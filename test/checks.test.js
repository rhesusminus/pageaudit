import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/parse.js'
import { checkImages } from '../src/checks/page/images.js'
import { checkMeta } from '../src/checks/page/meta.js'
import { checkHeadings } from '../src/checks/page/headings.js'
import { checkHygiene } from '../src/checks/page/hygiene.js'
import { checkIndexing } from '../src/checks/page/indexing.js'
import { checkSocial } from '../src/checks/page/social.js'
import { checkStructuredData } from '../src/checks/page/structured-data.js'
import { truncate } from '../src/checks/snippet.js'

const types = (issues) => issues.map((i) => i.type)

test('images: missing alt is an error', () => {
  const issues = checkImages(parse('<img src="a.jpg" width="1" height="1">'))
  assert.deepEqual(types(issues), ['missing-alt'])
  assert.equal(issues[0].severity, 'error')
  assert.match(issues[0].context, /a\.jpg/)
})

test('images: empty alt is info', () => {
  const issues = checkImages(parse('<img src="a.jpg" alt="" width="1" height="1">'))
  assert.deepEqual(types(issues), ['empty-alt'])
  assert.equal(issues[0].severity, 'info')
})

test('images: empty alt as the only content of a link is an error', () => {
  const issues = checkImages(parse('<a href="/"><img src="a.svg" alt="" width="1" height="1"></a>'))
  assert.deepEqual(types(issues), ['empty-alt-in-link'])
  assert.equal(issues[0].severity, 'error')
})

test('images: empty alt next to link text or with aria-label is fine', () => {
  const withText = '<a href="/"><img src="a.svg" alt="" width="1" height="1"> Home</a>'
  const withLabel = '<a href="/" aria-label="Home"><img src="a.svg" alt="" width="1" height="1"></a>'
  assert.deepEqual(types(checkImages(parse(withText))), ['empty-alt'])
  assert.deepEqual(types(checkImages(parse(withLabel))), ['empty-alt'])
})

test('images: generic file names are flagged, descriptive ones are not', () => {
  const generic = (src) => types(checkImages(parse(`<img src="${src}" alt="x" width="1" height="1">`)))
  assert.deepEqual(generic('/a/IMG00023.JPG'), ['generic-filename'])
  assert.deepEqual(generic('/a/image1.jpg'), ['generic-filename'])
  assert.deepEqual(generic('/a/photo.png?v=2'), ['generic-filename'])
  assert.deepEqual(generic('/a/my-new-black-kitten.jpg'), [])
  assert.deepEqual(generic('data:image/gif;base64,R0lGOD'), [])
})

test('images: alt repeating the file name is a warning', () => {
  const issues = checkImages(parse('<img src="/a/puppy.jpg" alt="Puppy.JPG" width="1" height="1">'))
  assert.deepEqual(types(issues), ['alt-is-filename'])
  assert.equal(issues[0].severity, 'warning')
})

test('images: missing src is flagged unless srcset is present', () => {
  assert.deepEqual(types(checkImages(parse('<img alt="x" width="1" height="1">'))), ['missing-src'])
  assert.deepEqual(types(checkImages(parse('<img srcset="a.jpg 1x" alt="x" width="1" height="1">'))), [])
})

test('images: missing dimensions is a warning', () => {
  const issues = checkImages(parse('<img src="a.jpg" alt="ok" width="1">'))
  assert.deepEqual(types(issues), ['missing-dimensions'])
})

test('images: clean image has no issues', () => {
  assert.deepEqual(checkImages(parse('<img src="a.jpg" alt="ok" width="1" height="1">')), [])
})

const goodHead = (title = 'Title', desc = 'A description that is comfortably long enough to pass the short check.') =>
  `<html><head><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="https://example.com/"></head></html>`

test('meta: clean head has no issues', () => {
  assert.deepEqual(checkMeta(parse(goodHead())), [])
})

test('meta: missing everything', () => {
  const issues = checkMeta(parse('<html><head></head></html>'))
  assert.deepEqual(types(issues), ['missing-title', 'missing-description', 'missing-canonical'])
  assert.deepEqual(
    issues.map((i) => i.severity),
    ['error', 'warning', 'warning']
  )
})

test('meta: empty title is an error', () => {
  const issues = checkMeta(parse(goodHead('  ')))
  assert.deepEqual(types(issues), ['empty-title'])
  assert.equal(issues[0].severity, 'error')
})

test('meta: title after a body-only element in head is still found', () => {
  const desc = 'A description that is comfortably long enough to pass the short check.'
  const html = `<html><head><meta charset="utf-8"><div id="x"></div><title>My page</title><meta name="description" content="${desc}"><link rel="canonical" href="https://example.com/"></head><body></body></html>`
  assert.ok(!types(checkMeta(parse(html))).includes('missing-title'))
})

test('meta: a title inside svg is not the page title', () => {
  const html = '<html><head></head><body><svg><title>Icon</title></svg></body></html>'
  assert.ok(types(checkMeta(parse(html))).includes('missing-title'))
})

test('meta: short description is info', () => {
  const issues = checkMeta(parse(goodHead('T', 'Too short')))
  assert.deepEqual(types(issues), ['short-description'])
  assert.equal(issues[0].severity, 'info')
})

test('meta: canonical must be in head, absolute, unique and without fragment', () => {
  const head = (links) =>
    `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}">${links}</head><body></body></html>`
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical" href="https://a.com/x">')))), [])
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical" href="/x">')))), ['relative-canonical'])
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical" href="https://a.com/x#y">')))), [
    'canonical-fragment'
  ])
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical">')))), ['empty-canonical'])
  assert.deepEqual(
    types(
      checkMeta(
        parse(head('<link rel="canonical" href="https://a.com/x"><link rel="canonical" href="https://a.com/y">'))
      )
    ),
    ['multiple-canonicals']
  )
})

test('meta: identical duplicate canonicals are redundant (info), differing ones conflict (warning)', () => {
  const head = (links) =>
    `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}">${links}</head><body></body></html>`
  const same = checkMeta(
    parse(head('<link rel="canonical" href="https://a.com/"><link rel="canonical" href=" https://a.com/ ">'))
  )
  assert.deepEqual(types(same), ['multiple-canonicals'])
  assert.equal(same[0].severity, 'info')
  assert.match(same[0].message, /redundant/i)
  assert.doesNotMatch(same[0].message, /conflicting/i)
  const diff = checkMeta(
    parse(head('<link rel="canonical" href="https://a.com/x"><link rel="canonical" href="https://a.com/y">'))
  )
  assert.equal(diff[0].severity, 'warning')
  assert.match(diff[0].message, /conflicting signals/)
})

test('meta: canonical is found when rel has several tokens or odd case', () => {
  const head = (link) =>
    `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}">${link}</head></html>`
  assert.deepEqual(checkMeta(parse(head('<link rel="canonical nofollow" href="https://a.com/x">'))), [])
  assert.deepEqual(checkMeta(parse(head('<link rel="  Canonical " href="https://a.com/x">'))), [])
})

test('meta: an empty description does not hide a later real one, but still counts as a duplicate', () => {
  const d = 'd'.repeat(80)
  const html = `<html><head><title>T</title><meta name="description" content=""><meta name="description" content="${d}"><link rel="canonical" href="https://a.com/"></head></html>`
  assert.deepEqual(types(checkMeta(parse(html))), ['multiple-descriptions'])
})

test('meta: several non-empty descriptions are flagged', () => {
  const d = 'd'.repeat(80)
  const html = `<html><head><title>T</title><meta name="description" content="${d}"><meta name="description" content="${d}x"><link rel="canonical" href="https://a.com/"></head></html>`
  const issues = checkMeta(parse(html))
  assert.deepEqual(types(issues), ['multiple-descriptions'])
  assert.equal(issues[0].severity, 'warning')
})

test('meta: canonical in body is reported as missing from head', () => {
  const html = `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}"></head><body><link rel="canonical" href="https://a.com/x"></body></html>`
  const issues = checkMeta(parse(html))
  assert.deepEqual(types(issues), ['missing-canonical'])
  assert.match(issues[0].message, /outside <head>/)
})

test('meta: title boundary at 60', () => {
  assert.deepEqual(checkMeta(parse(goodHead('a'.repeat(60)))), [])
  assert.deepEqual(types(checkMeta(parse(goodHead('a'.repeat(61))))), ['long-title'])
})

test('meta: description boundaries at 70 and 160', () => {
  assert.deepEqual(checkMeta(parse(goodHead('T', 'a'.repeat(160)))), [])
  assert.deepEqual(types(checkMeta(parse(goodHead('T', 'a'.repeat(161))))), ['long-description'])
  assert.deepEqual(checkMeta(parse(goodHead('T', 'a'.repeat(70)))), [])
  assert.deepEqual(types(checkMeta(parse(goodHead('T', 'a'.repeat(69))))), ['short-description'])
})

test('headings: no h1 is a warning', () => {
  const issues = checkHeadings(parse('<p>hi</p>'))
  assert.deepEqual(types(issues), ['missing-h1'])
  assert.equal(issues[0].severity, 'warning')
})

test('headings: multiple h1 is info', () => {
  const issues = checkHeadings(parse('<h1>a</h1><h1>b</h1>'))
  assert.deepEqual(types(issues), ['multiple-h1'])
  assert.equal(issues[0].severity, 'info')
})

test('headings: empty heading is flagged unless it has an image with alt or aria-label', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1> </h1>'))), ['empty-heading'])
  assert.deepEqual(types(checkHeadings(parse('<h1><img src="a.png" alt="Logo"></h1>'))), [])
  assert.deepEqual(types(checkHeadings(parse('<h1 aria-label="Title"></h1>'))), [])
  assert.deepEqual(types(checkHeadings(parse('<h1 aria-labelledby="t"></h1><p id="t">Title</p>'))), [])
})

test('headings: skipped level is a warning', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1>a</h1><h3>b</h3>'))), ['skipped-heading-level'])
})

test('headings: h3 before any h2 is flagged, going back up is fine', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>'))), [])
  assert.deepEqual(types(checkHeadings(parse('<h3>c</h3><h1>a</h1>'))), ['skipped-heading-level'])
})

const fixture = (name) => parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const allTypes = ($) => [...checkImages($), ...checkMeta($), ...checkHeadings($)].map((i) => i.type).sort()

test('fixture good.html: no issues', () => {
  assert.deepEqual(allTypes(fixture('good.html')), [])
})

test('fixture bad-overlong.html: overlong, duplicate and skipped issues', () => {
  assert.deepEqual(allTypes(fixture('bad-overlong.html')), [
    'empty-alt',
    'long-description',
    'long-title',
    'missing-alt',
    'missing-canonical',
    'missing-dimensions',
    'multiple-h1',
    'skipped-heading-level'
  ])
})

test('every issue has severity, category and source', () => {
  for (const name of [
    'bad-overlong.html',
    'bad-missing.html',
    'bad-canonical.html',
    'bad-images.html',
    'bad-empty.html'
  ]) {
    for (const issue of [...checkImages(fixture(name)), ...checkMeta(fixture(name)), ...checkHeadings(fixture(name))]) {
      assert.match(issue.severity, /^(error|warning|info)$/, issue.type)
      assert.match(issue.category, /^(seo|accessibility|performance|best-practice)$/, issue.type)
      assert.match(issue.source, /^https:\/\//, issue.type)
    }
  }
})

test('fixture bad-canonical.html: relative, fragment and multiple canonicals', () => {
  assert.deepEqual(allTypes(fixture('bad-canonical.html')), [
    'canonical-fragment',
    'multiple-canonicals',
    'relative-canonical'
  ])
})

test('fixture bad-images.html: generic name, alt is filename, missing src, empty alt in link', () => {
  assert.deepEqual(allTypes(fixture('bad-images.html')), [
    'alt-is-filename',
    'empty-alt',
    'empty-alt-in-link',
    'generic-filename',
    'missing-src'
  ])
})

test('fixture bad-empty.html: empty title, short description, empty headings', () => {
  assert.deepEqual(allTypes(fixture('bad-empty.html')), [
    'empty-alt',
    'empty-heading',
    'empty-heading',
    'empty-title',
    'short-description'
  ])
})

test('fixture bad-missing.html: missing title, description, canonical and h1', () => {
  assert.deepEqual(allTypes(fixture('bad-missing.html')), [
    'missing-canonical',
    'missing-description',
    'missing-h1',
    'missing-title'
  ])
})

const TEMPLATE_MARKUP = '<template><h4></h4><img src="a.jpg"><template><h6></h6><img src="b.jpg"></template></template>'

test('parse: inert <template> content is dropped, including nested templates', () => {
  const $ = parse(`<body><h1>Title</h1>${TEMPLATE_MARKUP}</body>`)
  assert.equal($('template').length, 0)
  assert.equal($('img').length, 0)
  assert.equal($('h4, h6').length, 0)
})

test('images: images inside <template> are not audited', () => {
  const html = `<img src="ok.jpg" alt="A product" width="1" height="1">${TEMPLATE_MARKUP}`
  assert.deepEqual(checkImages(parse(html)), [])
})

test('headings: headings inside <template> are not audited', () => {
  const html = `<h1>Title</h1><h2>Sub</h2>${TEMPLATE_MARKUP}`
  assert.deepEqual(checkHeadings(parse(html)), [])
})

test('meta: title length ignores whitespace runs from multi-line markup', () => {
  const title = '\n      Gentle Shampoo for all\n      hair types |\n      Example Store Online\n    '
  assert.deepEqual(types(checkMeta(parse(goodHead(title)))), [])
  const long = `\n   ${'word '.repeat(13)}\n   end\n `
  const issues = checkMeta(parse(goodHead(long)))
  assert.deepEqual(types(issues), ['long-title'])
  assert.match(issues[0].message, /Title is 68 chars/)
  assert.equal(issues[0].context, `<title>${'word '.repeat(13)}end</title>`)
})

test('meta: description length and context ignore whitespace runs', () => {
  const words = 'a'.repeat(50)
  const spread = `\n     ${words}\n     ${words}\n     ${words}\n   `
  assert.deepEqual(types(checkMeta(parse(goodHead('T', spread)))), [])
  const short = checkMeta(parse(goodHead('T', '\n    short\n    text\n  ')))
  assert.deepEqual(types(short), ['short-description'])
  assert.match(short[0].message, /only 10 chars/)
  assert.equal(short[0].context, '<meta name="description" content="short text">')
})

test('headings: contexts collapse whitespace', () => {
  const issues = checkHeadings(
    parse('<body><h1>Line one\n   of heading</h1><h1>Two\n  h1</h1><h4>Skipped\n    level</h4></body>')
  )
  assert.equal(issues.find((i) => i.type === 'multiple-h1').context, '<h1>Line one of heading</h1> <h1>Two h1</h1>')
  assert.equal(issues.find((i) => i.type === 'skipped-heading-level').context, '<h4>Skipped level</h4>')
})

test('headings: empty heading context is truncated for large markup', () => {
  const paths = '<path d="M0 0L10 10Z"/>'.repeat(200)
  const issues = checkHeadings(parse(`<h1>Title</h1><h2><svg>${paths}</svg></h2>`))
  const empty = issues.find((i) => i.type === 'empty-heading')
  assert.ok(empty.context.length <= 120)
  assert.ok(empty.context.endsWith('...'))
})

test('meta: long title, description and canonical contexts are truncated', () => {
  const long = 'x'.repeat(500)
  const html = `<html><head><title>${long}</title><meta name="description" content="${long}"><link rel="canonical" href="/${long}"></head></html>`
  const issues = checkMeta(parse(html))
  assert.ok(issues.length > 0)
  for (const issue of issues) assert.ok(issue.context.length <= 120, `${issue.type}: ${issue.context.length}`)
})

test('headings: multiple-h1 and skipped-level contexts are truncated for long text', () => {
  const long = 'x'.repeat(300)
  const issues = checkHeadings(parse(`<h1>${long}</h1><h1>${long}</h1><h4>${long}</h4>`))
  for (const type of ['multiple-h1', 'skipped-heading-level']) {
    const { context } = issues.find((i) => i.type === type)
    assert.equal(context.length, 120)
    assert.ok(context.endsWith('...'))
  }
})

test('snippet: truncate never splits a surrogate pair', () => {
  const text = `${'a'.repeat(116)}😀${'b'.repeat(10)}`
  const cut = truncate(text)
  assert.equal(cut, `${'a'.repeat(116)}😀...`)
  assert.doesNotMatch(cut, /[\ud800-\udbff](?![\udc00-\udfff])/)
})

test('headings: empty heading context collapses markup whitespace', () => {
  const issues = checkHeadings(parse('<h1>x</h1><h2>\n      <span></span>\n    </h2>'))
  assert.equal(issues.find((i) => i.type === 'empty-heading').context, '<h2> <span></span> </h2>')
})

test('meta: title and description lengths count characters, not UTF-16 code units', () => {
  const title = `${'a'.repeat(55)}😀😀😀😀😀`
  assert.deepEqual(types(checkMeta(parse(goodHead(title)))), [])
  const issues = checkMeta(parse(goodHead(`${title}b`)))
  assert.match(issues[0].message, /Title is 61 chars/)
  const short = checkMeta(parse(goodHead('T', '😀'.repeat(10))))
  assert.match(short[0].message, /only 10 chars/)
})

// Social, indexing, structured data and hygiene checks.

const OG =
  '<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="https://a.test/i.png">'
const TWITTER = '<meta name="twitter:card" content="summary">'

test('social: no Open Graph and no card are two infos', () => {
  const issues = checkSocial(parse('<head></head>'))
  assert.deepEqual(types(issues), ['missing-open-graph', 'missing-twitter-card'])
  assert.ok(issues.every((i) => i.severity === 'info' && i.category === 'best-practice'))
})

test('social: partial Open Graph names the missing tags', () => {
  const issues = checkSocial(parse(`<meta property="og:title" content="t">${TWITTER}`))
  assert.deepEqual(types(issues), ['incomplete-open-graph'])
  assert.match(issues[0].message, /og:description, og:image/)
})

test('social: complete Open Graph and a card are fine', () => {
  assert.deepEqual(checkSocial(parse(OG + TWITTER)), [])
})

test('indexing: noindex is a warning, also from the googlebot tag and "none"', () => {
  for (const html of [
    '<meta name="robots" content="noindex, follow">',
    '<meta name="googlebot" content="NOINDEX">',
    '<meta name="robots" content="none">'
  ]) {
    const issues = checkIndexing(
      parse(`<html lang="en"><head>${html}<meta name="viewport" content="width=device-width"></head>`)
    )
    assert.ok(types(issues).includes('noindex'), html)
    assert.equal(issues.find((i) => i.type === 'noindex').severity, 'warning')
  }
})

test('indexing: nofollow is info, index and follow are not flagged', () => {
  const page = (robots) =>
    parse(`<html lang="en"><head><meta name="robots" content="${robots}"><meta name="viewport" content="x"></head>`)
  assert.deepEqual(types(checkIndexing(page('index, nofollow'))), ['nofollow'])
  assert.deepEqual(checkIndexing(page('index, follow')), [])
})

test('indexing: missing viewport and lang are warnings', () => {
  const issues = checkIndexing(parse('<html><head></head>'))
  assert.deepEqual(types(issues), ['missing-viewport', 'missing-lang'])
  assert.deepEqual(
    issues.map((i) => i.category),
    ['seo', 'accessibility']
  )
  assert.deepEqual(types(checkIndexing(parse('<html lang=" "><head><meta name="viewport" content="x">'))), [
    'missing-lang'
  ])
})

const ld = (json) =>
  parse(`<script type="application/ld+json">${typeof json === 'string' ? json : JSON.stringify(json)}</script>`)
const CONTEXT = { '@context': 'https://schema.org' }

test('structured data: invalid JSON is reported with the parser error', () => {
  const issues = checkStructuredData(ld('{ not json'))
  assert.deepEqual(types(issues), ['invalid-json-ld'])
  assert.match(issues[0].context, /not json/)
})

test('structured data: a block without @context is flagged, @graph and arrays are walked', () => {
  assert.deepEqual(types(checkStructuredData(ld({ '@type': 'Organization' }))), ['json-ld-missing-context'])
  assert.deepEqual(
    checkStructuredData(ld({ ...CONTEXT, '@graph': [{ '@type': 'Organization', url: 'https://a.test/' }] })),
    []
  )
  assert.deepEqual(checkStructuredData(ld([{ ...CONTEXT, '@type': 'Organization' }])), [])
})

test('structured data: relative URLs are flagged in strings, arrays and image objects', () => {
  const org = {
    ...CONTEXT,
    '@type': 'Organization',
    url: '/about',
    logo: { '@type': 'ImageObject', url: 'logo.png' },
    sameAs: ['https://x.test/a', '/b']
  }
  const issues = checkStructuredData(ld(org))
  assert.deepEqual(types(issues), ['json-ld-relative-url', 'json-ld-relative-url', 'json-ld-relative-url'])
  assert.deepEqual(checkStructuredData(ld({ ...CONTEXT, '@type': 'Organization', url: 'https://a.test/' })), [])
})

test('structured data: types without a Google rich result are info', () => {
  for (const type of ['HowTo', 'FAQPage', 'ClaimReview']) {
    const issues = checkStructuredData(ld({ ...CONTEXT, '@type': type }))
    assert.deepEqual(types(issues), ['unsupported-schema-type'], type)
    assert.equal(issues[0].severity, 'info')
  }
  assert.deepEqual(checkStructuredData(ld({ ...CONTEXT, '@type': 'Article' })), [])
})

test('structured data: Product needs a name and one of offers, review, aggregateRating', () => {
  const product = (fields) => checkStructuredData(ld({ ...CONTEXT, '@type': 'Product', ...fields }))
  assert.deepEqual(types(product({})), ['missing-schema-property'])
  assert.match(product({ name: 'x' })[0].message, /one of offers, review or aggregateRating/)
  assert.deepEqual(product({ name: 'x', offers: {} }), [])
  assert.deepEqual(product({ name: 'x', aggregateRating: {} }), [])
})

test('structured data: BreadcrumbList needs itemListElement', () => {
  assert.deepEqual(types(checkStructuredData(ld({ ...CONTEXT, '@type': 'BreadcrumbList' }))), [
    'missing-schema-property'
  ])
  assert.deepEqual(checkStructuredData(ld({ ...CONTEXT, '@type': 'BreadcrumbList', itemListElement: [] })), [])
})

const hygiene = (html, page = {}) => checkHygiene(parse(html), { url: 'https://a.test/page', html, ...page })
const WORDS = 'word '.repeat(30)

test('hygiene: long, underscore and uppercase URLs are infos', () => {
  const url = `https://a.test/Some_Path/${'a'.repeat(100)}`
  assert.deepEqual(types(hygiene(WORDS, { url })), ['long-url', 'url-underscores', 'url-uppercase'])
  assert.deepEqual(hygiene(WORDS, { url: 'https://a.test/some-path/' }), [])
  assert.deepEqual(types(hygiene(WORDS, { url: 'https://a.test/caf%C3%A9%' })), [])
})

test('hygiene: HTML over 2 MB is a warning, exactly 2 MB is fine', () => {
  const limit = 2 * 1024 * 1024
  const html = (bytes) => '<p>' + 'a'.repeat(bytes - 7) + '</p>'
  assert.deepEqual(types(hygiene(html(limit + 1))), ['html-too-large'])
  assert.deepEqual(hygiene(html(limit)), [])
})

test('hygiene: http resources on an https page are mixed content, on an http page they are not', () => {
  const html = `<p>${WORDS}</p><img src="http://a.test/a.png"><script src="http://a.test/a.js"></script><link rel="stylesheet" href="http://a.test/a.css"><img src="https://a.test/ok.png"><a href="http://a.test/">link</a>`
  assert.deepEqual(types(hygiene(html)), ['mixed-content', 'mixed-content', 'mixed-content'])
  assert.deepEqual(hygiene(html, { url: 'http://a.test/page' }), [])
})

test('hygiene: an empty app root or a noscript warning with no text is a client-side rendered shell', () => {
  assert.deepEqual(types(hygiene('<body><div id="root"></div><script src="/a.js"></script></body>')), [
    'client-side-rendered'
  ])
  assert.deepEqual(types(hygiene('<body><noscript>You need to enable JavaScript to run this app.</noscript></body>')), [
    'client-side-rendered'
  ])
})

test('hygiene: server rendered pages and short static pages are not shells', () => {
  assert.deepEqual(hygiene(`<body><div id="root"><p>${WORDS}</p></div></body>`), [])
  assert.deepEqual(hygiene('<body><p>Short page.</p></body>'), [])
})

// Review fixes.

const VIEWPORT_LANG = '<html lang="en"><head><meta name="viewport" content="x">'

test('indexing: directives from several robots tags add up', () => {
  const html = `${VIEWPORT_LANG}<meta name="robots" content="index, follow"><meta name="robots" content="noindex">`
  assert.deepEqual(types(checkIndexing(parse(html))), ['noindex'])
})

test('indexing: a noindex after a very long directive list is still found, uncut', () => {
  const content = `index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1, notranslate, unavailable_after: 2027-01-01, noindex`
  assert.deepEqual(types(checkIndexing(parse(`${VIEWPORT_LANG}<meta name="robots" content="${content}">`))), [
    'noindex'
  ])
})

test('indexing: the context shows the tag that holds the directive', () => {
  const html = `${VIEWPORT_LANG}<meta name="robots" content="index,follow"><meta name="googlebot" content="noindex">`
  assert.match(checkIndexing(parse(html))[0].context, /name="googlebot" content="noindex"/)
})

test('social: twitter:card as a property and og tags with name= are accepted', () => {
  const html = `<meta name="og:title" content="t"><meta name="og:description" content="d"><meta property="og:image" content="i"><meta property="twitter:card" content="summary">`
  assert.deepEqual(checkSocial(parse(html)), [])
})

test('hygiene: non-ASCII slugs are measured as people see them', () => {
  const url = `https://example.jp/${'ブ'.repeat(20)}`
  assert.deepEqual(hygiene(WORDS, { url: encodeURI(url) }), [])
  const long = hygiene(WORDS, { url: encodeURI(`https://example.jp/${'ブ'.repeat(100)}`) })
  assert.deepEqual(types(long), ['long-url'])
  assert.match(long[0].context, /ブ/)
})

test('hygiene: srcset candidates and <base href> count for mixed content', () => {
  const srcset = `<p>${WORDS}</p><img src="https://a.test/a.png" srcset="https://a.test/a.png 1x, http://a.test/a2.png 2x">`
  assert.deepEqual(types(hygiene(srcset)), ['mixed-content'])
  const base = `<base href="http://a.test/"><p>${WORDS}</p><img src="a.png">`
  assert.deepEqual(types(hygiene(base)), ['mixed-content'])
})

test('hygiene: an empty root next to headings or a form is not a shell', () => {
  assert.deepEqual(hygiene('<body><div id="root"></div><main><h1>Log in</h1><form></form></main></body>'), [])
})

test('hygiene: checkHtml without a page argument runs no URL or size checks', async () => {
  const { checkHtml } = await import('../src/checks/page/index.js')
  const issues = checkHtml(
    parse(`<html lang="en"><head><meta name="viewport" content="x"></head><body>${WORDS}</body>`)
  )
  assert.ok(!types(issues).some((type) => /url|too-large|mixed/.test(type)))
})

test('structured data: @context on a @graph member, arrays and @type arrays', () => {
  assert.deepEqual(checkStructuredData(ld({ '@graph': [{ ...CONTEXT, '@type': 'Organization' }] })), [])
  const mixed = [{ ...CONTEXT, '@type': 'Organization' }, { '@type': 'Person' }]
  assert.deepEqual(types(checkStructuredData(ld(mixed))), ['json-ld-missing-context'])
  const product = { ...CONTEXT, '@type': ['Product', 'Thing'] }
  assert.deepEqual(types(checkStructuredData(ld(product))), ['missing-schema-property'])
})

test('structured data: protocol-relative URLs are fine and a null @type is ignored', () => {
  assert.deepEqual(checkStructuredData(ld({ ...CONTEXT, '@type': 'Organization', logo: '//cdn.a.test/l.png' })), [])
  assert.deepEqual(checkStructuredData(ld({ ...CONTEXT, '@type': null, url: '/x' })), [])
})

// Second review fixes.

test('facts: robots joins every robots and googlebot tag', async () => {
  const { extractFacts } = await import('../src/checks/page/index.js')
  const html =
    '<meta name="robots" content="index"><meta name="robots" content="noindex"><meta name="googlebot" content="nofollow">'
  assert.equal(extractFacts(parse(html), 'https://a.test/').robots, 'index, noindex, nofollow')
})

test('social: an empty tag in front of a filled one does not hide it', () => {
  const html = `<meta property="og:title" content=""><meta name="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i"><meta property="twitter:card" content=""><meta name="twitter:card" content="summary">`
  assert.deepEqual(checkSocial(parse(html)), [])
})

test('hygiene: a broken percent escape does not leave letters behind', () => {
  assert.deepEqual(
    hygiene(WORDS, { url: 'https://a.test/a%4Gb' }).map((i) => i.type),
    ['url-uppercase']
  )
})

test('hygiene: http on localhost is not mixed content', () => {
  const html = `<p>${WORDS}</p><script src="http://localhost:3000/dev.js"></script><img src="http://127.0.0.1/a.png"><img src="http://app.localhost/a.png">`
  assert.deepEqual(hygiene(html), [])
})

test('hygiene: a static header with an empty mount point is a shell, a main area is not', () => {
  assert.deepEqual(types(hygiene('<body><header><h1>Brand</h1></header><div id="root"></div></body>')), [
    'client-side-rendered'
  ])
  const shell = hygiene('<body><main id="app"></main><script src="/app.js"></script></body>')
  assert.deepEqual(types(shell), ['client-side-rendered'])
  assert.match(shell[0].context, /<main id="app"><\/main>/)
})

test('hygiene: a noscript message on a page with visible text and no app root is not a shell', () => {
  assert.deepEqual(
    hygiene('<body><p>Hello there</p><noscript>This site requires JavaScript for comments</noscript></body>'),
    []
  )
})

test('structured data: relative URLs are found in nested objects', () => {
  const article = { ...CONTEXT, '@type': 'Article', publisher: { '@type': 'Organization', logo: '/logo.png' } }
  assert.deepEqual(types(checkStructuredData(ld(article))), ['json-ld-relative-url'])
  const product = { ...CONTEXT, '@type': 'Product', name: 'x', offers: { '@type': 'Offer', url: '/buy' } }
  assert.deepEqual(types(checkStructuredData(ld(product))), ['json-ld-relative-url'])
  const graph = { ...CONTEXT, '@graph': [{ '@type': 'Organization', url: '/a' }] }
  assert.equal(checkStructuredData(ld(graph)).length, 1)
})
