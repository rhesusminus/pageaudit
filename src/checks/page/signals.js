import { collapseWhitespace, limit } from '../../text.js'
import { headingExcerpts, imageSamples, mainText } from './content.js'

const MAX_HEADINGS = 40
const MAX_TYPES = 20
const MAX_JSON_LD_DEPTH = 4

export function absolute(href, base) {
  try {
    return new URL(href, base).href
  } catch {
    return null
  }
}

// Facebook's scraper also accepts name= instead of property=, and some themes write twitter:card as a property, so both count.
export const ogSelector = (name) => `meta[property="og:${name}" i], meta[name="og:${name}" i]`
export const TWITTER_CARD = 'meta[name="twitter:card" i], meta[property="twitter:card" i]'

const MAX_TEXT = 120
// URLs get a much higher cap: a URL cut short is not a URL any more.
const MAX_URL = 2000

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
  const body = $('body').first().clone()
  body.find('script, style, noscript').remove()
  const text = collapseWhitespace(body.text())
  return text ? text.split(' ').length : 0
}

function headings($) {
  const excerpts = headingExcerpts($)
  return $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .slice(0, MAX_HEADINGS)
    .map((el) => ({ level: Number(el.tagName[1]), text: clean($(el).text()) ?? '', excerpt: excerpts.get(el) ?? null }))
}

export const host = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, '')

const MAX_LINK_SAMPLES = 25

// Every link to another page, resolved against <base> and classified against the page's own site. Fragment-only links, mailto:, tel: and the like are not pages.
function pageLinks($, baseUrl, pageUrl) {
  const here = host(pageUrl)
  return $('a[href]')
    .toArray()
    .flatMap((el) => {
      const raw = ($(el).attr('href') ?? '').trim()
      const href = absolute(raw, baseUrl)
      if (!href || !/^https?:/.test(href) || raw.startsWith('#')) return []
      const text = clean($(el).text() || $(el).find('img[alt]').first().attr('alt')) ?? ''
      return [
        {
          href: limit(href, MAX_URL),
          text,
          internal: host(href) === here,
          nofollow: /\bnofollow\b/i.test($(el).attr('rel') ?? '')
        }
      ]
    })
}

function linkCounts(all) {
  const internal = all.filter((link) => link.internal).length
  return { internal, external: all.length - internal, nofollow: all.filter((link) => link.nofollow).length }
}

function images($) {
  const all = $('img').toArray()
  return { total: all.length, missingAlt: all.filter((el) => $(el).attr('alt') === undefined).length }
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

export const typesOf = (node) => [node['@type']].flat().filter((type) => typeof type === 'string')

// Every object with a usable @type in a JSON-LD value, looking inside arrays and @graph.
export function jsonLdNodes(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > MAX_JSON_LD_DEPTH) return []
  if (Array.isArray(value)) return value.flatMap((item) => jsonLdNodes(item, depth + 1))
  const own = typesOf(value).length > 0 ? [value] : []
  return [...own, ...jsonLdNodes(value['@graph'], depth + 1)]
}

// Every JSON-LD script as { value } when it parses or { error, text } when it does not.
export function jsonLdBlocks($) {
  return $('script[type="application/ld+json" i]')
    .toArray()
    .map((el) => {
      const text = $(el).text()
      try {
        return { value: JSON.parse(text), text }
      } catch (err) {
        return { error: err.message, text }
      }
    })
}

// Invalid JSON-LD is ignored here, the structured data check reports it.
function jsonLdTypes($) {
  const types = jsonLdBlocks($).flatMap((block) => ('error' in block ? [] : jsonLdNodes(block.value).flatMap(typesOf)))
  return [...new Set(types)].slice(0, MAX_TYPES)
}

// Content and metadata signals about one page, kept small enough to hand to a model.
export function extractSignals($, baseUrl, pageUrl) {
  const pageLinkList = pageLinks($, baseUrl, pageUrl)
  return {
    lang: clean($('html').attr('lang')),
    viewport: metaContent($, 'meta[name="viewport" i]'),
    robots: robotsValue($),
    headings: headings($),
    wordCount: wordCount($),
    mainText: mainText($),
    links: linkCounts(pageLinkList),
    linkSamples: pageLinkList.slice(0, MAX_LINK_SAMPLES),
    images: images($),
    imageSamples: imageSamples($, baseUrl),
    openGraph: openGraph($),
    twitterCard: metaContent($, TWITTER_CARD),
    jsonLdTypes: jsonLdTypes($)
  }
}
