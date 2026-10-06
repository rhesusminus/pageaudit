import { collapseWhitespace, limit } from '../text.js'

const MAX_CONTEXT = 120

// Caps an issue context so large markup or long attribute values never flood the report.
export const truncate = (text) => limit(text, MAX_CONTEXT)

export function snippet($, el) {
  return truncate(collapseWhitespace($.html(el)))
}
