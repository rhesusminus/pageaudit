import { decodeHTMLStrict } from 'entities'

// Browsers and Google collapse whitespace runs, so measure and display text the same way.
export const collapseWhitespace = (text) => text.replace(/\s+/g, ' ').trim()

// Counts characters (code points), so an emoji is one character rather than two UTF-16 units.
export const charCount = (text) => Array.from(text).length

// URLs get a much higher cap than other text: a URL cut short is not a URL any more.
export const MAX_URL = 2000

// Caps text at `max` characters (code points, so an emoji is never cut in half),
// ending in "..." when something was cut and there is room for more than the dots.
export function limit(text, max) {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return max > 3 ? `${chars.slice(0, max - 3).join('')}...` : chars.slice(0, Math.max(max, 0)).join('')
}

const ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi

// The distinct HTML entities, such as &lt; or &#8226;, in text that was already decoded once. Only real entities with
// their semicolon count, so AT&T or R&D; are plain text.
export const htmlEntities = (text) => [
  ...new Set(text.match(ENTITY)?.filter((entity) => decodeHTMLStrict(entity) !== entity))
]
