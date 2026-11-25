import { checkSite } from '../checks/site/index.js'
import { checkRobotsTxt, originsWithPlatform } from '../checks/site/robots.js'
import { checkSitemapDeclared } from '../checks/site/sitemap.js'
import { cachedRobotsLoader, loadRobots as defaultLoadRobots } from '../robots.js'
import { runAudit } from '../runner.js'

// The site checks that mean something for one page, in the order the CLI runs them: the cross-page checks (only the
// ones about the page itself find anything) and the robots.txt of its origin. The link check and the sitemap
// entries are left out: one asks for every linked page, the other needs a sitemap.
async function onePageSiteChecks(page, load) {
  return [
    ...checkSite([page]),
    ...(await checkRobotsTxt([page], { load })),
    ...(await checkSitemapDeclared([page], { load }))
  ]
}

// Audits one page the way the API does: the page, the site issues about it and `origins`, how its origin treats the
// AI crawlers. `fetchPage` and `loadRobots` make every request, so the API can keep them on public addresses. A page
// that could not be fetched is returned without site checks, the audit fails on it.
/**
 * @param {string} url
 * @param {{ fetchPage?: typeof import('../fetch.js').fetchPage, loadRobots?: typeof defaultLoadRobots }} [options]
 */
export async function auditOnePage(url, { fetchPage, loadRobots = defaultLoadRobots } = {}) {
  const [page] = await runAudit([url], { fetchPage })
  if (page.status === null) return { page, site: [], origins: [] }
  // Each robots.txt is read once for all checks.
  const load = cachedRobotsLoader(loadRobots)
  return { page, site: await onePageSiteChecks(page, load), origins: await originsWithPlatform([page], { load }) }
}
