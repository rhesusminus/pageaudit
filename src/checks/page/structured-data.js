import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'
import { jsonLdBlocks, jsonLdNodes, typesOf } from './signals.js'

const URL_PROPERTIES = ['url', 'image', 'logo', 'sameAs', 'contentUrl']

// Types Google's search gallery has no rich result for (most were retired).
const NO_RICH_RESULT = new Set([
  'HowTo',
  'FAQPage',
  'SpecialAnnouncement',
  'CourseInfo',
  'EstimatedSalary',
  'LearningVideo',
  'ClaimReview',
  'VehicleListing'
])

const issue = (fields) => ({ category: 'seo', ...fields, context: truncate(fields.context) })

const has = (node, key) => node[key] !== undefined && node[key] !== null && node[key] !== ''

// A URL value is a string, an array of strings, or an object with a url (ImageObject).
function relativeUrls(value) {
  if (Array.isArray(value)) return value.flatMap(relativeUrls)
  if (value && typeof value === 'object') return relativeUrls(value.url)
  return typeof value === 'string' && value.trim() && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value.trim()) ? [value] : []
}

function missingProperties(node, types) {
  const missing = []
  if (types.includes('Product')) {
    if (!has(node, 'name')) missing.push('name')
    if (!['offers', 'review', 'aggregateRating'].some((key) => has(node, key)))
      missing.push('one of offers, review or aggregateRating')
  }
  if (types.includes('BreadcrumbList') && !has(node, 'itemListElement')) missing.push('itemListElement')
  return missing.length > 0
    ? [`${types.find((t) => t === 'Product' || t === 'BreadcrumbList')}: ${missing.join(', ')}`]
    : []
}

const sd = (fields) => issue({ source: SOURCES.structuredData, ...fields })

function checkNode(node) {
  const types = typesOf(node)
  const issues = []
  for (const type of types.filter((t) => NO_RICH_RESULT.has(t))) {
    issues.push(
      issue({
        type: 'unsupported-schema-type',
        severity: 'info',
        source: SOURCES.searchGallery,
        message: `${type} markup: Google's search gallery has no rich result for it (it does no harm, it just has no effect in Google Search)`,
        context: `"@type": "${type}"`
      })
    )
  }
  for (const key of URL_PROPERTIES) {
    for (const value of relativeUrls(node[key])) {
      issues.push(
        sd({
          type: 'json-ld-relative-url',
          severity: 'warning',
          message: `The ${key} in ${types.join(', ')} markup is not an absolute URL`,
          context: `"${key}": "${value}"`
        })
      )
    }
  }
  for (const description of missingProperties(node, types)) {
    issues.push(
      issue({
        type: 'missing-schema-property',
        severity: 'warning',
        source: types.includes('Product') ? SOURCES.productSnippet : SOURCES.breadcrumb,
        message: `Required property missing, ${description}`,
        context: `"@type": "${types.join(', ')}"`
      })
    )
  }
  return issues
}

// Each top-level item needs a @context, either its own or on a member of its @graph.
function lacksContext(value) {
  const items = (Array.isArray(value) ? value : [value]).filter((item) => item && typeof item === 'object')
  return items.some(
    (item) =>
      jsonLdNodes(item).length > 0 && !has(item, '@context') && !jsonLdNodes(item).some((node) => has(node, '@context'))
  )
}

function checkBlock(block) {
  const text = block.text.trim()
  if ('error' in block) {
    const message = `A JSON-LD block is not valid JSON, so search engines ignore it (${block.error})`
    return [sd({ type: 'invalid-json-ld', severity: 'warning', message, context: text })]
  }
  const found = jsonLdNodes(block.value)
  const issues = []
  if (lacksContext(block.value)) {
    const message = 'A JSON-LD block has no @context (it should be "https://schema.org")'
    issues.push(sd({ type: 'json-ld-missing-context', severity: 'warning', message, context: text }))
  }
  return [...issues, ...found.flatMap(checkNode)]
}

export const checkStructuredData = ($) => jsonLdBlocks($).flatMap(checkBlock)
