import { countSeverities } from '../report.js'

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }

// Core Web Vitals and the other Lighthouse metrics: [good up to, poor from]. Lighthouse
// and web.dev publish these thresholds, a value in between "needs improvement".
export const METRIC_BANDS = {
  lcp: { label: 'Largest Contentful Paint', unit: 'ms', good: 2500, poor: 4000 },
  cls: { label: 'Cumulative Layout Shift', unit: '', good: 0.1, poor: 0.25 },
  tbt: { label: 'Total Blocking Time', unit: 'ms', good: 200, poor: 600 },
  fcp: { label: 'First Contentful Paint', unit: 'ms', good: 1800, poor: 3000 },
  speedIndex: { label: 'Speed Index', unit: 'ms', good: 3400, poor: 5800 }
}

export function metricBand(key, value) {
  if (value === null || value === undefined) return 'unknown'
  const { good, poor } = METRIC_BANDS[key]
  if (value <= good) return 'good'
  return value >= poor ? 'poor' : 'average'
}

const worst = (a, b) => (SEVERITY_ORDER[a] <= SEVERITY_ORDER[b] ? a : b)

// One entry per issue type across the whole report, so a problem that shows up on forty
// pages is one line to fix, not forty. Page issues and site-wide issues share the list.
export function groupIssues(report) {
  const groups = new Map()
  const add = (issue, urls) => {
    const group = groups.get(issue.type) ?? {
      type: issue.type,
      severity: issue.severity,
      message: issue.message,
      hits: []
    }
    group.severity = worst(group.severity, issue.severity)
    group.hits.push({ urls, context: issue.context, message: issue.message })
    groups.set(issue.type, group)
  }
  for (const page of report.pages) for (const issue of page.issues) add(issue, [page.url])
  for (const issue of report.site) add(issue, issue.urls)
  return [...groups.values()]
    .map((group) => ({ ...group, urls: [...new Set(group.hits.flatMap((hit) => hit.urls))] }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        b.urls.length - a.urls.length ||
        a.type.localeCompare(b.type)
    )
}

// Each page with the site-wide issues it is part of (duplicate titles and the like) added
// to its own, so a page is never called clean while a site-wide problem lists it.
export const pagesWithSiteIssues = ({ pages, site }) =>
  pages.map((page) => ({ ...page, issues: [...page.issues, ...site.filter((issue) => issue.urls.includes(page.url))] }))

// How many audited pages are in each state. Pages that could not be fetched count as errors.
export function pageHealth(pages) {
  const health = { errors: 0, warnings: 0, clean: 0 }
  for (const page of pages) {
    const { errors, warnings } = countSeverities(page.issues)
    health[errors ? 'errors' : warnings ? 'warnings' : 'clean']++
  }
  return health
}

// Mean Lighthouse score per category over the pages that were audited, or null without any.
export function averageScores(pages) {
  // Inputs that redirect to the same page share one Lighthouse run, count it once.
  const runs = [
    ...new Map(pages.filter((page) => page.lighthouse).map((page) => [page.finalUrl, page.lighthouse])).values()
  ]
  if (!runs.length) return null
  const ids = Object.keys(runs[0].scores)
  const average = (id) => {
    const scores = runs.map((run) => run.scores[id]).filter((score) => score !== null && score !== undefined)
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
  }
  return { pages: runs.length, scores: Object.fromEntries(ids.map((id) => [id, average(id)])) }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// The one-sentence answer to "how is the site doing".
export function verdict({ pages }, health) {
  if (health.errors) {
    return `${plural(health.errors, 'page')} out of ${pages} ${health.errors === 1 ? 'has' : 'have'} problems that should be fixed first.`
  }
  if (health.warnings) return `No serious problems. ${plural(health.warnings, 'page')} could still be improved.`
  return `No problems found on ${plural(pages, 'page')}.`
}
