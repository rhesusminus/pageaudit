import { adviceFor } from './advice.js'
import { issueId, uniqueIds } from './issue-id.js'
import { countSeverities } from './severity.js'
import { limit, MAX_URL } from './text.js'

const MAX_FACT_TEXT = 300
const MAX_H1S = 10
const MAX_HREFLANG = 100

// The facts as written to the report. Titles, descriptions, headings and hreflang lists can be any
// length on a real site, so they are capped here, after the site checks compared them in full.
const reportFacts = (facts) =>
  facts && {
    ...facts,
    title: facts.title && limit(facts.title, MAX_FACT_TEXT),
    description: facts.description && limit(facts.description, MAX_FACT_TEXT),
    h1s: facts.h1s.slice(0, MAX_H1S).map((h1) => limit(h1, MAX_FACT_TEXT)),
    hreflang: facts.hreflang.slice(0, MAX_HREFLANG).map(({ lang, href }) => ({ lang, href: limit(href, MAX_URL) }))
  }

// What each issue type found in the report means, so the JSON is self-explanatory:
// { title, why, fix } per type, once instead of on every issue.
function reportRules(issues) {
  const rules = {}
  for (const { type } of issues) {
    const advice = adviceFor(type)
    if (advice && !(type in rules)) rules[type] = advice
  }
  return rules
}

// Site issues get an id from the pages they list, so they can be referred to like page issues.
function withSiteIds(site) {
  const ids = uniqueIds(site.map((issue) => issueId(issue.urls.toSorted().join(' '), issue.type, issue.context)))
  return site.map((issue, i) => ({ id: ids[i], ...issue }))
}

// What each failing Lighthouse audit means, once: the description and link are the same on every page, so they
// move out of the pages into one map. Returns the pages' Lighthouse blocks without them and the map.
function hoistAuditNotes(pages) {
  const notes = new Map()
  const lean = (lighthouse) =>
    lighthouse && {
      ...lighthouse,
      audits: lighthouse.audits.map(({ description, learnMore, ...audit }) => {
        if (description || learnMore) {
          const known = notes.get(audit.id) ?? {}
          notes.set(audit.id, {
            description: known.description ?? description,
            learnMore: known.learnMore ?? learnMore
          })
        }
        return audit
      })
    }
  const blocks = pages.map((page) => lean(page.lighthouse))
  return { blocks, notes: Object.fromEntries(notes) }
}

// Goes up by one when a field of the JSON report is removed, renamed or changes its meaning. The shape is
// described in schema/report.schema.json.
export const SCHEMA_VERSION = 1

// The JSON report, which doubles as the data handed to Claude. `facts` is null for
// pages that returned no HTML.
export function buildReport({ pages, site, skipped = [], now = new Date() }) {
  const issues = [...pages.flatMap((page) => page.issues), ...site]
  const totals = countSeverities(issues)
  const { blocks, notes } = hoistAuditNotes(pages)
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    pages: pages.map(({ url, finalUrl, status, redirects, issues, facts, lighthouse }, i) => ({
      url,
      finalUrl,
      status,
      redirects,
      issues,
      facts: reportFacts(facts),
      // Only present when Lighthouse ran for the page (--lighthouse, --lighthouse-page or a urls file marker).
      ...(lighthouse === undefined ? {} : { lighthouse: blocks[i] })
    })),
    site: withSiteIds(site),
    skipped,
    rules: reportRules(issues),
    ...(Object.keys(notes).length > 0 ? { lighthouseAudits: notes } : {}),
    summary: { pages: pages.length, ...totals }
  }
}
