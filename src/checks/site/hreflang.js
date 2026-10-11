import { pageKey } from '../../input/resolve.js'
import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'

const siteIssue = (issue) => ({ severity: 'warning', category: 'seo', source: SOURCES.hreflang, ...issue })

// Pages audited as HTML, one per final URL, with every input that led there. Each is found under the
// final URL and under every input, so an alternate written as a redirecting address still matches.
function auditedPages(pages) {
  const byFinalUrl = new Map()
  for (const page of pages.filter((p) => p.facts)) {
    const key = pageKey(page.finalUrl)
    if (!byFinalUrl.has(key)) byFinalUrl.set(key, { page, urls: [], keys: new Set([key]) })
    const audited = byFinalUrl.get(key)
    audited.urls.push(page.url)
    audited.keys.add(pageKey(page.url))
  }
  const byKey = new Map()
  for (const audited of byFinalUrl.values()) for (const key of audited.keys) byKey.set(key, audited)
  return { all: [...byFinalUrl.values()], byKey }
}

// Every alternate that points to another audited page, once per pair. Targets outside the audit cannot be verified.
function alternatePairs(pages) {
  const { all, byKey } = auditedPages(pages)
  return all.flatMap((source) => {
    const targets = new Set(source.page.facts.hreflang.map(({ href }) => byKey.get(pageKey(href))))
    targets.delete(undefined)
    targets.delete(source)
    return [...targets].map((target) => ({ source, target }))
  })
}

// Google ignores a pair of alternates unless both pages list each other.
function missingReturnIssues(pairs) {
  return pairs
    .filter(({ source, target }) => !target.page.facts.hreflang.some(({ href }) => source.keys.has(pageKey(href))))
    .map(({ source, target }) =>
      siteIssue({
        type: 'hreflang-missing-return',
        message: 'Hreflang alternate does not link back',
        context: truncate(`${target.page.finalUrl} has no hreflang link to ${source.page.finalUrl}`),
        urls: [...source.urls, ...target.urls]
      })
    )
}

// One issue per target that cannot be listed, with every page that names it as an alternate.
function targetIssues(pairs, fields, isBad) {
  const byTarget = new Map()
  for (const { source, target } of pairs.filter(({ target }) => isBad(target.page))) {
    if (!byTarget.has(target)) byTarget.set(target, [...target.urls])
    // Pushed one by one: a page many inputs redirect to can list too many for push(...urls).
    for (const url of source.urls) byTarget.get(target).push(url)
  }
  return [...byTarget].map(([target, urls]) => siteIssue({ ...fields, context: truncate(target.page.finalUrl), urls }))
}

const isNoindex = (page) => page.issues.some((issue) => issue.type === 'noindex')
const isCanonicalisedElsewhere = (page) =>
  Boolean(page.facts.canonical) && pageKey(page.facts.canonical) !== pageKey(page.finalUrl)

// Hreflang links between audited pages: missing return links, and alternates that Google will not list.
export function checkHreflangTargets(pages) {
  const pairs = alternatePairs(pages)
  return [
    ...missingReturnIssues(pairs),
    ...targetIssues(
      pairs,
      { type: 'hreflang-target-noindex', message: 'Hreflang alternate is marked noindex' },
      isNoindex
    ),
    ...targetIssues(
      pairs,
      { type: 'hreflang-target-canonicalised', message: 'Hreflang alternate has a canonical pointing elsewhere' },
      isCanonicalisedElsewhere
    )
  ]
}
