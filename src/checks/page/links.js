import { SOURCES } from '../../sources.js'
import { evidence } from '../evidence.js'
import { seoIssue, snippet } from '../snippet.js'
import { accessibleName, namedByScript, visibleImages } from './accname.js'

const GENERIC_TEXT = new Set(['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this link'])

const issue = ($, el, fields) =>
  seoIssue({
    category: 'accessibility',
    context: snippet($, el),
    source: SOURCES.linkPurpose,
    ...fields,
    ...evidence($, el)
  })

const normalize = (name) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim()

// Review hints: a "#" or javascript: link is often a button-like control, and "read more" may be clear in context.
const isPlaceholderHref = (href) => href === '#' || /^javascript:/i.test(href)

// A link whose only content is an image is reported by the image checks, so it is skipped here.
function checkName($, el, name) {
  if (name || visibleImages($, el).length || namedByScript($, el, { images: false })) return []
  return [
    issue($, el, {
      type: 'link-no-name',
      severity: 'error',
      message: 'Link has no accessible name (no text, aria-label or title)'
    })
  ]
}

function checkText($, el, name) {
  if (!GENERIC_TEXT.has(normalize(name))) return []
  return [
    issue($, el, {
      type: 'link-generic-text',
      severity: 'info',
      message: `Link text "${name}" does not say where it goes (review, it may be clear in context)`
    })
  ]
}

function checkHref($, el, href) {
  if (!isPlaceholderHref(href)) return []
  return [
    issue($, el, {
      type: 'link-empty-href',
      severity: 'info',
      category: 'best-practice',
      message: `Link goes nowhere (href="${href.slice(0, 20)}"), a button may fit better (review)`
    })
  ]
}

export function checkLinks($) {
  return $('a[href]')
    .toArray()
    .filter((el) => $(el).attr('aria-hidden') !== 'true')
    .flatMap((el) => {
      const name = accessibleName($, el, { images: false })
      return [...checkName($, el, name), ...checkText($, el, name), ...checkHref($, el, $(el).attr('href').trim())]
    })
}
