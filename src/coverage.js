import pkg from '../package.json' with { type: 'json' }
import { linksComplete } from './links.js'
import { DEFAULT_CONCURRENCY, DEFAULT_DELAY_MS } from './runner.js'

// Why orphan pages cannot be told apart, or null when they can. That needs the audit to have followed every link of
// a whole sitemap: without a sitemap there is no list of pages that should be linked, and with a --limit cut, a
// sitemap file that was not read or a link whose destination is unknown, linked pages would look orphaned.
export function orphansSkipped(options, inputs, links) {
  if (!options.sitemaps.length) return 'needs a --sitemap, the list of pages that should be linked'
  if (!inputs.sitemapsComplete) return 'a sitemap file could not be read, so pages may be missing from the list'
  if (inputs.urls.length !== inputs.total) return `only ${inputs.urls.length} of ${inputs.total} URLs were audited`
  if (links.unchecked) {
    return `checked ${links.checked} link targets, ${links.unchecked} linked from fewer pages were not checked`
  }
  if (!linksComplete(links)) return 'where some links lead, or which links some pages have, is not known'
  return null
}

// What the audit looked at and what it left out, so a reader of the report can tell "not found" from "not looked
// for". `links` is the outcome of the link checks, undefined without --check-links, and `lighthouseRan` whether
// Lighthouse was tried on any page. The settings say what was asked for, notRun what did not happen.
export function buildCoverage(options, inputs, { links, lighthouseRan = false } = {}) {
  const lighthouse = Boolean(options.lighthouse) || inputs.marked.length > 0
  const notRun = []
  if (!lighthouse) notRun.push({ check: 'lighthouse', reason: 'not asked for (--lighthouse or --lighthouse-page)' })
  else if (!lighthouseRan) notRun.push({ check: 'lighthouse', reason: 'no page it was asked for returned HTML' })
  if (!links) notRun.push({ check: 'links', reason: 'not asked for (--check-links)' })
  const orphans = links && orphansSkipped(options, inputs, links)
  if (orphans) notRun.push({ check: 'orphan-page', reason: orphans })
  return {
    tool: { name: pkg.name, version: pkg.version },
    settings: {
      limit: options.limit ?? null,
      concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
      delay: options.delay ?? DEFAULT_DELAY_MS,
      sitemaps: [...new Set(options.sitemaps)],
      lighthouse: Boolean(options.lighthouse),
      lighthousePages: inputs.marked.length,
      lighthouseRuns: lighthouse ? (options.lighthouseRuns ?? 1) : null,
      checkLinks: Boolean(links)
    },
    urls: {
      found: inputs.total,
      audited: inputs.urls.length,
      ...(options.sitemaps.length ? { sitemapsComplete: inputs.sitemapsComplete } : {})
    },
    ...(links ? { links: { checked: links.checked, unchecked: links.unchecked, complete: linksComplete(links) } } : {}),
    notRun
  }
}
