import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../src/parse.js'
import { checkSnippetControls } from '../src/checks/page/snippets.js'
import { extractFacts } from '../src/checks/page/index.js'

const meta = (name, content) => `<head><meta name="${name}" content="${content}"></head><body><p>x</p></body>`
const check = (html, header = null) =>
  checkSnippetControls(parse(html), header).map(({ type, severity, message, context, selector }) => ({
    type,
    severity,
    message,
    context,
    ...(selector ? { selector } : {})
  }))

test('snippets: nosnippet keeps the text out of AI Overviews, with the meta tag as evidence', () => {
  assert.deepEqual(check(meta('robots', 'nosnippet')), [
    {
      type: 'snippet-restricted',
      severity: 'warning',
      message:
        'The page tells Google not to show a snippet (nosnippet), so its text is also kept out of AI Overviews and AI Mode',
      context: '<meta name="robots" content="nosnippet">',
      selector: 'html > head > meta'
    }
  ])
})

test('snippets: max-snippet:0 in the header is the same as nosnippet', () => {
  const [issue] = check('<p>x</p>', 'max-snippet:0')
  assert.equal(issue.severity, 'warning')
  assert.match(issue.message, /\(max-snippet:0\)/)
  assert.equal(issue.context, 'X-Robots-Tag: max-snippet:0')
})

test('snippets: a positive max-snippet is an info, the tightest one across tags and header wins', () => {
  assert.deepEqual(check(meta('googlebot', 'max-snippet:50'), 'max-snippet: 20'), [
    {
      type: 'snippet-restricted',
      severity: 'info',
      message:
        "The page limits Google's snippets to 20 characters (max-snippet: 20), which also limits how much of it AI Overviews and AI Mode can use",
      context: 'X-Robots-Tag: max-snippet: 20'
    }
  ])
})

test('snippets: nosnippet wins over a max-snippet limit, as the more restrictive rule', () => {
  const issues = check(meta('robots', 'max-snippet:50'), 'nosnippet')
  assert.deepEqual(
    issues.map(({ severity, context }) => [severity, context]),
    [['warning', 'X-Robots-Tag: nosnippet']]
  )
})

test('snippets: no limit, other crawlers and pages that are not indexed give no issue', () => {
  assert.deepEqual(check(meta('robots', 'max-snippet:-1, max-image-preview:large')), [])
  assert.deepEqual(check(meta('robots', 'max-snippet:abc')), [])
  assert.deepEqual(check('<p>x</p>', 'bingbot: nosnippet'), [])
  assert.deepEqual(check(meta('googlebot-news', 'nosnippet')), [])
  assert.deepEqual(check(meta('robots', 'noindex, nosnippet, noarchive')), [])
  assert.deepEqual(check(meta('robots', 'nosnippet'), 'noindex'), [])
  assert.deepEqual(check('<p>x</p>'), [])
})

test('snippets: noarchive keeps the page out of Copilot answers, nocache limits them, both count as nocache', () => {
  assert.deepEqual(check(meta('robots', 'noarchive')), [
    {
      type: 'copilot-restricted',
      severity: 'warning',
      message: 'The page tells Bing not to use it in Copilot answers (noarchive)',
      context: '<meta name="robots" content="noarchive">',
      selector: 'html > head > meta'
    }
  ])
  const [nocache] = check(meta('bingbot', 'nocache'))
  assert.deepEqual(
    [nocache.severity, nocache.message],
    ['info', 'The page tells Bing to show only its title, address and snippet in Copilot answers (nocache)']
  )
  const both = check(meta('robots', 'noarchive'), 'bingbot: nocache')
  assert.deepEqual(
    both.map(({ severity, context }) => [severity, context]),
    [['info', 'X-Robots-Tag: bingbot: nocache']]
  )
})

test('snippets: Bing reads robots and bingbot rules, not googlebot ones', () => {
  assert.deepEqual(check(meta('googlebot', 'noarchive')), [])
  assert.deepEqual(check('<p>x</p>', 'googlebot: noarchive'), [])
  assert.deepEqual(
    check('<p>x</p>', 'bingbot: noarchive').map(({ type, severity }) => [type, severity]),
    [['copilot-restricted', 'warning']]
  )
})

test('facts: the X-Robots-Tag header and the elements Google may not quote', () => {
  const $ = parse(
    '<body><div data-nosnippet>a</div><span data-nosnippet>b</span><section data-nosnippet>c</section><p data-nosnippet>d</p></body>'
  )
  const facts = extractFacts($, 'https://a.test/', { robotsHeader: 'googlebot: nosnippet' })
  assert.equal(facts.robotsHeader, 'googlebot: nosnippet')
  assert.equal(facts.nosnippetElements, 3)
  assert.equal(extractFacts($, 'https://a.test/').robotsHeader, null)
})
