import { SOURCES } from '../../sources.js'
import { charCount, collapseWhitespace } from '../../text.js'
import { snippet, truncate } from '../snippet.js'
import { absolute, wordCount } from './signals.js'

// Heuristic: Google gives no limit, but shorter URLs are easier to read and share.
const URL_MAX = 100
// Googlebot only reads the first 2 MB of an HTML file.
const HTML_MAX_BYTES = 2 * 1024 * 1024
// Fewer visible words than this on a page with an empty app root means the content is built in the browser.
const SHELL_MAX_WORDS = 20
const APP_ROOT = '#root, #app, #__next, #__nuxt, #svelte'
const MIXED_CONTENT = 'img, script[src], iframe[src], audio[src], video[src], source, link[rel~="stylesheet" i][href]'

const issue = (fields) => ({ category: 'seo', ...fields, context: truncate(fields.context) })

// Percent escapes are case-insensitive hex, so a path that cannot be decoded is judged without them.
function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text.replaceAll(/%[0-9a-f]{0,2}/gi, '')
  }
}

const urlIssue = (type, source, message, context) => issue({ type, severity: 'info', source, message, context })

function checkUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  const path = safeDecode(parsed.pathname)
  // Measured the way people see it: browsers show non-ASCII characters decoded, not as %XX.
  const shown = `${parsed.origin}${path}${safeDecode(parsed.search)}`
  const issues = []
  if (charCount(shown) > URL_MAX) {
    const message = `URL is ${charCount(shown)} characters (over ~${URL_MAX}), shorter addresses are easier to read and share`
    issues.push(urlIssue('long-url', SOURCES.urlStructure, message, shown))
  }
  if (path.includes('_')) {
    const message = 'URL path uses underscores, Google recommends hyphens to separate words'
    issues.push(urlIssue('url-underscores', SOURCES.urlStructure, message, parsed.pathname))
  }
  if (path !== path.toLowerCase()) {
    const message = 'URL path has uppercase letters, Google treats /APPLE and /apple as different pages'
    issues.push(urlIssue('url-uppercase', SOURCES.urlStructure, message, parsed.pathname))
  }
  return issues
}

// The decoded text is measured as UTF-8, which is exact for UTF-8 pages and close for other encodings.
function checkSize(html) {
  const bytes = Buffer.byteLength(html ?? '')
  if (bytes <= HTML_MAX_BYTES) return []
  return [
    issue({
      type: 'html-too-large',
      severity: 'warning',
      source: SOURCES.googlebot,
      message: `HTML is ${(bytes / 1024 / 1024).toFixed(1)} MB, Googlebot only reads the first 2 MB so anything after that is not indexed`,
      context: `${bytes} bytes`
    })
  ]
}

// Every address an element loads, including each candidate in srcset.
function loadedUrls($, el) {
  const srcset = ($(el).attr('srcset') ?? '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0])
  return [$(el).attr('src'), $(el).attr('href'), ...srcset].map((value) => (value ?? '').trim()).filter(Boolean)
}

function checkMixedContent($, url) {
  if (!url?.startsWith('https:')) return []
  // Relative addresses resolve against <base href>, like in a browser.
  const base = absolute(($('base[href]').first().attr('href') ?? '').trim(), url) ?? url
  return $(MIXED_CONTENT)
    .toArray()
    .filter((el) => loadedUrls($, el).some((value) => absolute(value, base)?.startsWith('http:')))
    .map((el) =>
      issue({
        type: 'mixed-content',
        severity: 'warning',
        category: 'best-practice',
        source: SOURCES.mixedContent,
        message: `The https page loads <${el.tagName}> over insecure http, browsers block or rewrite it`,
        context: snippet($, el)
      })
    )
}

// Prerendered pages have headings, a main area or a form next to an app root, a shell has none of them.
const hasContentElements = ($) => {
  const body = $('body').first().clone()
  body.find('script, style, noscript').remove()
  return body.find('h1, h2, h3, main, article, form').length > 0
}

// pageaudit reads the raw HTML only, so a page built in the browser shows up as an empty shell.
function checkRenderedInBrowser($) {
  const root = $(APP_ROOT).first()
  const emptyRoot = root.length > 0 && collapseWhitespace(root.text()) === '' && !hasContentElements($)
  const needsJs = /enable javascript|requires? javascript|javascript (is )?(required|disabled)/i.test(
    collapseWhitespace($('noscript').text())
  )
  if (wordCount($) >= SHELL_MAX_WORDS || !(emptyRoot || needsJs)) return []
  return [
    issue({
      type: 'client-side-rendered',
      severity: 'info',
      category: 'best-practice',
      source: SOURCES.javascriptSeo,
      message:
        'The page has almost no text in its HTML and looks built in the browser, so these results may be incomplete',
      context: emptyRoot ? `<div id="${root.attr('id')}"></div>` : '<noscript>'
    })
  ]
}

export function checkHygiene($, { url, html } = {}) {
  return [...checkUrl(url ?? ''), ...checkSize(html), ...checkMixedContent($, url), ...checkRenderedInBrowser($)]
}
