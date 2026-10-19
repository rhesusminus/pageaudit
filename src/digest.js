import { countSeverities } from './severity.js'
import { averageScores, groupIssues, pageHealth, pagesWithSiteIssues } from './overview.js'
import { limit, MAX_URL } from './text.js'

const MAX_VARIANTS = 5
const MAX_MESSAGES = 3
const MAX_URLS = 3
const MAX_SKIPPED = 5

// Goes up by one when a field of the digest is removed, renamed or changes its meaning. The shape is described in
// schema/digest.schema.json.
export const DIGEST_VERSION = 1

// Read first by a model, so the digest says itself what it is for and how it was cut.
const ABOUT =
  'A short form of the JSON report, for triage: it lists the problems the checks detected, not the content of ' +
  'the pages, so judging content, intent or navigation needs the page facts in the full report. ' +
  'Every count is complete, only lists are cut: a finding shows its ' +
  `${MAX_MESSAGES} most common messages, its ${MAX_VARIANTS} most common variants and ${MAX_URLS} pages of each, ` +
  `an audit its ${MAX_URLS} worst pages. A message shared by many pages is one pattern, even when each page has ` +
  'its own element. ' +
  'A variant is one element (same selector) or value (same context) found on several pages, often one template ' +
  'to fix. The most common variant is not always the most important one. In a finding, pages counts the pages ' +
  'involved and hits the issues, where a site issue such as a duplicate title is one hit however many pages it ' +
  'lists. summary counts issues, summary.health pages by their worst issue. Lighthouse counts are the one ' +
  'exception to complete counts: the report keeps only the worst failing audits of each page, so ' +
  'lighthouseAudits counts the pages among those, and pages[].omittedAudits says how many more a page had. ' +
  'pages[].lighthouseWarnings counts the warnings of a run, such as an audit that crashed. Page checks run on ' +
  'every page that answered 200 with HTML. A page they could not inspect, or inspected only in part, has an ' +
  'issue saying so (http-status, not-html, fetch-failed, ' +
  'check-failed, html-too-large). Elsewhere, an issue type that is missing means the checks found nothing. ' +
  'coverage.notRun lists the checks that did not run: their issue types are missing because nothing was looked ' +
  'for. With --limit the first URLs in input order are audited. The full details of a page are in the report at ' +
  'report.path (relative to this file), under pages[] by url. If report.path is null, the full report was not ' +
  'written and the details are not available. A page line with content names a Markdown file (relative to this ' +
  "file) with the page's main content, the HTML as served before scripts run: read it to judge what the page " +
  'covers, how clearly and how accurately. origins says for each audited origin whether its robots.txt lets the ' +
  'crawlers of AI search products (aiSearch) and the AI training crawlers (aiTraining) read the audited pages, and ' +
  'the Content-Signal it declares. Blocking training only is a choice that keeps a site in AI search.'

// The first `max` of a list under `key`, and under `moreKey` how many were left out, when any were.
function capped(list, max, key, moreKey) {
  const more = list.length - max
  return { [key]: list.slice(0, max), ...(more > 0 ? { [moreKey]: more } : {}) }
}

// Messages, contexts, selectors and measured values can hold text from the page or a sitemap of any length, such as
// a long URL. They are grouped whole and only cut for display, with the cap URLs get, so the digest stays small.
const shown = (text) => limit(text, MAX_URL)

// Hits grouped by `keyOf`, each group with its first hit and the pages it is on, most pages first.
function groupHits(hits, keyOf) {
  const groups = new Map()
  for (const hit of hits) {
    const key = keyOf(hit)
    const group = groups.get(key) ?? { hit, urls: new Set() }
    for (const url of hit.urls) group.urls.add(url)
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => b.urls.size - a.urls.size)
}

// The hits of one issue type split by the element or value they are about, most pages first. Hits on the same
// selector with the same context are one variant, so a template element repeated on every page is one line.
const variants = (hits) =>
  groupHits(hits, (hit) => `${hit.selector ?? ''}\u0000${hit.context}`).map(({ hit, urls }) => ({
    message: shown(hit.message),
    context: shown(hit.context),
    ...(hit.selector ? { selector: shown(hit.selector) } : {}),
    ...(hit.html ? { html: hit.html } : {}),
    ...(hit.actual === undefined ? {} : { actual: typeof hit.actual === 'string' ? shown(hit.actual) : hit.actual }),
    ...(hit.expected === undefined ? {} : { expected: hit.expected }),
    pages: urls.size,
    urls: [...urls].slice(0, MAX_URLS)
  }))

// The distinct messages of one issue type, most pages first. Where every element is different, such as a heading
// level skipped in the text of each blog post, the message still shows that it is one pattern across the pages.
const messages = (hits) =>
  groupHits(hits, (hit) => hit.message).map(({ hit, urls }) => ({ message: shown(hit.message), pages: urls.size }))

function findings(report) {
  return groupIssues(report).map((group) => {
    const rule = report.rules[group.type]
    return {
      type: group.type,
      severity: group.severity,
      category: group.category,
      ...(rule ? { title: rule.title, why: rule.why, fix: rule.fix } : {}),
      pages: group.urls.length,
      hits: group.hits.length,
      ...capped(messages(group.hits), MAX_MESSAGES, 'messages', 'moreMessages'),
      ...capped(variants(group.hits), MAX_VARIANTS, 'variants', 'moreVariants')
    }
  })
}

// The failing Lighthouse audits by id across pages, on most pages first. Inputs that redirect to one page share a
// run, so each run counts once, under the first page that ended up there.
function lighthouseAudits(pages) {
  const runs = new Map()
  for (const page of pages) if (page.lighthouse && !runs.has(page.finalUrl)) runs.set(page.finalUrl, page)
  const byId = new Map()
  for (const page of runs.values()) {
    for (const audit of page.lighthouse.audits) {
      const entry = byId.get(audit.id) ?? { id: audit.id, category: audit.category, title: audit.title, hits: [] }
      entry.hits.push({ url: page.url, score: audit.score })
      byId.set(audit.id, entry)
    }
  }
  // A score of null is an audit Lighthouse could not score. 101 is above any score (0 to 100), so it sorts after
  // the scored ones.
  const worse = (a, b) => (a.score ?? 101) - (b.score ?? 101)
  return [...byId.values()]
    .map(({ hits, ...entry }) => {
      const worst = hits.toSorted(worse)
      return {
        ...entry,
        pages: hits.length,
        worstScore: worst[0].score,
        urls: worst.slice(0, MAX_URLS).map((h) => h.url)
      }
    })
    .sort((a, b) => b.pages - a.pages || worse({ score: a.worstScore }, { score: b.worstScore }))
}

// The Lighthouse part of a page line: the scores, how many failing audits the report left out and how many warnings
// the run gave, such as an audit that crashed.
const lighthouseLine = ({ scores, omittedAudits, warnings }) => ({
  scores,
  ...(omittedAudits ? { omittedAudits } : {}),
  ...(warnings.length ? { lighthouseWarnings: warnings.length } : {})
})

// One line per audited page, with the site issues that list it counted in, like the HTML report does, and the
// page's --content file when it has one.
const pageLines = (pages, contentFiles) =>
  pages.map((page) => ({
    url: page.url,
    ...(page.finalUrl && page.finalUrl !== page.url ? { finalUrl: page.finalUrl } : {}),
    status: page.status,
    ...countSeverities(page.issues),
    ...(page.lighthouse ? lighthouseLine(page.lighthouse) : {}),
    ...(contentFiles.has(page.url) ? { content: contentFiles.get(page.url) } : {})
  }))

// A compact view of a finished report for a model to read first: issues grouped by type and by the element they
// are about, Lighthouse audits grouped by id and one line per page. `reportPath` is where the full report was
// written, relative to the digest, or null, and `contentFiles` the --content file of each page by URL, relative to
// the digest. Only the page lines grow with the number of pages.
export function buildDigest(report, { reportPath = null, contentFiles = new Map() } = {}) {
  const pages = pagesWithSiteIssues(report)
  const scores = averageScores(report.pages)
  const audits = lighthouseAudits(report.pages)
  return {
    digestVersion: DIGEST_VERSION,
    about: ABOUT,
    report: { path: reportPath, schemaVersion: report.schemaVersion, generatedAt: report.generatedAt },
    ...(report.coverage ? { coverage: report.coverage } : {}),
    ...(report.origins ? { origins: report.origins } : {}),
    summary: { ...report.summary, health: pageHealth(pages) },
    ...(scores ? { scores } : {}),
    ...capped(report.skipped, MAX_SKIPPED, 'skipped', 'moreSkipped'),
    findings: findings(report),
    ...(audits.length ? { lighthouseAudits: audits } : {}),
    pages: pageLines(pages, contentFiles)
  }
}
