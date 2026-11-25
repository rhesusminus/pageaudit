// checkHtml() and extractFacts(): facts for the site checks and the report.
import { collapseWhitespace, limit } from '../../text.js'
import { checkA11y } from './a11y.js'
import { pageAuthorship } from './authorship.js'
import { visibleTextStart } from './content.js'
import { checkEscapedText } from './escaped-text.js'
import { checkHeadings } from './headings.js'
import { checkHreflang } from './hreflang.js'
import { checkHygiene } from './hygiene.js'
import { checkImages } from './images.js'
import { checkIndexing } from './indexing.js'
import { checkLinks } from './links.js'
import { canonicalLinks, checkMeta, descriptionValues, titleElement } from './meta.js'
import { pagePlatform } from './platform.js'
import { checkProducts, pageProducts } from './products.js'
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
  ...checkEscapedText($),
  ...checkHeadings($),
  ...checkIndexing($),
  ...checkSnippetControls($, page.robotsHeader ?? null),
  ...checkSocial($),
  ...checkStructuredData($),
  ...checkProducts($),
  ...checkHreflang($, page),
  ...checkHygiene($, page)
]

// The canonical URL of a page: the first non-empty canonical link in <head>, resolved against <base> like a browser
// would, or null. The facts and the link targets of --check-links read it the same way.
export function pageCanonical($, finalUrl) {
  const href = canonicalLinks($)
    .map((el) => ($(el).attr('href') ?? '').trim())
    .find(Boolean)
  return href ? absolute(href, baseUrl($, finalUrl)) : null
}

// The values the site checks compare across pages, plus content signals for the
// report. Empty values are null so a missing title is never reported as a duplicate
// of another missing title. `response` holds what the response said about the page: `robotsHeader`, the X-Robots-Tag
// value, and `lastModified`, the Last-Modified header, each null or left out when not sent.
// An h1 is kept up to a length no real heading reaches. The report shows less still, so the rest only told apart h1s
// for the duplicate check, and reading it all made each h1 nested in another read the same text again. A page wrapped
// in an h1 by mistake would also carry its whole text as a fact.
const MAX_H1 = 1000

export function extractFacts($, finalUrl, { robotsHeader = null, lastModified = null } = {}) {
  const base = baseUrl($, finalUrl)
  const { jsonLd, dates, author } = pageAuthorship($, lastModified)
  return {
    title: collapseWhitespace(titleElement($).text()) || null,
    description: descriptionValues($).find(Boolean) ?? null,
    h1s: [
      ...new Set(
        $('h1')
          .toArray()
          .map((el) => limit(collapseWhitespace(visibleTextStart(el, MAX_H1 + 1)), MAX_H1))
          .filter(Boolean)
      )
    ],
    canonical: pageCanonical($, finalUrl),
    ...extractSignals($, base, finalUrl, robotsHeader),
    jsonLd,
    // sitemapLastmod is filled in once the audit knows which sitemap listed the page, see addSitemapDates().
    dates: { ...dates, sitemapLastmod: null },
    author,
    products: pageProducts($),
    platform: pagePlatform($)
  }
}
