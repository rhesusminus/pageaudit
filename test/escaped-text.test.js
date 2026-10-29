import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { checkEscapedText } from '../src/checks/page/escaped-text.js'
import { checkHtml } from '../src/checks/page/index.js'
import { parse } from '../src/parse.js'
import { htmlEntities } from '../src/text.js'

const page = (head) => parse(`<html><head>${head}</head><body><p>x</p></body></html>`)
const fixture = async (name) => parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

test('htmlEntities: named, decimal and hex entities, each once', () => {
  assert.deepEqual(htmlEntities('a &lt;3 &amp; &#8226; &#x2022; &AMP; &lt;'), [
    '&lt;',
    '&amp;',
    '&#8226;',
    '&#x2022;',
    '&AMP;'
  ])
})

test('htmlEntities: an ampersand that starts no real entity is plain text', () => {
  assert.deepEqual(htmlEntities('AT&T, R&D; &foo; &amp without a semicolon, & alone'), [])
})

test('double-escaped-text: an entity left in the decoded title, description and preview text', async () => {
  const issues = checkEscapedText(await fixture('escaped.html'))
  assert.deepEqual(
    issues.map(({ type, severity, category, actual }) => [type, severity, category, actual]),
    [
      ['double-escaped-text', 'warning', 'seo', '&amp;'],
      ['double-escaped-text', 'warning', 'seo', '&lt;'],
      ['double-escaped-text', 'info', 'seo', '&lt;'],
      ['double-escaped-text', 'info', 'seo', '&amp;']
    ]
  )
  assert.equal(issues[0].message, 'Title shows &amp; as text (escaped twice)')
  // The context is the tag as written, where the extra escaping shows.
  assert.equal(issues[0].context, '<title>Hair &amp;amp; Beauty Shop</title>')
  assert.equal(issues[0].selector, 'html > head > title')
  assert.match(issues[0].source, /title-link/)
  assert.match(issues[1].source, /snippet/)
  assert.equal(issues[2].message, 'og:description shows &lt; as text (escaped twice)')
  assert.equal(issues[3].message, 'twitter:title shows &amp; as text (escaped twice)')
  assert.match(issues[3].source, /ogp\.me/)
})

test('double-escaped-text: text escaped once is fine', () => {
  const head =
    '<title>Hair &amp; Beauty &lt;3</title><meta name="description" content="Tips &amp; tricks &#8226; more">'
  assert.deepEqual(checkEscapedText(page(head)), [])
})

test('double-escaped-text: a long value is cut so the first escaped entity stays in the context', () => {
  const tail = 'Made with love &amp;lt;3 in Helsinki, with free delivery'
  const [issue] = checkEscapedText(page(`<meta name="description" content="${'Hair care. '.repeat(12)}${tail}">`))
  assert.equal(issue.message, 'Meta description shows &lt; as text (escaped twice)')
  const start = '<meta name="description" content="'
  const end = 'Made with love &amp;lt;3 in Helsinki, with ...'
  assert.equal(issue.context, `${start}...${'Hair care. '.repeat(12).slice(-(117 - start.length - end.length))}${end}`)
  assert.equal(Array.from(issue.context).length, 120)
})

test('double-escaped-text: the context ends with the tag when the entity is near its end', () => {
  const [issue] = checkEscapedText(page(`<title>${'Hair care '.repeat(12)}&amp;amp; more</title>`))
  assert.match(issue.context, /^<title>\.\.\.[^.].*&amp;amp; more<\/title>$/)
  assert.equal(Array.from(issue.context).length, 120)
})

test('double-escaped-text: a tag start too long to keep is cut too', () => {
  const html = `<meta data-theme="${'x'.repeat(70)}" name="description" content="${'Hair care. '.repeat(6)}&amp;lt;3">`
  const [issue] = checkEscapedText(page(html))
  assert.match(issue.context, /^\.\.\.[^.].*Hair care\. &amp;lt;3">$/)
  assert.equal(Array.from(issue.context).length, 120)
})

test('double-escaped-text: the entity is found in the text, not in an attribute before it', () => {
  const start = '<meta data-content="&amp;lt;" name="description" content="'
  const [issue] = checkEscapedText(page(`${start}${'Hair care. '.repeat(12)}&amp;lt;3 more">`))
  assert.ok(issue.context.startsWith(`${start}...`), issue.context)
  assert.ok(issue.context.endsWith('Hair care. &amp;lt;3 more">'), issue.context)
})

test('double-escaped-text: the first non-empty description is the one checked', () => {
  const head = '<meta name="description" content=" "><meta name="description" content="A &amp;nbsp;B">'
  const issues = checkEscapedText(page(head))
  assert.deepEqual(
    issues.map((issue) => issue.actual),
    ['&nbsp;']
  )
})

test('double-escaped-text: several entities in one field are one issue', () => {
  const issues = checkEscapedText(page('<title>Q&amp;amp;A &amp;#8211; &amp;quot;help&amp;quot;</title>'))
  assert.equal(issues.length, 1)
  assert.equal(issues[0].actual, '&amp;, &#8211;, &quot;')
})

test('double-escaped-text: part of the page checks', async () => {
  const types = checkHtml(await fixture('escaped.html')).map((issue) => issue.type)
  assert.equal(types.filter((type) => type === 'double-escaped-text').length, 4)
})

test('double-escaped-text: preview tags written with name= or property=, the first non-empty one checked', () => {
  const head =
    '<meta name="og:title" content=""><meta name="og:title" content="A &amp;amp; B">' +
    '<meta property="twitter:description" content="Tips &amp;#8226; more">'
  const issues = checkEscapedText(page(head))
  assert.deepEqual(
    issues.map((issue) => [issue.message, issue.severity]),
    [
      ['og:title shows &amp; as text (escaped twice)', 'info'],
      ['twitter:description shows &#8226; as text (escaped twice)', 'info']
    ]
  )
})
