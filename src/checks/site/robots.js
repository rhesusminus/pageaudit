import { loadRobots } from '../../robots.js'
import { SOURCES } from '../../sources.js'

const GOOGLEBOT = 'Googlebot'
// Most audits touch one or a few hosts, a sitemap index can span many.
const MAX_CONCURRENT = 8

const issue = (fields) => ({ category: 'seo', source: SOURCES.robotsTxt, ...fields })

function checkOrigin(origin, robots, pages) {
  if (robots?.status === 'unreachable') {
    return [
      issue({
        type: 'robots-txt-unreachable',
        severity: 'info',
        message: `robots.txt answered HTTP ${robots.code}, Google pauses crawling the site while it cannot read it`,
        context: `${origin}/robots.txt`,
        urls: pages.map((page) => page.url)
      })
    ]
  }
  if (robots?.status !== 'ok') return []
  const blocked = pages.filter((page) => robots.parser.isDisallowed(page.finalUrl, GOOGLEBOT))
  if (!blocked.length) return []
  return [
    issue({
      type: 'blocked-by-robots',
      severity: 'warning',
      message: 'robots.txt does not allow Googlebot to crawl the page, which was audited anyway',
      context: `${origin}/robots.txt`,
      urls: blocked.map((page) => page.url)
    })
  ]
}

// Reads the robots.txt of every origin that was audited, once, and reports the pages it blocks.
// Only the origin the page ended up on is read, a Disallow on the origin it was redirected from is not checked.
// Pages are audited whatever robots.txt says, the audit is run by the owner of the site.
export async function checkRobotsTxt(pages, { load = loadRobots } = {}) {
  const byOrigin = new Map()
  for (const page of pages.filter((p) => p.status === 200 && p.finalUrl)) {
    const origin = new URL(page.finalUrl).origin
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), page])
  }
  // The origins are read at the same time, one slow host should not hold up the rest.
  const origins = [...byOrigin]
  const checked = new Array(origins.length)
  let next = 0
  async function worker() {
    while (next < origins.length) {
      const i = next++
      const [origin, group] = origins[i]
      checked[i] = checkOrigin(origin, await load(origin), group)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, origins.length) }, worker))
  return checked.flat()
}
