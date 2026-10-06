// Browsers and Google collapse whitespace runs, so measure and display text the same way.
export const collapseWhitespace = (text) => text.replace(/\s+/g, ' ').trim()

// Counts characters (code points), so an emoji is one character rather than two UTF-16 units.
export const charCount = (text) => Array.from(text).length

// Caps text at `max` characters (code points, so an emoji is never cut in half),
// ending in "..." when something was cut.
export function limit(text, max) {
  const chars = Array.from(text)
  return chars.length > max ? `${chars.slice(0, max - 3).join('')}...` : text
}
