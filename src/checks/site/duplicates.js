import { pageKey } from '../../input/resolve.js'
import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'

// Pages that declare the same canonical are one page to Google, so sharing a
// title with another member of the group is expected and not reported.
const canonicalGroup = (page) => pageKey(page.facts.canonical ?? page.finalUrl)

// Values (compared case-insensitively) that appear on pages in more than one canonical
// group. `pages` counts final pages, so inputs that redirect to the same page count once.
function shared(pages, valuesOf) {
  const byValue = new Map()
  for (const page of pages) {
    const seen = new Set()
    for (const value of valuesOf(page.facts)) {
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (!byValue.has(key)) byValue.set(key, { value, groups: new Map(), finalUrls: new Set() })
      const { groups, finalUrls } = byValue.get(key)
      const group = canonicalGroup(page)
      groups.set(group, [...(groups.get(group) ?? []), page.url])
      finalUrls.add(pageKey(page.finalUrl))
    }
  }
  return [...byValue.values()]
    .filter(({ groups }) => groups.size > 1)
    .map(({ value, groups, finalUrls }) => ({ value, urls: [...groups.values()].flat(), pages: finalUrls.size }))
}

const RULES = [
  {
    type: 'duplicate-title',
    category: 'seo',
    source: SOURCES.title,
    label: 'title',
    values: (facts) => (facts.title ? [facts.title] : []),
    context: (value) => `<title>${value}</title>`
  },
  {
    type: 'duplicate-description',
    category: 'seo',
    source: SOURCES.snippet,
    label: 'meta description',
    values: (facts) => (facts.description ? [facts.description] : []),
    context: (value) => `<meta name="description" content="${value}">`
  },
  {
    type: 'duplicate-h1',
    category: 'best-practice',
    source: SOURCES.starterGuide,
    label: '<h1>',
    values: (facts) => facts.h1s,
    context: (value) => `<h1>${value}</h1>`
  }
]

// Takes the audited pages (runner results) and reports values shared across pages.
export function checkDuplicates(pages) {
  const audited = pages.filter((page) => page.facts)
  return RULES.flatMap(({ type, category, source, label, values, context }) =>
    shared(audited, values).map(({ value, urls, pages: count }) => ({
      type,
      severity: 'warning',
      category,
      source,
      message: `Same ${label} on ${count} pages`,
      context: truncate(context(value)),
      urls
    }))
  )
}
