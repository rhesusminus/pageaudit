import { pageKey } from '../../input/resolve.js'
import { linkTargets } from '../../links.js'
import { SOURCES } from '../../sources.js'
import { limit, MAX_URL } from '../../text.js'
import { truncate } from '../snippet.js'

// Login areas answer 401 or 403 to a visitor who is not signed in, and 407 is about a proxy. None of them means the
// page is gone.
const NOT_BROKEN = new Set([401, 403, 407])

const siteIssue = ({ type, severity, source, message, context, urls }) => ({
  type,
  severity,
  category: 'seo',
  source,
  message,
  context,
  urls
})

// The context of a link issue is made of addresses, and the final address of a redirect is what the link should be
// changed to, so each address is kept whole up to the URL cap instead of cutting the context at 120 characters.
const address = (url) => limit(url, MAX_URL)

// The issue a link target gets, or null when the link is fine. A redirect that ends on an error is the error.
function targetIssue(url, outcome) {
  if (outcome.failed) {
    return { type: 'link-target-unreachable', context: `${address(url)} (${truncate(outcome.failed)})` }
  }
  const { status, finalUrl, redirects } = outcome
  const where = redirects.length ? `${address(url)} -> ${address(finalUrl)}` : address(url)
  if (status === 429 || status >= 500) return { type: 'link-target-unreachable', context: `${where} (HTTP ${status})` }
  if (status >= 400 && !NOT_BROKEN.has(status)) return { type: 'broken-link', context: `${where} (HTTP ${status})` }
  // Every hop's status, so a chain of redirects reads as one: (301, 302).
  const hops = redirects.map((redirect) => redirect.status).join(', ')
  if (redirects.length && status < 400) return { type: 'link-to-redirect', context: `${where} (${hops})` }
  return null
}

const TARGET_RULES = {
  'broken-link': {
    severity: 'warning',
    source: SOURCES.links,
    message: 'An internal link points to a page that answers with an error'
  },
  'link-target-unreachable': {
    severity: 'info',
    source: SOURCES.links,
    message: 'An internal link target did not load (server error, rate limit or timeout), which can be temporary'
  },
  'link-to-redirect': {
    severity: 'info',
    source: SOURCES.redirects,
    message: 'An internal link points to an address that redirects, link to the final address instead'
  }
}

// One issue per link target that is broken, unreachable or redirects, listing the audited pages that link to it.
// Targets without an outcome were not checked.
function targetIssues(pages, outcomes) {
  return linkTargets(pages).flatMap(({ url, from }) => {
    const outcome = outcomes.get(url)
    const found = outcome && targetIssue(url, outcome)
    if (!found) return []
    return [siteIssue({ type: found.type, ...TARGET_RULES[found.type], context: found.context, urls: from })]
  })
}

// The pages each page is linked from, both by the key of their final URL. Only verified destinations count: a link
// reaches the page its request ended on, so a broken /x/ is not a link to a working /x.
function inboundLinks(pages, outcomes) {
  const inbound = new Map()
  for (const page of pages.filter((p) => p.links)) {
    const source = pageKey(page.finalUrl)
    for (const url of page.links) {
      const outcome = outcomes.get(url)
      if (!outcome || outcome.failed || outcome.status >= 400) continue
      const key = pageKey(outcome.finalUrl)
      if (!inbound.has(key)) inbound.set(key, new Set())
      inbound.get(key).add(source)
    }
  }
  return inbound
}

// Sitemap pages that no other audited page links to. Only meaningful when the audit covered the whole sitemap and
// every link target has an outcome. The home page is left out, it is reached by its address.
function orphanIssues(pages, outcomes, listed) {
  const inbound = inboundLinks(pages, outcomes)
  const linkedFromElsewhere = (page) => {
    const self = pageKey(page.finalUrl)
    return [...(inbound.get(self) ?? [])].some((source) => source !== self)
  }
  const orphans = pages.filter(
    (page) =>
      page.facts && listed.has(page.url) && new URL(page.finalUrl).pathname !== '/' && !linkedFromElsewhere(page)
  )
  if (!orphans.length) return []
  return [
    siteIssue({
      type: 'orphan-page',
      severity: 'info',
      source: SOURCES.links,
      message:
        'No other audited page links to these sitemap pages, so visitors and Google can only find them through the sitemap',
      context: `${orphans.length} of ${pages.filter((page) => listed.has(page.url)).length} sitemap pages`,
      urls: orphans.map((page) => page.url)
    })
  ]
}

// Issues about the internal links of the audited pages, from the outcomes of checkLinkTargets. `orphans` turns on
// the orphan check, for an audit of a whole sitemap. `listed` holds the URLs the sitemaps list.
export function checkLinks(pages, outcomes, { orphans = false, listed = new Map() } = {}) {
  return [...targetIssues(pages, outcomes), ...(orphans ? orphanIssues(pages, outcomes, listed) : [])]
}
