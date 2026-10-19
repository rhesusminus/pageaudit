import { collapseWhitespace } from '../../text.js'
import { checkA11y } from './a11y.js'
import { checkHeadings } from './headings.js'
import { checkHreflang } from './hreflang.js'
import { checkHygiene } from './hygiene.js'
import { checkImages } from './images.js'
import { checkIndexing } from './indexing.js'
import { checkLinks } from './links.js'
import { canonicalLinks, checkMeta, descriptionValues, titleElement } from './meta.js'
import { absolute, baseUrl, extractSignals } from './signals.js'
import { checkSnippetControls } from './snippets.js'
import { checkSocial } from './social.js'
import { checkStructuredData } from './structured-data.js'

export { checkFetchError, checkHtmlError, checkResponse } from './response.js'
export { mergeRobotsIssues } from './robots-header.js'
export { internalLinks } from './signals.js'

// Every check that looks at the parsed HTML of one page. `page` is { url, truncated, robotsHeader }: the final URL,
// whether the HTML was cut at the size Googlebot reads, see fetchPage(), and the X-Robots-Tag value or null.
export const checkHtml = ($, page = {}) => [
  ...checkImages($),
  ...checkA11y($),
  ...checkLinks($),
  ...checkMeta($),
  ...checkHeadings($),
  ...checkIndexing($),
  ...checkSnippetControls($, page.robotsHeader ?? null),
  ...checkSocial($),
  ...checkStructuredData($),
  ...checkHreflang($, page),
  ...checkHygiene($, page)
]

// The values the site checks compare across pages, plus content signals for the
// report. Empty values are null so a missing title is never reported as a duplicate
// of another missing title. `robotsHeader` is the X-Robots-Tag value or null.
export function extractFacts($, finalUrl, robotsHeader = null) {
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
    ...extractSignals($, base, finalUrl, robotsHeader)
  }
}
