import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { markupStart } from '../src/checks/markup.js'
import { parse } from '../src/parse.js'
import { collapseWhitespace, limit } from '../src/text.js'

const SIZES = [1, 5, 10, 40, 120, 500]

// What markupStart stands in for: the whole element serialized, collapsed and cut.
const wholeMarkup = ($, el, max) => limit(collapseWhitespace($.html(el)), max)

function assertSameForEveryElement(html, label) {
  const $ = parse(html)
  for (const el of $('*').toArray()) {
    for (const max of SIZES) {
      assert.equal(markupStart($, el, max), wholeMarkup($, el, max), `${label}: <${el.name}> cut at ${max}`)
    }
  }
}

test('markup start: the same as cutting the whole markup, for every element of the fixture pages', () => {
  const dir = new URL('./fixtures/', import.meta.url)
  const pages = readdirSync(dir).filter((name) => name.endsWith('.html'))
  assert.ok(pages.length > 10)
  for (const name of pages) assertSameForEveryElement(readFileSync(new URL(name, dir), 'utf8'), name)
})

test('markup start: the same as cutting the whole markup where a cut could go wrong', () => {
  const cases = {
    'whitespace runs': `<div>a${' \n\t '.repeat(300)}b<p>  c  </p>${' '.repeat(2000)}<span> d </span></div>`,
    'whitespace only text': `<div><i></i>${'   '.repeat(500)}<i></i>${'\n'.repeat(500)}<b>x</b></div>`,
    'non-breaking spaces': `<p>${' a '.repeat(400)}</p>`,
    emoji: `<p>${'😀 é'.repeat(400)}</p><p>${'😀'.repeat(600)}</p>`,
    entities: `<p title="a &quot;b&quot; &amp; c">${'&lt;x&gt; &amp; '.repeat(200)}</p>`,
    'script and style': `<div><script>if (a < b && c) {${' x();'.repeat(300)}}</script><style>a > b { color: red }</style></div>`,
    'svg and math': `<div><svg viewBox="0 0 1 1"><foreignObject><p>${'text '.repeat(200)}</p></foreignObject><path d="M0 0"/></svg><math><mi>x</mi></math></div>`,
    comments: `<div><!-- ${'note '.repeat(300)} -->${'<!---->'.repeat(50)}<b>after</b></div>`,
    'long attributes': `<div data-a="${'v '.repeat(400)}" class="${'c'.repeat(800)}"><span id="x">y</span></div>`,
    'void elements': `<p>${'<br><img src="/a.png" alt=" x "><input value="v">'.repeat(100)}</p>`,
    'deep nesting': `${'<div><span>'.repeat(300)}${'<i></i>'.repeat(500)}text${'</span></div>'.repeat(300)}`,
    'many attributes': `<p ${Array.from({ length: 300 }, (_, i) => `a${i}`).join(' ')}>x</p>`,
    tables: `<table>${'<tr><td> a </td><td>b</td></tr>'.repeat(100)}</table>`
  }
  for (const [label, html] of Object.entries(cases)) assertSameForEveryElement(html, label)
})
