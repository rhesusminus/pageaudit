import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as cheerio from 'cheerio'
import { markupStart } from '../src/checks/markup.js'
import { visibleText, visibleTextStart } from '../src/checks/page/content.js'
import { parse } from '../src/parse.js'
import { collapseWhitespace, limit } from '../src/text.js'

const SIZES = [1, 5, 10, 40, 120, 500]

// What markupStart stands in for: the whole element serialized, collapsed and cut.
const wholeMarkup = ($, el, max) => limit(collapseWhitespace($.html(el)), max)

// Pages built where a cut could go wrong, checked along with the fixture pages.
const TRICKY_PAGES = {
  'whitespace runs': `<div>a${' \n\t '.repeat(300)}b<p>  c  </p>${' '.repeat(2000)}<span> d </span></div>`,
  'whitespace only text': `<div><i></i>${'   '.repeat(500)}<i></i>${'\n'.repeat(500)}<b>x</b></div>`,
  'non-breaking spaces': `<p>${' a '.repeat(400)}</p>`,
  emoji: `<p>${'😀 é'.repeat(400)}</p><p>${'😀'.repeat(600)}</p>`,
  entities: `<p title="a &quot;b&quot; &amp; c">${'&lt;x&gt; &amp; '.repeat(200)}</p>`,
  'script and style': `<div><script>if (a < b && c) {${' x();'.repeat(300)}}</script><style>a > b { color: red }</style></div>`,
  'svg and math': `<div><svg viewBox="0 0 1 1"><foreignObject><p>${'text '.repeat(200)}</p></foreignObject><path d="M0 0"/></svg><math><mi>x</mi></math></div>`,
  comments: `<div><!-- ${'note '.repeat(300)} -->${'<!---->'.repeat(50)}<b>after</b></div>`,
  'long attributes': `<div data-a="${'v '.repeat(400)}" class="${'c'.repeat(800)}"><span id="x">y</span></div>`,
  'void elements': `<p>${'<br><img src="/a.png" alt=" x "><input value="v">'.repeat(100)}</p>`,
  'deep nesting': `${'<div><span>'.repeat(300)}${'<i></i>'.repeat(500)}text${'</span></div>'.repeat(300)}`,
  'many attributes': `<p ${Array.from({ length: 300 }, (_, i) => `a${i}`).join(' ')}>x</p>`,
  noscript: `<div><noscript>${'menu '.repeat(200)}</noscript>visible<span> more ${'words '.repeat(100)}</span></div>`,
  tables: `<table>${'<tr><td> a </td><td>b</td></tr>'.repeat(100)}</table>`
}

function pages() {
  const dir = new URL('./fixtures/', import.meta.url)
  const fixtures = readdirSync(dir).filter((name) => name.endsWith('.html'))
  assert.ok(fixtures.length > 10)
  return [...fixtures.map((name) => [name, readFileSync(new URL(name, dir), 'utf8')]), ...Object.entries(TRICKY_PAGES)]
}

// Runs `assertSame($, el, max, label)` for every element of every page and every size.
function forEveryElement(assertSame) {
  for (const [name, html] of pages()) {
    const $ = parse(html)
    for (const el of $('*').toArray()) {
      for (const max of SIZES) assertSame($, el, max, `${name}: <${el.name}> cut at ${max}`)
    }
  }
}

test('markup start: the same as cutting the whole markup of any element', () => {
  forEveryElement(($, el, max, label) => assert.equal(markupStart($, el, max), wholeMarkup($, el, max), label))
})

test('visible text start: the same as cutting the whole visible text of any element', () => {
  const cut = (text, max) => limit(collapseWhitespace(text), max)
  forEveryElement((_, el, max, label) =>
    assert.equal(cut(visibleTextStart(el, max + 1), max), cut(visibleText(el), max), label)
  )
})

// parse() removes templates, but markupStart must not depend on it: the serializer reads a template's content from
// its first child, so a copy that stops at the template still needs that child.
test('markup start: the same as cutting the whole markup for a template where the cut falls', () => {
  const $ = cheerio.load(`<div>${'x'.repeat(115)}<template><p>hi there</p></template></div>`)
  const div = $('div').get(0)
  for (let max = 110; max <= 140; max++) {
    assert.equal(markupStart($, div, max), wholeMarkup($, div, max), `cut at ${max}`)
  }
})
