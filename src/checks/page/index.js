import { collapseWhitespace } from '../../text.js'
import { checkHeadings } from './headings.js'
import { checkHygiene } from './hygiene.js'
import { checkImages } from './images.js'
import { checkIndexing } from './indexing.js'
import { canonicalLinks, checkMeta, descriptionValues, titleElement } from './meta.js'
import { absolute, baseUrl, extractSignals } from './signals.js'
import { checkSocial } from './social.js'
import { checkStructuredData } from './structured-data.js'

export { checkFetchError, checkResponse } from './response.js'
export { mergeRobotsIssues } from './robots-header.js'

// Every check that looks at the parsed HTML of one page. `page` is { url, html }: the final URL and the raw body.
export const checkHtml = ($, page = {}) => [
  ...checkImages($),
  ...checkMeta($),
  ...checkHeadings($),
  ...checkIndexing($),
  ...checkSocial($),
  ...checkStructuredData($),
  ...checkHygiene($, page)
]

// The values the site checks compare across pages, plus content signals for the
// report. Empty values are null so a missing title is never reported as a duplicate
// of another missing title.
export function extractFacts($, finalUrl) {
  const href = canonicalLinks($)
    .map((el) => ($(el).attr('href') ?? '').trim())
    .find(Boolean)
  const base = baseUrl($, finalUrl)
  return {
    title: collapseWhitespace(titleElement($).text()) || null,
    description: descriptionValues($).find(Boolean) ?? null,
    h1s: [
      ...new Set(
        $('h1')
          .toArray()
          .map((el) => collapseWhitespace($(el).text()))
          .filter(Boolean)
      )
    ],
    canonical: href ? absolute(href, base) : null,
    ...extractSignals($, base, finalUrl)
  }
}
