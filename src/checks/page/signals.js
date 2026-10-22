import { withoutFragment } from '../../input/resolve.js'
import { collapseWhitespace, limit, MAX_URL } from '../../text.js'
import { isBound } from './bindings.js'
import { headingExcerpts, imageSamples, mainText, visibleText } from './content.js'
import { jsonLdBlocks, jsonLdNodes, typesOf } from './json-ld.js'

const MAX_HEADINGS = 40
const MAX_TYPES = 20

export function absolute(href, base) {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

// Facebook's scraper also accepts name= instead of property=, and some themes write twitter:card as a property, so both count.
export const ogSelector = (name) => `meta[property="og:${name}" i], meta[name="og:${name}" i]`
export const twitterSelector = (name) => `meta[name="twitter:${name}" i], meta[property="twitter:${name}" i]`
export const TWITTER_CARD = twitterSelector('card')

const MAX_TEXT = 120

const clean = (text, max = MAX_TEXT) => limit(collapseWhitespace(text ?? ''), max) || null
// The first non-empty content, so an empty tag in front of a filled one does not hide it.
export const metaContent = ($, selector, max) =>
  $(selector)
    .toArray()
    .map((el) => clean($(el).attr('content'), max))
    .find(Boolean) ?? null

// Every robots and googlebot tag applies to Google, so the value is all of their directives, once each.
const robotsValue = ($) => {
  const directives = $('meta[name="robots" i], meta[name="googlebot" i]')
    .toArray()
    .flatMap((el) => ($(el).attr('content') ?? '').toLowerCase().split(','))
    .map((part) => collapseWhitespace(part))
    .filter(Boolean)
  return clean([...new Set(directives)].join(', '), MAX_URL)
}

// Relative addresses resolve against the first <base href>, like in a browser.
export function baseUrl($, pageUrl) {
  const href = ($('base[href]').first().attr('href') ?? '').trim()
  return (href && absolute(href, pageUrl)) || pageUrl
}

// Visible body text only: script, style and noscript content is not read by a visitor.
export function wordCount($) {
  const text = collapseWhitespace(visibleText($('body').get(0)))
  return text ? text.split(' ').length : 0
}

function headings($) {
  const excerpts = headingExcerpts($)
  return $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .slice(0, MAX_HEADINGS)
    .map((el) => ({
      level: Number(el.tagName[1]),
      text: clean(visibleText(el)) ?? '',
      excerpt: excerpts.get(el) ?? null
    }))
}

// Alternate-language links in <head>, the only place Google reads them.
export const hreflangLinks = ($) => $('head link[rel~="alternate" i][hreflang]').toArray()

// Every declared alternate, hrefs resolved like a browser would. An address that cannot be resolved stays as written.
// Kept whole so the site checks see every return link; the report caps the list.
function hreflang($, baseUrl) {
  return hreflangLinks($).map((el) => {
    const href = ($(el).attr('href') ?? '').trim()
    return { lang: ($(el).attr('hreflang') ?? '').trim(), href: absolute(href, baseUrl) ?? href }
  })
}

export const host = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, '')

const MAX_LINK_SAMPLES = 25

// Every link to another page, resolved against <base> and classified against the page's own site. Fragment-only links,
// mailto:, tel: and the like are not pages. The href is kept whole, a URL cut short would point somewhere else.
function resolvedLinks($, baseUrl, pageUrl) {
  const here = host(pageUrl)
  return $('a[href]')
    .toArray()
    .flatMap((el) => {
      const raw = ($(el).attr('href') ?? '').trim()
      const href = absolute(raw, baseUrl)
      if (!href || !/^https?:/.test(href) || raw.startsWith('#')) return []
      return [{ el, href, internal: host(href) === here }]
    })
}

// The links of a page as the facts describe them, with their text and whether they are nofollow.
const pageLinks = ($, baseUrl, pageUrl) =>
  resolvedLinks($, baseUrl, pageUrl).map(({ el, href, internal }) => ({
    href,
    text: clean(visibleText(el)) ?? clean($(el).find('img[alt]').first().attr('alt')) ?? '',
    internal,
    nofollow: /\bnofollow\b/i.test($(el).attr('rel') ?? '')
  }))

// The distinct internal link targets of a page, for the link checks. The fragment is dropped, it is not sent to the
// server. Two spellings of one page, such as /x and /x/, stay apart: one of them may redirect.
export function internalLinks($, pageUrl) {
  const targets = resolvedLinks($, baseUrl($, pageUrl), pageUrl)
    .filter((link) => link.internal)
    .map((link) => withoutFragment(link.href))
  return [...new Set(targets)]
}

function linkCounts(all) {
  const internal = all.filter((link) => link.internal).length
  return { internal, external: all.length - internal, nofollow: all.filter((link) => link.nofollow).length }
}

function images($) {
  const all = $('img').toArray()
  const missing = (el) => $(el).attr('alt') === undefined && !isBound(el, 'alt')
  return { total: all.length, missingAlt: all.filter(missing).length }
}

function openGraph($) {
  const og = (name, max) => metaContent($, ogSelector(name), max)
  return {
    title: og('title'),
    description: og('description'),
    image: og('image', MAX_URL),
    type: og('type'),
    url: og('url', MAX_URL)
  }
}

// Invalid JSON-LD is ignored here, the structured data check reports it.
function jsonLdTypes($) {
  const types = jsonLdBlocks($).flatMap((block) => ('error' in block ? [] : jsonLdNodes(block.value).flatMap(typesOf)))
  return [...new Set(types)].slice(0, MAX_TYPES)
}

// Elements whose text Google may not use in a snippet. Google reads the attribute on span, div and section only.
const nosnippetElements = ($) => $('span[data-nosnippet], div[data-nosnippet], section[data-nosnippet]').length

// Content and metadata signals about one page, kept small enough to hand to a model. `robotsHeader` is the
// X-Robots-Tag value or null.
export function extractSignals($, baseUrl, pageUrl, robotsHeader = null) {
  const pageLinkList = pageLinks($, baseUrl, pageUrl)
  return {
    lang: clean($('html').attr('lang')),
    viewport: metaContent($, 'meta[name="viewport" i]'),
    robots: robotsValue($),
    robotsHeader: robotsHeader && clean(robotsHeader, MAX_URL),
    nosnippetElements: nosnippetElements($),
    headings: headings($),
    wordCount: wordCount($),
    mainText: mainText($),
    links: linkCounts(pageLinkList),
    linkSamples: pageLinkList.slice(0, MAX_LINK_SAMPLES).map((link) => ({ ...link, href: limit(link.href, MAX_URL) })),
    images: images($),
    imageSamples: imageSamples($, baseUrl),
    openGraph: openGraph($),
    twitterCard: metaContent($, TWITTER_CARD),
    jsonLdTypes: jsonLdTypes($),
    hreflang: hreflang($, baseUrl)
  }
}
