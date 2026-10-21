import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/parse.js'
import { checkA11y } from '../src/checks/page/a11y.js'
import { checkLinks } from '../src/checks/page/links.js'
import { checkImages } from '../src/checks/page/images.js'

const types = (issues) => issues.map((i) => i.type)
const a11y = (html) => types(checkA11y(parse(`<main>${html}</main>`)))
const links = (html) => types(checkLinks(parse(html)))

test('forms: a field with no label is an error', () => {
  assert.deepEqual(a11y('<input type="text" name="q">'), ['form-input-no-label'])
  assert.deepEqual(a11y('<select><option>a</option></select>'), ['form-input-no-label'])
})

test('forms: wrapping label, for label, aria-label, aria-labelledby and title name a field', () => {
  assert.deepEqual(a11y('<label>Name <input type="text"></label>'), [])
  assert.deepEqual(a11y('<label for="n">Name</label><input id="n">'), [])
  assert.deepEqual(a11y('<input aria-label="Search">'), [])
  assert.deepEqual(a11y('<span id="l">Email</span><input aria-labelledby="l">'), [])
  assert.deepEqual(a11y('<input title="Search">'), [])
})

test('forms: buttons, hidden fields and image inputs need no label', () => {
  assert.deepEqual(a11y('<input type="hidden"><input type="submit"><input type="image" alt="Go">'), [])
})

test('forms: an aria-labelledby that points at nothing does not name the field', () => {
  const issues = checkA11y(parse('<main><input aria-labelledby="gone"></main>'))
  assert.deepEqual(types(issues), ['form-input-no-label'])
  assert.match(issues[0].message, /aria-labelledby/)
  assert.deepEqual(a11y('<input aria-labelledby="gone" aria-label="Search">'), [])
})

test('forms: an empty label does not name the field', () => {
  assert.deepEqual(a11y('<label for="n"></label><input id="n">'), ['form-input-no-label'])
})

test('duplicate ids: unreferenced is a best-practice warning, referenced is an accessibility error', () => {
  const plain = checkA11y(parse('<main><p id="a"></p><p id="a"></p></main>'))
  assert.deepEqual(types(plain), ['duplicate-id'])
  assert.equal(plain[0].severity, 'warning')
  assert.equal(plain[0].category, 'best-practice')
  const used = checkA11y(parse('<main><label for="a">x</label><input id="a"><p id="a"></p></main>'))
  assert.equal(used[0].severity, 'error')
  assert.equal(used[0].category, 'accessibility')
  assert.deepEqual(a11y('<p id="a"></p><p id="b"></p>'), [])
})

test('landmarks: a page without <main> or role=main gets an info hint', () => {
  assert.deepEqual(types(checkA11y(parse('<p>hi</p>'))), ['missing-main-landmark'])
  assert.deepEqual(types(checkA11y(parse('<div role="main"></div>'))), [])
})

test('links: no text, aria-label or title is an error', () => {
  assert.deepEqual(links('<a href="/a"></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/a"><svg></svg></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/a">Pricing</a>'), [])
  assert.deepEqual(links('<a href="/a" aria-label="Pricing"></a>'), [])
  assert.deepEqual(links('<a href="/a" title="Pricing"></a>'), [])
})

test('links: aria-labelledby and svg titles give a name, a broken aria-labelledby does not', () => {
  assert.deepEqual(links('<span id="l">Pricing</span><a href="/a" aria-labelledby="l"></a>'), [])
  assert.deepEqual(links('<a href="/a"><svg><title>Pricing</title></svg></a>'), [])
  assert.deepEqual(links('<a href="/a" aria-labelledby="gone"></a>'), ['link-no-name'])
})

test('links: an image-only link is left to the image checks, with no duplicate finding', () => {
  const html = '<a href="/a"><img src="/a.png" alt="" width="1" height="1"></a>'
  assert.deepEqual(links(html), [])
  assert.deepEqual(types(checkImages(parse(html))), ['empty-alt-in-link'])
  assert.deepEqual(
    types(checkImages(parse('<a href="/a" aria-label="Home"><img src="/a.png" alt="" width="1" height="1"></a>'))),
    ['empty-alt']
  )
})

test('links: generic text and placeholder hrefs are info hints', () => {
  const generic = checkLinks(parse('<a href="/a">Click here!</a><a href="/b">Read more</a>'))
  assert.deepEqual(types(generic), ['link-generic-text', 'link-generic-text'])
  assert.ok(generic.every((i) => i.severity === 'info'))
  const empty = checkLinks(parse('<a href="#">Menu</a><a href="javascript:void(0)">Open</a>'))
  assert.deepEqual(types(empty), ['link-empty-href', 'link-empty-href'])
  assert.ok(empty.every((i) => i.severity === 'info'))
  assert.deepEqual(links('<a href="#top">Back to top</a><a name="x">anchor</a>'), [])
})

test('links: target=_blank is not flagged, modern browsers imply noopener', () => {
  assert.deepEqual(links('<a href="https://x.test" target="_blank">External</a>'), [])
})

test('names: aria-labelledby resolves image alt, aria-label and svg titles of the referenced element', () => {
  assert.deepEqual(a11y('<span id="l"><img alt="Search"></span><input aria-labelledby="l">'), [])
  assert.deepEqual(a11y('<span id="l"><b aria-label="Search"></b></span><input aria-labelledby="l">'), [])
  assert.deepEqual(links('<span id="l"><img alt="Pricing"></span><a href="/a" aria-labelledby="l"></a>'), [])
  assert.deepEqual(a11y('<span id="l" hidden>Search</span><input aria-labelledby="l">'), [])
})

test('names: an image-only link named through aria-labelledby is not reported by the image check', () => {
  const img = (alt) => `<img src="/a.png" alt="${alt}" width="1" height="1">`
  const html = `<span id="l">${img('Search')}</span><a href="/a" aria-labelledby="l">${img('')}</a>`
  assert.deepEqual(types(checkImages(parse(html))), ['empty-alt'])
})

test('names: aria-labelledby that references itself or another reference does not loop', () => {
  assert.deepEqual(a11y('<input id="a" aria-labelledby="a">'), ['form-input-no-label'])
  assert.deepEqual(
    a11y(
      '<span id="a" aria-labelledby="b">x</span><span id="b" aria-labelledby="a">y</span><input aria-labelledby="a">'
    ),
    []
  )
})

test('names: explicitly hidden descendants do not name a link', () => {
  assert.deepEqual(links('<a href="/"><span aria-hidden="true">Home</span></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/"><span hidden>Home</span></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/"><span aria-hidden="true">x</span> Home</a>'), [])
})

test('names: script, style and noscript content does not name a link', () => {
  assert.deepEqual(links('<a href="/a"><style>.a{}</style></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/a"><script>x()</script></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/a"><noscript>click here</noscript></a>'), ['link-no-name'])
  assert.deepEqual(links('<a href="/a">Read more<noscript> about pricing</noscript></a>'), ['link-generic-text'])
})

test('labels: an explicit for wins over a wrapping label', () => {
  assert.deepEqual(a11y('<label for="other">Name<input id="n"></label>'), ['form-input-no-label'])
  assert.deepEqual(a11y('<label for="">Name<input id="n"></label>'), ['form-input-no-label'])
  assert.deepEqual(a11y('<label for="n">Name<input id="n"></label>'), [])
})

test('labels: a wrapping label without for names only its first labelable descendant', () => {
  assert.deepEqual(a11y('<label>Name <input id="a"><input id="b"></label>'), ['form-input-no-label'])
})

test('names: a directly referenced image names with its own alt', () => {
  assert.deepEqual(a11y('<img id="l" alt="Search"><input aria-labelledby="l">'), [])
  assert.deepEqual(links('<img id="l" alt="Pricing"><a href="/a" aria-labelledby="l"></a>'), [])
  assert.deepEqual(a11y('<img id="l" alt=""><input aria-labelledby="l">'), ['form-input-no-label'])
})

test('names: a hidden referenced target keeps its hidden descendants, ordinary links do not', () => {
  assert.deepEqual(a11y('<span id="l" hidden><span hidden>Search</span></span><input aria-labelledby="l">'), [])
  assert.deepEqual(links('<a href="/"><span><span hidden>Home</span></span></a>'), ['link-no-name'])
})

test('links: a hidden image does not hide a nameless link from both checkers', () => {
  const img = (attrs, alt) => `<img ${attrs} src="/a.png" alt="${alt}" width="1" height="1">`
  const hidden = `<a href="/">${img('aria-hidden="true"', 'Home')}</a>`
  assert.deepEqual(links(hidden), ['link-no-name'])
  const wrapped = '<a href="/"><span hidden>' + img('', 'Home') + '</span></a>'
  assert.deepEqual(links(wrapped), ['link-no-name'])
  assert.deepEqual(links(`<a href="/">${img('', '')}</a>`), [])
})

test('images: a hidden image with alt does not stop empty-alt-in-link for a visible decorative image', () => {
  const img = (attrs, alt) => `<img ${attrs} src="/a.png" alt="${alt}" width="1" height="1">`
  const html = `<a href="/">${img('aria-hidden="true"', 'Home')}${img('', '')}</a>`
  assert.deepEqual(types(checkImages(parse(html))), ['empty-alt-in-link'])
})
