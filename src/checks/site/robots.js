import { mapLimited } from '../../concurrency.js'
import { loadRobots } from '../../robots.js'
import { SOURCES } from '../../sources.js'

const GOOGLEBOT = 'Googlebot'
// Most audits touch one or a few hosts, a sitemap index can span many.
const MAX_CONCURRENT = 8

// The crawlers that decide whether a page can be read for an AI search product, each documented by its vendor as
// following robots.txt. The fetchers that act for one user (ChatGPT-User, Claude-User, Perplexity-User) are left out:
// they mostly ignore robots.txt.
const AI_SEARCH = [
  { agent: 'OAI-SearchBot', product: 'ChatGPT search', source: SOURCES.openaiBots },
  { agent: 'Claude-SearchBot', product: 'Claude', source: SOURCES.anthropicBots },
  { agent: 'PerplexityBot', product: 'Perplexity', source: SOURCES.perplexityBots }
]

const issue = (fields) => ({ category: 'seo', source: SOURCES.robotsTxt, ...fields })

const words = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`)

// Pages Googlebot may crawl and an AI search crawler may not, one issue per set of crawlers kept out. A page Googlebot
// cannot crawl is already blocked-by-robots.
function aiSearchBlocked(origin, robots, pages) {
  const blockedFor = (page) => AI_SEARCH.filter(({ agent }) => robots.parser.isDisallowed(page.finalUrl, agent))
  const groups = Map.groupBy(
    pages.filter((page) => !robots.parser.isDisallowed(page.finalUrl, GOOGLEBOT)),
    (page) =>
      blockedFor(page)
        .map(({ agent }) => agent)
        .join(', ')
  )
  return [...groups]
    .filter(([agents]) => agents)
    .map(([, group]) => {
      const crawlers = blockedFor(group[0])
      return issue({
        type: 'ai-search-blocked',
        severity: 'warning',
        source: crawlers[0].source,
        message:
          `robots.txt does not allow ${words(crawlers.map(({ agent }) => agent))} to crawl the page, so ` +
          `${words(crawlers.map(({ product }) => product))} cannot use it in answers`,
        context: `${origin}/robots.txt`,
        urls: group.map((page) => page.url)
      })
    })
}

function checkOrigin(origin, robots, pages) {
  if (robots?.status === 'failed') {
    return [
      issue({
        type: 'robots-txt-failed',
        severity: 'info',
        message: `robots.txt could not be fetched (${robots.reason}), so the pages were not checked against it`,
        context: `${origin}/robots.txt`,
        urls: pages.map((page) => page.url)
      })
    ]
  }
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
  return [
    ...(blocked.length
      ? [
          issue({
            type: 'blocked-by-robots',
            severity: 'warning',
            message: 'robots.txt does not allow Googlebot to crawl the page, which was audited anyway',
            context: `${origin}/robots.txt`,
            urls: blocked.map((page) => page.url)
          })
        ]
      : []),
    ...aiSearchBlocked(origin, robots, pages)
  ]
}

// The pages that loaded, by the origin they ended up on: only that origin's robots.txt is read, a Disallow on the
// origin a page was redirected from is not checked.
const loadedByOrigin = (pages) =>
  Map.groupBy(
    pages.filter((p) => p.status === 200 && p.finalUrl),
    (page) => new URL(page.finalUrl).origin
  )

// Reads the robots.txt of every audited origin once, at the same time, so one slow host does not hold up the rest.
const perOrigin = (pages, load, fn) =>
  mapLimited([...loadedByOrigin(pages)], MAX_CONCURRENT, async ([origin, group]) =>
    fn(origin, await load(origin), group)
  )

// Reads the robots.txt of every origin that was audited, once, and reports the pages it blocks.
// Pages are audited whatever robots.txt says, the audit is run by the owner of the site.
export async function checkRobotsTxt(pages, { load = loadRobots } = {}) {
  return (await perOrigin(pages, load, checkOrigin)).flat()
}
