import { SOURCES } from '../../sources.js'
import { collapseWhitespace } from '../../text.js'
import { truncate } from '../snippet.js'

// Heuristic: Google gives no limit, but shorter URLs are easier to read and share.
const URL_MAX = 100
// Googlebot only reads the first 2 MB of an HTML file.
const HTML_MAX_BYTES = 2 * 1024 * 1024
// Fewer visible words than this on a page with an empty app root means the content is built in the browser.
const SHELL_MAX_WORDS = 20
const APP_ROOT = '#root, #app, #__next, #__nuxt, #svelte'
const MIXED_CONTENT =
  'img[src], script[src], iframe[src], audio[src], video[src], source[src], link[rel~="stylesheet" i][href]'

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
  const issues = []
  if (url.length > URL_MAX) {
    const message = `URL is ${url.length} characters (over ~${URL_MAX}), shorter addresses are easier to read and share`
    issues.push(urlIssue('long-url', SOURCES.urlStructure, message, url))
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

function checkMixedContent($, url) {
  if (!url?.startsWith('https:')) return []
  return $(MIXED_CONTENT)
    .toArray()
    .filter((el) => /^http:\/\//i.test(($(el).attr('src') ?? $(el).attr('href') ?? '').trim()))
    .map((el) =>
      issue({
        type: 'mixed-content',
        severity: 'warning',
        category: 'best-practice',
        source: SOURCES.mixedContent,
        message: `The https page loads <${el.tagName}> over insecure http, browsers block or rewrite it`,
        context: truncate(collapseWhitespace($.html(el)))
      })
    )
}

// pageaudit reads the raw HTML only, so a page built in the browser shows up as an empty shell.
function checkRenderedInBrowser($) {
  const body = $('body').first().clone()
  body.find('script, style, noscript').remove()
  const words = collapseWhitespace(body.text()).split(' ').filter(Boolean).length
  const root = $(APP_ROOT).first()
  const emptyRoot = root.length > 0 && collapseWhitespace(root.text()) === ''
  const needsJs = /enable javascript|requires? javascript|javascript (is )?(required|disabled)/i.test(
    collapseWhitespace($('noscript').text())
  )
  if (words >= SHELL_MAX_WORDS || !(emptyRoot || needsJs)) return []
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
