import { loadRobots } from '../../robots.js'
import { SOURCES } from '../../sources.js'

const GOOGLEBOT = 'Googlebot'

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
// Pages are audited whatever robots.txt says, the audit is run by the owner of the site.
export async function checkRobotsTxt(pages, { load = loadRobots } = {}) {
  const byOrigin = new Map()
  for (const page of pages.filter((p) => p.status === 200 && p.finalUrl)) {
    const origin = new URL(page.finalUrl).origin
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), page])
  }
  const issues = []
  for (const [origin, group] of byOrigin) issues.push(...checkOrigin(origin, await load(origin), group))
  return issues
}
