import { collapseWhitespace, limit } from '../../text.js'

const MAX_DEPTH = 4
const MAX_TEXT = 120

export const typesOf = (node) => [node['@type']].flat().filter((type) => typeof type === 'string')

// Every object in a JSON-LD value, looking inside arrays and @graph. A node need not have a @type, an author that
// another node refers to by @id often has only a name.
export function jsonLdObjects(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > MAX_DEPTH) return []
  if (Array.isArray(value)) return value.flatMap((item) => jsonLdObjects(item, depth + 1))
  return [value, ...jsonLdObjects(value['@graph'], depth + 1)]
}

// Every object with a usable @type in a JSON-LD value, looking inside arrays and @graph.
export const jsonLdNodes = (value) => jsonLdObjects(value).filter((node) => typesOf(node).length > 0)

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

// Every object of every valid JSON-LD block on the page, in order. Invalid JSON-LD is ignored here, the structured
// data check reports it.
export const pageObjects = ($) =>
  jsonLdBlocks($).flatMap((block) => ('error' in block ? [] : jsonLdObjects(block.value)))

// The objects with an @id by that id, typed or not, so a { @id } reference can be looked up.
export const idIndex = (objects) =>
  new Map(objects.filter((node) => typeof node['@id'] === 'string').map((node) => [node['@id'], node]))

export const text = (value, max = MAX_TEXT) => {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return null
  return limit(collapseWhitespace(value), max) || null
}

const scalarText = (value, max) =>
  value && typeof value === 'object' && !Array.isArray(value) ? text(value['@value'], max) : text(value, max)

// A JSON-LD text value: a string, a number, an { @value } object, or a list whose first usable entry counts. A list
// inside a list is not text, so a deeply nested value cannot overflow the stack.
export function textValue(value, max) {
  if (!Array.isArray(value)) return scalarText(value, max)
  return value.map((item) => scalarText(item, max)).find((item) => item !== null) ?? null
}
