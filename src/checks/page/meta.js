import { SOURCES } from '../../sources.js'
import { charCount, collapseWhitespace } from '../../text.js'
import { evidence, selectorFor } from '../evidence.js'
import { seoIssue } from '../snippet.js'

// Heuristics: Google gives no numeric limits, truncation depends on pixel width.
const TITLE_MAX = 60
const DESCRIPTION_MAX = 160
const DESCRIPTION_MIN = 70

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

// The document title, also when a body-only element in <head> pushed it into <body>, but never an SVG <title>.
export const titleElement = ($) =>
  $('title')
    .filter((_, el) => !$(el).closest('svg').length)
    .first()

// Every meta description, whitespace collapsed. Only the first non-empty one is used.
export const descriptionValues = ($) =>
  $('meta[name="description" i]')
    .toArray()
    .map((el) => collapseWhitespace($(el).attr('content') ?? ''))

// Google only reads canonical links inside <head>.
export const canonicalLinks = ($) => $('head link[rel~="canonical" i]').toArray()

function checkTitle($) {
  const titleEl = titleElement($)
  const title = collapseWhitespace(titleEl.text())
  const issue = (fields) => [seoIssue({ source: SOURCES.title, severity: 'error', ...fields })]
  if (!titleEl.length) {
    return issue({ type: 'missing-title', message: 'Missing <title>', context: '<head>' })
  }
  const found = evidence($, titleEl.get(0))
  if (!title) {
    return issue({ type: 'empty-title', message: 'Empty <title>', context: '<title></title>', ...found })
  }
  if (charCount(title) > TITLE_MAX) {
    return issue({
      type: 'long-title',
      severity: 'warning',
      message: `Title is ${charCount(title)} chars (over ~${TITLE_MAX}, may be truncated in results)`,
      context: `<title>${title}</title>`,
      actual: charCount(title),
      expected: `at most ${TITLE_MAX} characters`,
      ...found
    })
  }
  return []
}

function descriptionLengthIssue(description) {
  const length = charCount(description)
  const context = `<meta name="description" content="${description}">`
  if (length > DESCRIPTION_MAX) {
    return {
      type: 'long-description',
      severity: 'info',
      message: `Meta description is ${length} chars (over ~${DESCRIPTION_MAX}, may be truncated)`,
      context,
      actual: length,
      expected: `at most ${DESCRIPTION_MAX} characters`
    }
  }
  if (length < DESCRIPTION_MIN) {
    return {
      type: 'short-description',
      severity: 'info',
      message: `Meta description is only ${length} chars (under ~${DESCRIPTION_MIN}, may be too vague)`,
      context,
      actual: length,
      expected: `at least ${DESCRIPTION_MIN} characters`
    }
  }
  return null
}

function checkDescription($) {
  const issues = []
  const descriptions = descriptionValues($)
  const description = descriptions.find(Boolean)
  if (descriptions.length > 1) {
    issues.push({
      type: 'multiple-descriptions',
      severity: 'warning',
      message: `${descriptions.length} meta descriptions found (only one is used)`,
      context: descriptions.map((d) => `<meta name="description" content="${d}">`).join(' ')
    })
  }
  if (!description) {
    issues.push({
      type: 'missing-description',
      severity: 'warning',
      message: 'Missing meta description (Google may build the snippet from page content instead)',
      context: '<head>'
    })
  } else {
    const lengthIssue = descriptionLengthIssue(description)
    if (lengthIssue) {
      const el = $('meta[name="description" i]')
        .toArray()
        .find((meta) => collapseWhitespace($(meta).attr('content') ?? '') === description)
      issues.push({ ...lengthIssue, ...evidence($, el) })
    }
  }
  return issues.map((issue) => seoIssue({ source: SOURCES.snippet, ...issue }))
}

export function checkMeta($) {
  return [...checkTitle($), ...checkDescription($), ...checkCanonical($)]
}

const canonicalIssue = (issue) => seoIssue({ severity: 'warning', source: SOURCES.canonical, ...issue })

function missingCanonicalIssue($, outsideHead) {
  return {
    type: 'missing-canonical',
    message: outsideHead.length
      ? 'Canonical link is outside <head> (Google ignores it there)'
      : 'Missing canonical link',
    context: outsideHead.length ? $.html(outsideHead[0]) : '<head>',
    ...(outsideHead.length ? evidence($, outsideHead[0]) : {})
  }
}

function multipleCanonicalsIssue($, inHead) {
  const hrefs = new Set(inHead.map((el) => ($(el).attr('href') ?? '').trim()))
  const identical = hrefs.size === 1
  return {
    type: 'multiple-canonicals',
    severity: identical ? 'info' : 'warning',
    message: identical
      ? `${inHead.length} identical canonical links found (redundant, keep only one)`
      : `${inHead.length} canonical links found (conflicting signals)`,
    context: inHead.map((el) => $.html(el)).join(' '),
    selector: inHead.map((el) => selectorFor($, el)).join(', ')
  }
}

function canonicalHrefIssues($, el) {
  const href = ($(el).attr('href') ?? '').trim()
  const context = $.html(el)
  const found = evidence($, el)
  if (!href) return [{ type: 'empty-canonical', message: 'Canonical link has no href', context, ...found }]
  const issues = []
  if (!ABSOLUTE_URL.test(href)) {
    issues.push({
      type: 'relative-canonical',
      message: 'Canonical URL is relative (Google recommends absolute URLs)',
      context,
      actual: href,
      expected: 'an absolute URL such as https://example.com/page',
      ...found
    })
  }
  if (href.includes('#')) {
    issues.push({
      type: 'canonical-fragment',
      message: 'Canonical URL contains a fragment (generally not supported)',
      context,
      actual: href,
      ...found
    })
  }
  return issues
}

function checkCanonical($) {
  const inHead = canonicalLinks($)
  if (inHead.length === 0) {
    const outsideHead = $('link[rel~="canonical" i]').toArray()
    return [canonicalIssue(missingCanonicalIssue($, outsideHead))]
  }

  const issues = []
  if (inHead.length > 1) issues.push(multipleCanonicalsIssue($, inHead))
  for (const el of inHead) issues.push(...canonicalHrefIssues($, el))
  return issues.map(canonicalIssue)
}
