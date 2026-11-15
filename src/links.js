import { pageCanonical } from './checks/page/index.js'
import { hostThrottle, mapLimited } from './concurrency.js'
import { DEFAULT_TIMEOUT_MS, request as defaultRequest, readHtml } from './fetch.js'
import { withoutFragment } from './input/resolve.js'
import { parse } from './parse.js'
import { DEFAULT_CONCURRENCY, DEFAULT_DELAY_MS, linksUnread } from './runner.js'

// Most internal links are the same navigation on every page, so this covers a large site. Past it the targets linked
// from the fewest pages are left unchecked.
export const MAX_LINK_CHECKS = 500

// Every internal link target of the audited pages with the pages that link to it, most linked first.
export function linkTargets(pages) {
  const from = new Map()
  for (const page of pages) {
    for (const url of page.links ?? []) {
      if (!from.has(url)) from.set(url, [])
      from.get(url).push(page.url)
    }
  }
  return [...from].map(([url, pages]) => ({ url, from: pages })).sort((a, b) => b.from.length - a.from.length)
}

// What the audit already knows about a URL, so a link to an audited page costs no request. Its canonical is the one in
// its facts. An address that
// redirected is known under the URL it was given as, and the page it ended on under its final URL, which can carry
// the fragment of a redirect location.
function auditedOutcomes(pages) {
  const known = new Map()
  for (const page of pages) {
    if (page.finalUrl === null) {
      known.set(page.url, { failed: 'the page could not be fetched, see its fetch-failed issue' })
      continue
    }
    const canonical = page.facts?.canonical ?? null
    known.set(page.url, { status: page.status, finalUrl: page.finalUrl, redirects: page.redirects, canonical })
    const finalUrl = withoutFragment(page.finalUrl)
    if (!known.has(finalUrl)) {
      known.set(finalUrl, { status: page.status, finalUrl: page.finalUrl, redirects: [], canonical })
    }
  }
  return known
}

// The canonical of a link target that answered with HTML, read like an audited page's, or null. A target that
// redirected is reported as a redirect, so its body is not read. A body that fails to arrive throws: the target did not
// load, like one whose request failed, and its canonical was not checked.
async function targetCanonical(res) {
  if (res.redirects.length) {
    await res.discard()
    return null
  }
  const body = await readHtml(res)
  return body && pageCanonical(parse(body.html), res.finalUrl)
}

// A GET, not a HEAD: many servers answer HEAD with 404 or 405 for pages that work. Only an HTML body is read, for its
// canonical, so the request count stays the same. HTML is asked for first, like a browser does, so a server that picks
// the format by the Accept header answers with the page an audit would see, and any other file still loads.
const TARGET_ACCEPT = 'text/html,application/xhtml+xml,*/*;q=0.8'

async function fetchOutcome(url, { request, timeout, beforeHop }) {
  try {
    const res = await request(url, { accept: TARGET_ACCEPT, timeout, beforeHop })
    return {
      status: res.status,
      finalUrl: res.finalUrl,
      redirects: res.redirects,
      canonical: await targetCanonical(res)
    }
  } catch (err) {
    return { failed: err.reason ?? err.message }
  }
}

// Finds out where every internal link target leads: { status, finalUrl, redirects, canonical } or { failed: reason },
// by URL. canonical is the target's canonical URL, null when it has none or did not answer with HTML.
// Requests use the same concurrency as the audit, and `pace(url)`, the per-host spacing the whole run shares, is
// awaited before each of them, redirect hops included.
// `checked` counts the targets requested, `unchecked` the ones past `max`, and `unread` the audited pages whose own
// links could not all be read.
export async function checkLinkTargets(
  pages,
  {
    request = defaultRequest,
    concurrency = DEFAULT_CONCURRENCY,
    pace = hostThrottle(DEFAULT_DELAY_MS),
    timeout = DEFAULT_TIMEOUT_MS,
    max = MAX_LINK_CHECKS,
    onProgress = () => {}
  } = {}
) {
  const outcomes = auditedOutcomes(pages)
  const unknown = linkTargets(pages).filter(({ url }) => !outcomes.has(url))
  const checked = unknown.slice(0, max)
  let done = 0
  const results = await mapLimited(checked, concurrency, async ({ url }) => {
    const outcome = await fetchOutcome(url, { request, timeout, beforeHop: pace })
    onProgress(++done, checked.length)
    return outcome
  })
  for (const [i, { url }] of checked.entries()) outcomes.set(url, results[i])
  return {
    outcomes,
    checked: checked.length,
    unchecked: unknown.length - checked.length,
    unread: pages.filter(linksUnread).length
  }
}

// An outcome that leaves open where a link leads, or which links an audited page has: a failed request, or a 429 or
// 5xx answer.
const unresolved = (outcome) => Boolean(outcome.failed) || outcome.status === 429 || outcome.status >= 500

// True when every link of every audited page is known and was followed to a known destination. Every audited page is
// an outcome too, so a page that could not be fetched or answered with a server error, whose links the audit never
// saw, makes it false. So does a page whose HTML the checks could not process, or whose HTML was cut at 2 MB, as its
// links were never read, or not all of them.
export const linksComplete = ({ outcomes, unchecked, unread }) =>
  unchecked === 0 && unread === 0 && ![...outcomes.values()].some(unresolved)
