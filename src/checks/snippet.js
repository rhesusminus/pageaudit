import { collapseWhitespace } from '../text.js';

const MAX_CONTEXT = 120;

// Caps an issue context so large markup or long attribute values never flood the report.
// Counts code points so an emoji or other astral character is never cut in half.
export function truncate(text) {
  const chars = Array.from(text);
  return chars.length > MAX_CONTEXT ? `${chars.slice(0, MAX_CONTEXT - 3).join('')}...` : text;
}

export function snippet($, el) {
  return truncate(collapseWhitespace($.html(el)));
}
