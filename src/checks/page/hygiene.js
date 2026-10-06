import { SOURCES } from '../../sources.js'
import { charCount, collapseWhitespace } from '../../text.js'
import { seoIssue, snippet } from '../snippet.js'
import { absolute, baseUrl, wordCount } from './signals.js'

// Heuristic: Google gives no limit, but shorter URLs are easier to read and share.
const URL_MAX = 100
// Googlebot only reads the first 2 MB of an HTML file.
const HTML_MAX_BYTES = 2 * 1024 * 1024
// Fewer visible words than this on a page with an empty app root means the content is built in the browser.
const SHELL_MAX_WORDS = 20
const APP_ROOT = '#root, #app, #__next, #__nuxt, #svelte'
const MIXED_CONTENT = 'img, script[src], iframe[src], audio[src], video[src], source, link[rel~="stylesheet" i][href]'

// Percent escapes are case-insensitive hex, so a path that cannot be decoded is judged without them.
function safeDecode(text) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text.replaceAll(/%[0-9a-f]{2}/gi, '')
  }
}

const urlIssue = (type, source, message, context) => seoIssue({ type, severity: 'info', source, message, context })

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
    seoIssue({
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

// Browsers treat loopback addresses as secure, so http there is not mixed content.
const isLoopback = (value) => {
  try {
    const { hostname } = new URL(value)
    return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(hostname) || hostname.endsWith('.localhost')
  } catch {
    return false
  }
}

const isInsecure = (value) => value?.startsWith('http:') && !isLoopback(value)

function checkMixedContent($, url) {
  if (!url?.startsWith('https:')) return []
  const base = baseUrl($, url)
  return $(MIXED_CONTENT)
    .toArray()
    .filter((el) => loadedUrls($, el).some((value) => isInsecure(absolute(value, base))))
    .map((el) =>
      seoIssue({
        type: 'mixed-content',
        severity: 'warning',
        category: 'best-practice',
        source: SOURCES.mixedContent,
        message: `The https page loads <${el.tagName}> over insecure http, browsers block or rewrite it`,
        context: snippet($, el)
      })
    )
}

// Prerendered pages have a main area, an article or a form outside the app root. A shell, even with a static header, has none.
const hasContentElements = ($) =>
  $('body main, body article, body form')
    .toArray()
    .some((el) => !$(el).closest(APP_ROOT).length && !$(el).closest('noscript').length)

// pageaudit reads the raw HTML only, so a page built in the browser shows up as an empty shell.
function checkRenderedInBrowser($) {
  const root = $(APP_ROOT).first()
  const words = wordCount($)
  const emptyRoot = root.length > 0 && collapseWhitespace(root.text()) === '' && !hasContentElements($)
  const noscriptNeedsJs = /enable javascript|requires? javascript|javascript (is )?(required|disabled)/i.test(
    collapseWhitespace($('noscript').text())
  )
  // Without an app root, the message only counts on a page with no visible text at all.
  const needsJs = noscriptNeedsJs && (root.length > 0 || words === 0)
  if (words >= SHELL_MAX_WORDS || !(emptyRoot || needsJs)) return []
  return [
    seoIssue({
      type: 'client-side-rendered',
      severity: 'info',
      category: 'best-practice',
      source: SOURCES.javascriptSeo,
      message:
        'The page has almost no text in its HTML and looks built in the browser, so these results may be incomplete',
      context: emptyRoot
        ? `<${root.prop('tagName').toLowerCase()} id="${root.attr('id')}"></${root.prop('tagName').toLowerCase()}>`
        : '<noscript>'
    })
  ]
}

export function checkHygiene($, { url, html } = {}) {
  return [...checkUrl(url ?? ''), ...checkSize(html), ...checkMixedContent($, url), ...checkRenderedInBrowser($)]
}
