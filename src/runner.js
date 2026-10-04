import { setTimeout as sleep } from 'node:timers/promises'
import { checkFetchError, checkHtml, checkResponse, extractFacts } from './checks/page/index.js'
import { DEFAULT_TIMEOUT_MS, fetchPage as defaultFetchPage } from './fetch.js'
import { parse } from './parse.js'

export const DEFAULT_CONCURRENCY = 3
export const DEFAULT_DELAY_MS = 200

// Fetches and checks one page. A page that cannot be fetched becomes an issue on
// that page instead of an exception, so one bad page never stops the run.
export async function auditPage(url, { fetchPage = defaultFetchPage, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  // A fixed key order keeps the JSON report stable whichever check built the issue.
  const withUrl = (issues) =>
    issues.map(({ type, severity, category, source, message, context }) => ({
      url,
      type,
      severity,
      category,
      source,
      message,
      context
    }))
  let fetched
  try {
    fetched = await fetchPage(url, { timeout })
  } catch (err) {
    return { url, finalUrl: null, status: null, redirects: [], issues: withUrl(checkFetchError(err)), facts: null }
  }
  const { finalUrl, status, redirects, html } = fetched
  const issues = checkResponse(fetched)
  let facts = null
  if (status === 200 && html !== null) {
    const $ = parse(html)
    issues.push(...checkHtml($))
    facts = extractFacts($, finalUrl)
  }
  return { url, finalUrl, status, redirects, issues: withUrl(issues), facts }
}

// Audits every URL with at most `concurrency` requests in flight, starting
// requests to the same host at least `delay` ms apart. Results keep input order.
export async function runAudit(
  urls,
  { fetchPage, timeout, concurrency = DEFAULT_CONCURRENCY, delay = DEFAULT_DELAY_MS, onProgress = () => {} } = {}
) {
  const pages = new Array(urls.length)
  const nextStart = new Map()
  let next = 0
  let done = 0

  async function waitForHost(url) {
    const host = new URL(url).host
    const now = Date.now()
    const start = Math.max(now, nextStart.get(host) ?? 0)
    nextStart.set(host, start + delay)
    if (start > now) await sleep(start - now)
  }

  async function worker() {
    while (next < urls.length) {
      const i = next++
      await waitForHost(urls[i])
      pages[i] = await auditPage(urls[i], { fetchPage, timeout })
      onProgress(++done, urls.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker))
  return pages
}
