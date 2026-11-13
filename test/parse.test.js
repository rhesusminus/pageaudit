import assert from 'node:assert/strict'
import test from 'node:test'
import { isElement, parse } from '../src/parse.js'

const nested = (depth, inner = 'x') => `<main>${'<span>'.repeat(depth)}${inner}</main>`

// The depth of the deepest element, the document being 0.
function maxDepth($) {
  let max = 0
  const stack = [[$.root()[0], 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (isElement(node)) max = Math.max(max, depth)
    for (const child of node.children ?? []) stack.push([child, depth + 1])
  }
  return max
}

test("parse: leaves a page within Chrome's depth limit as it is", () => {
  const $ = parse('<html><body><main><p>Hi <b>there</b></p></main></body></html>')
  assert.equal($('main > p > b').text(), 'there')
  assert.equal(maxDepth($), 5)
})

test("parse: caps the elements at Chrome's depth of 513", () => {
  assert.equal(maxDepth(parse(nested(600))), 513)
  assert.equal(maxDepth(parse(nested(20000))), 513)
  assert.equal(maxDepth(parse(nested(510))), 513)
  assert.equal(maxDepth(parse(nested(509))), 512)
})

test('parse: keeps the text of elements below the cap inside them', () => {
  const $ = parse(
    nested(600, '<h1>Title</h1><a href="/deep">deep</a><script type="application/ld+json">{"a":1}</script><i>tail</i>')
  )
  assert.equal($('h1').text(), 'Title')
  assert.equal($('a').attr('href'), '/deep')
  assert.equal($('a').text(), 'deep')
  assert.equal($('script').text(), '{"a":1}')
  assert.equal($('main').text(), 'Titledeep{"a":1}tail')
  assert.equal($('a').next().is('script'), true)
})

test('parse: a child just past the cap becomes a sibling of its parent, as in Chrome', () => {
  // <main> is at depth 3, so 508 spans put the <section> at 512 and its <a> at 513, still inside it.
  assert.equal(parse(nested(508, '<section><a href="/a">a</a></section>'))('section > a').length, 1)
  // One more span puts the <a> at 514: it is attached to the <section>'s parent instead.
  const $ = parse(nested(509, '<section><a href="/a">a</a></section>'))
  assert.equal($('section > a').length, 0)
  assert.equal($('section').next().is('a'), true)
})

test('parse: a void element at the boundary stays in its parent, as in Chrome', () => {
  // An <img> is never open, so it only moves from a parent two levels past the cap, not one.
  const $ = parse(nested(509, '<a href="/a"><img src="/i.png" alt="Report"></a>'))
  assert.equal($('a > img').length, 1)
  assert.equal($('a').next().length, 0)
  assert.equal(parse(nested(510, '<a href="/a"><img src="/i.png" alt="Report"></a>'))('a > img').length, 0)
})

test('parse: scripts and styles move like any other element', () => {
  // <script> and <style> are open elements too: at depth 514 they move to the parent's parent.
  const $ = parse(nested(510, '<script>1</script><style>a{}</style>'))
  assert.equal($('script, style').length, 2)
  assert.equal(maxDepth($), 513)
})

test('parse: foreign elements named like void HTML elements are open and keep their children', () => {
  const $ = parse(nested(509, `<svg><source>${'<g>'.repeat(2000)}</source></svg>`))
  assert.equal(maxDepth($), 513)
  assert.equal($('g').length, 2000)
})

test('parse: the text left in a relocated element keeps consistent sibling links', () => {
  const $ = parse(nested(509, '<section>A<b>B</b>C</section>'))
  const [a, c] = $('section')[0].children
  assert.equal(a.data, 'A')
  assert.equal(a.next, c)
  assert.equal(c.prev, a)
  assert.equal(c.next, null)
  assert.equal($('section').next().is('b'), true)
  $('section').contents().remove()
  assert.equal($('section').next().is('b'), true)
  assert.equal($('b').prev().is('section'), true)
})

test('parse: ignores inert <template> content in a deep page', () => {
  const $ = parse(nested(600, '<template><h1>Hidden</h1></template>'))
  assert.equal($('h1').length, 0)
})
