import { mapLimited } from '../../concurrency.js'
import { loadRobots } from '../../robots.js'
import { SOURCES } from '../../sources.js'
import { limit } from '../../text.js'

const GOOGLEBOT = 'Googlebot'
// Most audits touch one or a few hosts, a sitemap index can span many.
const MAX_CONCURRENT = 8
const MAX_SIGNAL = 300

// The crawlers that decide whether a page can be read for an AI search product, each documented by its vendor as
// following robots.txt. The fetchers that act for one user (ChatGPT-User, Claude-User, Perplexity-User) are left out:
// they mostly ignore robots.txt.
const AI_SEARCH = [
  { agent: 'OAI-SearchBot', product: 'ChatGPT search', source: SOURCES.openaiBots },
  { agent: 'Claude-SearchBot', product: 'Claude', source: SOURCES.anthropicBots },
  { agent: 'PerplexityBot', product: 'Perplexity', source: SOURCES.perplexityBots }
]
// Tokens that only say whether the content may train models (Google-Extended also covers grounding Gemini). Blocking
// them is a choice that keeps a site in search, so they are facts, never issues.
const AI_TRAINING = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']

const issue = (fields) => ({ category: 'seo', source: SOURCES.robotsTxt, ...fields })

const words = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`)

// Pages Googlebot may crawl and an AI search crawler may not, one issue per set of crawlers kept out. A page Googlebot
// cannot crawl is already blocked-by-robots. The context names the crawlers, so issues for different sets on one
// origin stay apart where findings are grouped by context, as in the digest.
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
      const agents = words(crawlers.map(({ agent }) => agent))
      return issue({
        type: 'ai-search-blocked',
        severity: 'warning',
        source: crawlers[0].source,
        message:
          `robots.txt does not allow ${agents} to crawl the page, so ` +
          `${words(crawlers.map(({ product }) => product))} cannot use it in answers`,
        context: `${origin}/robots.txt disallows ${agents}`,
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

// The Content-Signal value that applies to every crawler: in the User-agent: * group or before any group, where
// Cloudflare's managed robots.txt writes it. robots-parser does not read it. Null when there is none.
export function contentSignal(text) {
  let agents = null
  let inRules = false
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*/, '')
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    if (key === 'user-agent') {
      // A User-agent line after rules starts a new group, one after another User-agent line joins it.
      if (agents === null || inRules) agents = []
      inRules = false
      agents.push(value.toLowerCase())
    } else {
      inRules = true
      if (key === 'content-signal' && value && (agents === null || agents.includes('*')))
        return limit(value, MAX_SIGNAL)
    }
  }
  return null
}

// Whether each crawler may read the audited pages of an origin: allowed on all of them, blocked on all, or partial.
const access = (robots, pages, agents) =>
  Object.fromEntries(
    agents.map((agent) => {
      const blocked = pages.filter((page) => robots.parser.isDisallowed(page.finalUrl, agent)).length
      return [agent, blocked === 0 ? 'allowed' : blocked === pages.length ? 'blocked' : 'partial']
    })
  )

function originAccess(origin, robots, pages) {
  const robotsTxt = robots?.status ?? 'missing'
  const searchAgents = AI_SEARCH.map(({ agent }) => agent)
  if (robotsTxt === 'missing') {
    const allowed = (agents) => Object.fromEntries(agents.map((agent) => [agent, 'allowed']))
    return { origin, robotsTxt, aiSearch: allowed(searchAgents), aiTraining: allowed(AI_TRAINING), contentSignal: null }
  }
  if (robotsTxt !== 'ok') return { origin, robotsTxt, aiSearch: null, aiTraining: null, contentSignal: null }
  return {
    origin,
    robotsTxt,
    aiSearch: access(robots, pages, searchAgents),
    aiTraining: access(robots, pages, AI_TRAINING),
    contentSignal: contentSignal(robots.text ?? '')
  }
}

// How the robots.txt of each audited origin treats the AI crawlers over the pages audited there, and the
// Content-Signal it declares, so a reader can tell "kept out of AI search" from "opted out of training". The crawler
// lists are null when the file could not be read.
export async function aiCrawlerAccess(pages, { load = loadRobots } = {}) {
  return perOrigin(pages, load, originAccess)
}
