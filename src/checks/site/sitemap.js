import { pageKey } from '../../input/resolve.js'
import { SOURCES } from '../../sources.js'

const issue = (fields) => ({ category: 'seo', source: SOURCES.sitemaps, ...fields })

// Pages that were listed in a sitemap, with the sitemap(s) they came from.
const listedPages = (pages, listed) =>
  pages.filter((page) => listed.has(page.url)).map((page) => ({ page, sitemaps: listed.get(page.url) }))

const siteIssue = (rule, matches) =>
  matches.length > 0
    ? [
        issue({
          ...rule,
          context: [...new Set(matches.flatMap(({ sitemaps }) => sitemaps))].join(', '),
          urls: matches.map(({ page }) => page.url)
        })
      ]
    : []

// Sitemaps should list the canonical URLs you want in search results. Listing a noindex page or a
// page whose canonical is another URL sends contradicting signals, a redirecting URL wastes a fetch.
// Pages that fail to load are already errors on the page, so they are not repeated here.
export function checkSitemapEntries(pages, listed = new Map()) {
  const entries = listedPages(pages, listed)
  const noindex = entries.filter(({ page }) => page.issues.some((i) => i.type === 'noindex'))
  const elsewhere = entries.filter(
    ({ page }) => page.facts?.canonical && pageKey(page.facts.canonical) !== pageKey(page.finalUrl)
  )
  const redirects = entries.filter(({ page }) => page.redirects.length > 0)
  return [
    ...siteIssue(
      {
        type: 'sitemap-url-noindex',
        severity: 'warning',
        message: 'The sitemap lists a page that tells search engines not to index it'
      },
      noindex
    ),
    ...siteIssue(
      {
        type: 'sitemap-url-not-canonical',
        severity: 'warning',
        message: 'The sitemap lists a page whose canonical points to a different URL'
      },
      elsewhere
    ),
    ...siteIssue(
      {
        type: 'sitemap-url-redirects',
        severity: 'info',
        message: 'The sitemap lists a URL that redirects, it should list the final URL'
      },
      redirects
    )
  ]
}
