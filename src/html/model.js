import { METRIC_BANDS } from '../lighthouse-limits.js'
import { countSeverities } from '../severity.js'

export { METRIC_BANDS }

export function metricBand(key, value) {
  if (value === null || value === undefined) return 'unknown'
  const { good, poor } = METRIC_BANDS[key]
  if (value <= good) return 'good'
  return value > poor ? 'poor' : 'average'
}

// Site issues that list no audited page, such as a sitemap file that is too large. They are on no page, so
// the page health cannot show them.
export function siteWideIssues({ pages, site }) {
  const audited = new Set(pages.map((page) => page.url))
  return site.filter((issue) => !issue.urls.some((url) => audited.has(url)))
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// The one-sentence answer to "how is the site doing".
export function verdict({ pages }, health, siteWide = []) {
  const { errors, warnings } = countSeverities(siteWide)
  if (health.errors) {
    return `${plural(health.errors, 'page')} out of ${pages} ${health.errors === 1 ? 'has' : 'have'} problems that should be fixed first.`
  }
  if (errors) return `${plural(errors, 'site-wide problem')} should be fixed first, see the list of fixes.`
  if (health.warnings) return `No serious problems. ${plural(health.warnings, 'page')} could still be improved.`
  if (warnings) return `No serious problems. ${plural(warnings, 'site-wide problem')} could still be improved.`
  return `No problems found on ${plural(pages, 'page')}.`
}
