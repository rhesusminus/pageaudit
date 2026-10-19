import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageMarkdown } from '../src/markdown.js'
import { parse } from '../src/parse.js'

const URL = 'https://a.test/dir/page'

// The Markdown after the front matter.
const body = (html, url = URL) =>
  pageMarkdown(parse(html), { url, finalUrl: url, title: 'T' })
    .replace(/^---\n[\s\S]*?\n---\n\n/, '')
    .trimEnd()

test('markdown: front matter names the page and the area read, strings quoted as JSON', () => {
  const md = pageMarkdown(parse('<main><p>Hi</p></main>'), {
    url: 'https://a.test/x',
    finalUrl: 'https://a.test/y',
    title: 'A: "quoted" title',
    truncated: true
  })
  assert.equal(
    md,
    '---\ngenerator: "pageaudit"\nurl: "https://a.test/x"\nfinalUrl: "https://a.test/y"\ntitle: "A: \\"quoted\\" title"\narea: "main"\ntruncated: true\n---\n\nHi\n'
  )
  const plain = pageMarkdown(parse('<p>Hi</p>'), { url: URL, finalUrl: URL, title: null })
  assert.match(plain, /area: "body"\n---/)
  assert.doesNotMatch(plain, /title:|truncated:/)
})

test('markdown: the main area keeps its callouts, the body fallback drops navigation and footers', () => {
  const page =
    '<body><nav>Menu</nav><main><h1>Title</h1><aside class="note"><b>Note:</b> Key point.</aside><p>Text</p></main><footer>Legal</footer></body>'
  assert.equal(body(page), '# Title\n\n**Note:** Key point.\n\nText')
  const noMain =
    '<body><header>Brand</header><nav>Menu</nav><div><h2>Sub</h2><p>Text</p></div><aside>Ad</aside><footer>Legal</footer></body>'
  assert.equal(body(noMain), '## Sub\n\nText')
})

test('markdown: text between blocks forms paragraphs, scripts and styles are left out', () => {
  assert.equal(
    body('<div>Loose <span>text</span><div>Inner block</div>after<script>x()</script><style>p{}</style></div>'),
    'Loose text\n\nInner block\n\nafter'
  )
})

test('markdown: inline formatting keeps the spaces outside its markers', () => {
  assert.equal(
    body('<p>A<strong> bold </strong>and <em>em</em> and <code>a`b</code>, <b></b>empty</p>'),
    'A **bold** and *em* and ``a`b``, empty'
  )
})

test('markdown: links resolve against <base>, others keep only their text', () => {
  const html =
    '<head><base href="https://b.test/base/"></head><body><p><a href="x(1)">Rel</a> <a href="#top">Top</a> <a href="mailto:a@b.test">Mail</a> <a href="https://c.test/"> Abs </a></p></body>'
  assert.equal(body(html), '[Rel](https://b.test/base/x%281%29) Top Mail [Abs](https://c.test/)')
})

test('markdown: images keep their alt text, and one with no alt attribute says so', () => {
  assert.equal(
    body('<p><img src="/a.png" alt="A [cat]"> <img src="b.png"> <img src="c.png" alt=""> <img alt="No src"></p>'),
    '![A \\[cat\\]](https://a.test/a.png) ![](https://a.test/dir/b.png "no alt attribute") ![](https://a.test/dir/c.png) No src'
  )
  assert.match(
    body(`<p><img src="data:image/png;base64,${'A'.repeat(500)}" alt="x"></p>`),
    /^!\[x\]\(data:.{1,57}\.\.\.\)$/
  )
})

test('markdown: lists nest, ordered lists keep their start, and a paragraph in an item is indented', () => {
  const html =
    '<ul><li>One<ul><li>Nested</li></ul></li><li><p>Two</p><p>More</p></li><li></li></ul><ol start="3"><li>Three</li><li>Four</li></ol>'
  assert.equal(body(html), '- One\n  - Nested\n- Two\n  More\n-\n\n3. Three\n4. Four')
})

test('markdown: a data table becomes a pipe table, with uneven rows and one-line cells', () => {
  const html =
    '<table><thead><tr><th>Name</th><th>A|B</th></tr></thead><tbody><tr><td>x<br>y</td></tr><tr><td><p>one</p></td><td><ul><li>a</li><li>b</li></ul></td></tr></tbody></table>'
  assert.equal(body(html), '| Name | A\\|B |\n| --- | --- |\n| x y |  |\n| one | a b |')
})

test('markdown: a layout table is read cell by cell, so an article laid out in one does not run together', () => {
  const nested = '<table><tr><td>Menu</td><td><table><tr><td>Inner</td></tr></table></td></tr></table>'
  assert.equal(body(nested), 'Menu\n\nInner')
  const article =
    '<table><tr><td><font size="2">First paragraph.<br><br>Second, with a<br>break.</font></td></tr></table>'
  assert.equal(body(article), 'First paragraph.\n\nSecond, with a\nbreak.')
  const headed = '<table><tr><td><h2>Title</h2></td></tr></table>'
  assert.equal(body(headed), '## Title')
  assert.equal(body('<table role="presentation"><tr><td>A</td><td>B</td></tr></table>'), 'A\n\nB')
})

test('markdown: a caption comes before its table, and spanning cells fill every place they cover', () => {
  const html =
    '<table><caption>Prices exclude tax.</caption><tr><th>Plan</th><th>Monthly</th><th>Yearly</th></tr><tr><td>Basic</td><td colspan="2">Free</td></tr><tr><td rowspan="2">Pro</td><td>10</td><td>100</td></tr><tr><td>12</td><td>120</td></tr></table>'
  assert.equal(
    body(html),
    [
      '*Prices exclude tax.*',
      '',
      '| Plan | Monthly | Yearly |',
      '| --- | --- | --- |',
      '| Basic | Free | Free |',
      '| Pro | 10 | 100 |',
      '| Pro | 12 | 120 |'
    ].join('\n')
  )
  assert.equal(body('<table role="presentation"><caption>Layout</caption><tr><td>A</td></tr></table>'), '*Layout*\n\nA')
})

test('markdown: a table far larger than its cells is read cell by cell instead of growing with its square', () => {
  const wide = `<tr>${'<td>x</td>'.repeat(200)}</tr>`
  const html = `<table>${wide}${'<tr><td>y</td></tr>'.repeat(200)}</table>`
  const md = body(html)
  assert.ok(md.length < 3000, `${md.length} characters`)
  assert.equal(
    body('<table><tr><td colspan="1000" rowspan="0">big</td><td>b</td></tr><tr><td>c</td></tr></table>'),
    'big\n\nb\n\nc'
  )
})

test('markdown: a spanning cell covers the empty rows below it, but not the rows of the next group', () => {
  const html =
    '<table><thead><tr><th rowspan="3">H</th><th>A</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody><tbody><tr><td rowspan="2">s</td><td>1</td></tr><tr></tr><tr><td>2</td><td>3</td></tr></tbody></table>'
  assert.equal(body(html), ['| H | A |', '| --- | --- |', '| x | y |', '| s | 1 |', '| s |  |', '| 2 | 3 |'].join('\n'))
})

test('markdown: a long cell spanning many columns is read once instead of repeated', () => {
  const html = `<table><tr><td colspan="1000">${'w'.repeat(1000)}</td></tr><tr><td>a</td><td>b</td></tr></table>`
  assert.equal(body(html), `${'w'.repeat(1000)}\n\na\n\nb`)
})

test('markdown: preformatted code is fenced with its language, longer than any fence inside', () => {
  assert.equal(
    body('<pre class="language-js"><code>const a = 1\n\n  return a\n</code></pre>'),
    '```js\nconst a = 1\n\n  return a\n```'
  )
  assert.equal(body('<pre><code class="lang-md">```\nx\n```</code></pre>'), '````md\n```\nx\n```\n````')
})

test('markdown: quotes, rules, captions, terms and summaries', () => {
  const html =
    '<blockquote><p>Said</p><p>Twice</p></blockquote><hr><figure><img src="a.png" alt="A"><figcaption>Caption</figcaption></figure><dl><dt>Term</dt><dd>Meaning</dd></dl><details><summary>More</summary><p>Hidden</p></details>'
  assert.equal(
    body(html),
    '> Said\n>\n> Twice\n\n---\n\n![A](https://a.test/dir/a.png)\n\n*Caption*\n\n**Term**\n\nMeaning\n\n**More**\n\nHidden'
  )
})

test('markdown: text that would start a heading, list or quote is escaped, line breaks are kept', () => {
  assert.equal(
    body('<p># not a heading</p><p>- not a list<br>2. nor this<br>> nor this</p>'),
    ['\\# not a heading', '', '\\- not a list\n2\\. nor this\n\\> nor this'].join('\n')
  )
})

test('markdown: page text that Markdown would read as markup is escaped, code is not', () => {
  assert.equal(
    body(
      '<p>Fields marked *required*, a [note], &lt;b&gt;bold&lt;/b&gt;, C:\\dir, `tick`, _under_ but snake_case. <code>a*b</code></p>'
    ),
    'Fields marked \\*required\\*, a \\[note\\], \\<b>bold\\</b>, C:\\\\dir, \\`tick\\`, \\_under\\_ but snake_case. `a*b`'
  )
  assert.equal(body('<p><a href="/x">An [unfinished label</a></p>'), '[An \\[unfinished label](https://a.test/x)')
})

test('markdown: entities written as text and alt text are escaped like the rest of the page text', () => {
  assert.equal(body('<p>&amp;copy; &amp;#169; AT&amp;T</p>'), '\\&copy; \\&#169; AT&T')
  assert.equal(body('<p><img alt="*literal* &lt;b&gt;"></p>'), '\\*literal\\* \\<b>')
  assert.equal(body('<p><img src="a.png" alt="[x] *y*"></p>'), '![\\[x\\] \\*y\\*](https://a.test/dir/a.png)')
})

test('markdown: an element named like an Object method is walked into like any unknown element', () => {
  assert.equal(
    body('<main><p>Before</p><constructor>Content</constructor><toString>More</toString><p>After</p></main>'),
    'Before\n\nContent\n\nMore\n\nAfter'
  )
})

test('markdown: a page nested deeper than Chrome parses is converted without running out of stack', () => {
  const depth = 10000
  const md = body(`<main>${'<div>'.repeat(depth)}deep${'</div>'.repeat(depth)}</main>`)
  assert.equal(md, 'deep')
})
