import {
  checkFetchError,
  checkHtml,
  checkHtmlError,
  checkResponse,
  extractFacts,
  internalLinks,
  mergeRobotsIssues
} from './checks/page/index.js'
import { hostThrottle } from './concurrency.js'
import { DEFAULT_TIMEOUT_MS, fetchPage as defaultFetchPage } from './fetch.js'
import { issueId, uniqueIds } from './issue-id.js'
import { pageMarkdown } from './markdown.js'
import { parse } from './parse.js'

const EVIDENCE_KEYS = ['selector', 'html', 'parentHtml', 'actual', 'expected']

// Only the evidence a check actually found, in a fixed order.
const pickEvidence = (fields) =>
  Object.fromEntries(EVIDENCE_KEYS.filter((key) => fields[key] !== undefined).map((key) => [key, fields[key]]))

export const DEFAULT_CONCURRENCY = 3
export const DEFAULT_DELAY_MS = 200

const NO_HTML = { issues: [], facts: null, response: null, links: null }

// The checks and facts of a page that returned HTML, `links`, the internal link targets for the site checks, and
// with `content` its main content as Markdown. `url` is the page as given, for the Markdown's front matter.
function auditHtml({ finalUrl, html, truncated, robotsHeader = null, headers }, { url, content }) {
  const $ = parse(html)
  const issues = checkHtml($, { url: finalUrl, truncated, robotsHeader })
  const facts = extractFacts($, finalUrl, { robotsHeader, lastModified: headers?.['last-modified'] ?? null })
  return {
    issues,
    facts,
    links: internalLinks($, finalUrl),
    ...(content ? { content: markdownOf($, { url, finalUrl, title: facts.title, truncated }) } : {})
  }
}

// The Markdown is extra, so a page it fails on keeps its checks and only goes without, as null.
function markdownOf($, page) {
  try {
    return pageMarkdown($, page)
  } catch {
    return null
  }
}

// The checks of a page, NO_HTML unless it returned HTML. `response` is for the site checks and is not part of the
// report: the headers and size, null when the fetcher did not say which headers were sent, so an unknown header is
// never reported as missing. HTML the checks cannot process becomes an issue on that page, like a page that cannot be
// fetched, so it never discards the pages audited around it. Its headers were still received and are still checked.
function htmlResults(fetched, options) {
  if (fetched.status !== 200 || fetched.html === null) return NO_HTML
  const { headers, bodyBytes } = fetched
  const response = headers ? { headers, bodyBytes } : null
  try {
    return { ...auditHtml(fetched, options), response }
  } catch (err) {
    return { ...NO_HTML, issues: checkHtmlError(err), response }
  }
}

// True for a page that returned HTML the checks could not process, so its facts and links are unknown, not absent.
export const checksFailed = (page) => page.issues.some((issue) => issue.type === 'check-failed')

// True for a page whose links are not all known: its checks failed, or its HTML was cut at the 2 MB Googlebot reads,
// so links after the cut were never seen.
export const linksUnread = (page) => checksFailed(page) || page.issues.some((issue) => issue.type === 'html-too-large')

// Fetches and checks one page. A page that cannot be fetched or checked becomes an issue on
// that page instead of an exception, so one bad page never stops the run. With `content`, a page that returned HTML
// also gets its main content as Markdown in `content`, which is not part of the report.
export async function auditPage(
  url,
  { fetchPage = defaultFetchPage, timeout = DEFAULT_TIMEOUT_MS, beforeHop, content = false } = {}
) {
  // A fixed key order keeps the JSON report stable whichever check built the issue.
  const withUrl = (issues) => {
    const ids = uniqueIds(issues.map((issue) => issueId(url, issue.type, issue.selector || issue.context)))
    return issues.map(({ type, severity, category, source, message, context, ...evidence }, i) => ({
      url,
      id: ids[i],
      type,
      severity,
      category,
      source,
      message,
      context,
      ...pickEvidence(evidence)
    }))
  }
  let fetched
  try {
    fetched = await fetchPage(url, { timeout, beforeHop })
  } catch (err) {
    return {
      url,
      finalUrl: null,
      status: null,
      redirects: [],
      issues: withUrl(checkFetchError(err)),
      facts: null,
      response: null,
      links: null
    }
  }
  const { finalUrl, status, redirects } = fetched
  const { issues: htmlIssues, facts, response, links, content: markdown } = htmlResults(fetched, { url, content })
  const issues = [...checkResponse(fetched), ...htmlIssues]
  const page = { url, finalUrl, status, redirects, issues: withUrl(mergeRobotsIssues(issues)), facts, response, links }
  return markdown === undefined ? page : { ...page, content: markdown }
}

// Audits every URL with at most `concurrency` requests in flight. `pace(url)` is awaited before every request,
// redirect hops included, to space out requests to the same host: pass the one the whole run shares.
// `onPage(page)` is awaited for each page as soon as it is done, such as to write its `content` without keeping
// every page's Markdown until the end. Results keep input order.
export async function runAudit(
  urls,
  {
    fetchPage,
    timeout,
    concurrency = DEFAULT_CONCURRENCY,
    pace = hostThrottle(DEFAULT_DELAY_MS),
    content = false,
    onPage = async () => {},
    onProgress = () => {}
  } = {}
) {
  const pages = new Array(urls.length)
  let next = 0
  let done = 0

  async function worker() {
    while (next < urls.length) {
      const i = next++
      pages[i] = await auditPage(urls[i], { fetchPage, timeout, beforeHop: pace, content })
      await onPage(pages[i])
      onProgress(++done, urls.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return pages
}
