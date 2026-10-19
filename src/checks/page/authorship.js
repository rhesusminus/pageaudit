import { collapseWhitespace, limit, MAX_URL } from '../../text.js'
import { jsonLdBlocks, jsonLdNodes, metaContent, typesOf } from './signals.js'

const MAX_NODES = 10
const MAX_NAMES = 5
const MAX_SAME_AS = 5
const MAX_TEXT = 120
const MAX_DATE = 60

const text = (value, max = MAX_TEXT) => {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  return limit(collapseWhitespace(value), max) || null
}

// A JSON-LD text value: a string, a number, an { @value } object, or a list whose first usable entry counts.
function textValue(value, max) {
  const first = Array.isArray(value) ? value.find((item) => textValue(item, max) !== null) : value
  if (first && typeof first === 'object' && !Array.isArray(first)) return text(first['@value'], max)
  return text(first, max)
}

// Every typed node of every valid JSON-LD block on the page, in order. Invalid JSON-LD is ignored here, the structured
// data check reports it.
const pageNodes = ($) => jsonLdBlocks($).flatMap((block) => ('error' in block ? [] : jsonLdNodes(block.value)))

// The names behind an author or publisher: a plain name, an object with a name, or a { @id } reference to another
// node of the page, which is how Yoast and most CMSs write them. A reference is followed one step, so a loop of
// references cannot hang the audit.
function names(value, byId) {
  const name = (item) => {
    if (typeof item === 'string') return text(item)
    if (!item || typeof item !== 'object') return null
    return textValue(item.name) ?? (typeof item['@id'] === 'string' ? textValue(byId.get(item['@id'])?.name) : null)
  }
  const list = [value].flat().map(name).filter(Boolean)
  return [...new Set(list)].slice(0, MAX_NAMES)
}

const sameAs = (value) =>
  [value]
    .flat()
    .map((url) => text(url, MAX_URL))
    .filter(Boolean)
    .slice(0, MAX_SAME_AS)

// What the structured data says about who made the page and when: per typed node, its types, name or headline,
// authors, publisher, dates and sameAs profiles. At most MAX_NODES nodes, so a long product list stays small.
export function jsonLdSummary($) {
  const nodes = pageNodes($)
  const byId = new Map(nodes.filter((node) => typeof node['@id'] === 'string').map((node) => [node['@id'], node]))
  return nodes.slice(0, MAX_NODES).map((node) => ({
    types: typesOf(node),
    name: textValue(node.headline) ?? textValue(node.name),
    authors: names(node.author, byId),
    publisher: names(node.publisher, byId)[0] ?? null,
    datePublished: textValue(node.datePublished, MAX_DATE),
    dateModified: textValue(node.dateModified, MAX_DATE),
    sameAs: sameAs(node.sameAs)
  }))
}

const metaProperty = ($, property) =>
  metaContent($, `meta[property="${property}" i], meta[name="${property}" i]`, MAX_DATE)

// When the page says it was published and last changed: the first JSON-LD node that gives the date, else the Open
// Graph article tags. `lastModified` is the Last-Modified header, which on a page built for every request is often
// just the time it was sent.
export function pageDates($, summary, lastModified) {
  const fromJsonLd = (key) => summary.find((node) => node[key])?.[key] ?? null
  return {
    published: fromJsonLd('datePublished') ?? metaProperty($, 'article:published_time'),
    modified:
      fromJsonLd('dateModified') ?? metaProperty($, 'article:modified_time') ?? metaProperty($, 'og:updated_time'),
    lastModified: text(lastModified ?? null, MAX_DATE)
  }
}

// Who the page names as its author: the author meta tag, else the authors of the first JSON-LD node that has any.
export function pageAuthor($, summary) {
  return (
    metaContent($, 'meta[name="author" i]', MAX_TEXT) ??
    summary.find((node) => node.authors.length)?.authors.join(', ') ??
    null
  )
}
