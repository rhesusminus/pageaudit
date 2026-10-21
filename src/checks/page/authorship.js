import { MAX_URL } from '../../text.js'
import { idIndex, nameOf, pageObjects, text, textValue, typesOf } from './json-ld.js'
import { metaContent } from './signals.js'

const MAX_NODES = 10
const MAX_NAMES = 5
const MAX_SAME_AS = 5
const MAX_TEXT = 120
const MAX_DATE = 60

// The names behind an author or publisher, see nameOf(). Yoast and most CMSs write them as { @id } references.
function names(value, byId) {
  const list = [value]
    .flat()
    .map((item) => nameOf(item, byId))
    .filter(Boolean)
  return [...new Set(list)].slice(0, MAX_NAMES)
}

const sameAs = (value) =>
  [value]
    .flat()
    .map((url) => text(url, MAX_URL))
    .filter(Boolean)
    .slice(0, MAX_SAME_AS)

// Per typed node: its types, name or headline, authors, publisher, dates and sameAs profiles. References are looked
// up among all objects with an @id, typed or not.
function summarise(objects) {
  const byId = idIndex(objects)
  return objects
    .filter((node) => typesOf(node).length > 0)
    .map((node) => ({
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
function pageDates($, nodes, lastModified) {
  const fromJsonLd = (key) => nodes.find((node) => node[key])?.[key] ?? null
  return {
    published: fromJsonLd('datePublished') ?? metaProperty($, 'article:published_time'),
    modified:
      fromJsonLd('dateModified') ?? metaProperty($, 'article:modified_time') ?? metaProperty($, 'og:updated_time'),
    lastModified: text(lastModified ?? null, MAX_DATE)
  }
}

// Who the page names as its author: the author meta tag, else the authors of the first JSON-LD node that has any.
const pageAuthor = ($, nodes) =>
  metaContent($, 'meta[name="author" i]', MAX_TEXT) ??
  nodes.find((node) => node.authors.length)?.authors.join(', ') ??
  null

// What the page says about who made it and when. `jsonLd` keeps at most MAX_NODES nodes, so a long product list stays
// small, but the dates and author are looked for in every node.
export function pageAuthorship($, lastModified = null) {
  const nodes = summarise(pageObjects($))
  return {
    jsonLd: nodes.slice(0, MAX_NODES),
    dates: pageDates($, nodes, lastModified),
    author: pageAuthor($, nodes)
  }
}
