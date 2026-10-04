import { pageKey } from '../../input/resolve.js'
import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'

// Pages whose canonical names another URL. Often intentional (parameters,
// syndicated copies), so this is informational. Inputs that redirect to the
// same final page are reported once, together.
export function checkCanonicalTargets(pages) {
  const byFinalUrl = new Map()
  for (const page of pages) {
    const { facts, finalUrl } = page
    if (!facts?.canonical || pageKey(facts.canonical) === pageKey(finalUrl)) continue
    const key = pageKey(finalUrl)
    if (!byFinalUrl.has(key)) byFinalUrl.set(key, { canonical: facts.canonical, urls: [] })
    byFinalUrl.get(key).urls.push(page.url)
  }
  return [...byFinalUrl.values()].map(({ canonical, urls }) => ({
    type: 'canonical-elsewhere',
    severity: 'info',
    category: 'seo',
    source: SOURCES.canonical,
    message: 'Canonical points to a different URL',
    context: truncate(canonical),
    urls
  }))
}
