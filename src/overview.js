import { compareSeverity, countSeverities, worseSeverity } from './severity.js'

// One entry per issue type across the whole report, so a problem that shows up on forty
// pages is one line to fix, not forty. Page issues and site-wide issues share the list.
export function groupIssues(report) {
  const groups = new Map()
  const add = (issue, urls) => {
    const group = groups.get(issue.type) ?? {
      type: issue.type,
      severity: issue.severity,
      category: issue.category,
      message: issue.message,
      hits: []
    }
    group.severity = worseSeverity(group.severity, issue.severity)
    const { context, message, selector, html, parentHtml, actual, expected } = issue
    group.hits.push({ urls, context, message, selector, html, parentHtml, actual, expected })
    groups.set(issue.type, group)
  }
  for (const page of report.pages) for (const issue of page.issues) add(issue, [page.url])
  for (const issue of report.site) add(issue, issue.urls)
  return [...groups.values()]
    .map((group) => ({ ...group, urls: [...new Set(group.hits.flatMap((hit) => hit.urls))] }))
    .sort(
      (a, b) => compareSeverity(a.severity, b.severity) || b.urls.length - a.urls.length || a.type.localeCompare(b.type)
    )
}

// Each page with the site-wide issues it is part of (duplicate titles and the like) added
// to its own, so a page is never called clean while a site-wide problem lists it. The issues are indexed by URL
// once, a site issue can list every page of a sitemap.
export function pagesWithSiteIssues({ pages, site }) {
  const byUrl = new Map()
  for (const issue of site) {
    for (const url of new Set(issue.urls)) {
      if (!byUrl.has(url)) byUrl.set(url, [])
      byUrl.get(url).push(issue)
    }
  }
  return pages.map((page) => ({ ...page, issues: [...page.issues, ...(byUrl.get(page.url) ?? [])] }))
}

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
