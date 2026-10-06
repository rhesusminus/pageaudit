import { collapseWhitespace, limit } from '../../text.js'

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
export const metaContent = ($, selector, max) => clean($(selector).first().attr('content'), max)

// Visible body text only: script, style and noscript content is not read by a visitor.
export function wordCount($) {
  const body = $('body').first().clone()
  body.find('script, style, noscript').remove()
  const text = collapseWhitespace(body.text())
  return text ? text.split(' ').length : 0
}

function headings($) {
  return $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .slice(0, MAX_HEADINGS)
    .map((el) => ({ level: Number(el.tagName[1]), text: clean($(el).text()) ?? '' }))
}

const host = (url) => new URL(url).hostname.toLowerCase().replace(/^www\./, '')

// Counts links to other pages, resolved against <base> but classified against the page's own site. Fragment-only links, mailto:, tel: and the like are not pages.
function links($, baseUrl, pageUrl) {
  const counts = { internal: 0, external: 0, nofollow: 0 }
  const here = host(pageUrl)
  for (const el of $('a[href]').toArray()) {
    const href = absolute(($(el).attr('href') ?? '').trim(), baseUrl)
    if (!href || !/^https?:/.test(href) || /^#/.test($(el).attr('href').trim())) continue
    counts[host(href) === here ? 'internal' : 'external']++
    if (/\bnofollow\b/i.test($(el).attr('rel') ?? '')) counts.nofollow++
  }
  return counts
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
  return {
    lang: clean($('html').attr('lang')),
    viewport: metaContent($, 'meta[name="viewport" i]'),
    robots: metaContent($, 'meta[name="robots" i]'),
    headings: headings($),
    wordCount: wordCount($),
    links: links($, baseUrl, pageUrl),
    images: images($),
    openGraph: openGraph($),
    twitterCard: metaContent($, TWITTER_CARD),
    jsonLdTypes: jsonLdTypes($)
  }
}
