import { limit } from '../text.js'
import { markupStart } from './markup.js'

export const MAX_CONTEXT = 120

// Caps an issue context so large markup or long attribute values never flood the report.
export const truncate = (text) => limit(text, MAX_CONTEXT)

export const snippet = ($, el) => markupStart($, el, MAX_CONTEXT)

// An SEO issue with its context capped. Fields passed in win over the category default.
export const seoIssue = (fields) => ({ category: 'seo', ...fields, context: truncate(fields.context) })
