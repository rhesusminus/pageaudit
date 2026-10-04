// Browsers and Google collapse whitespace runs, so measure and display text the same way.
export const collapseWhitespace = (text) => text.replace(/\s+/g, ' ').trim()

// Counts characters (code points), so an emoji is one character rather than two UTF-16 units.
export const charCount = (text) => Array.from(text).length
