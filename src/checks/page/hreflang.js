import { pageKey } from '../../input/resolve.js'
import { SOURCES } from '../../sources.js'
import { evidence, selectorFor } from '../evidence.js'
import { seoIssue } from '../snippet.js'
import { ABSOLUTE_URL, canonicalLinks } from './meta.js'
import { absolute, baseUrl, hreflangLinks } from './signals.js'

// A language tag as Google and browsers read it: a language, an optional script and an optional country or
// numeric region (es-419). Lenient on purpose: only codes that are clearly wrong are flagged.
const SHAPE = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|\d{3}))?$/i
const X_DEFAULT = 'x-default'
const names = (type) => new Intl.DisplayNames('en', { type, fallback: 'none' })
const LANGUAGES = names('language')
const SCRIPTS = names('script')
const REGIONS = names('region')
// Codes Intl knows that are not regions of a language: the European Union and UN groupings and the unknown region.
const NOT_REGIONS = new Set(['EU', 'EZ', 'UN', 'QO', 'ZZ'])

const known = (display, code) => {
  try {
    return display.of(code) !== undefined
  } catch {
    return false
  }
}

// A three-letter code that has a two-letter one, such as fin for fi, is not what Google reads.
const validLanguage = (language) =>
  known(LANGUAGES, language) && (language.length === 2 || Intl.getCanonicalLocales(language)[0].length > 2)

// A reserved alias such as UK stands for GB in Intl, but it is not a region code.
function validRegion(region) {
  const upper = region.toUpperCase()
  if (NOT_REGIONS.has(upper) || !known(REGIONS, upper)) return false
  return new Intl.Locale(`und-${upper}`).region === upper
}

export function validHreflang(value) {
  if (value.toLowerCase() === X_DEFAULT) return true
  const match = SHAPE.exec(value)
  if (!match) return false
  const [, language, script, region] = match
  if (!validLanguage(language.toLowerCase())) return false
  if (script && !known(SCRIPTS, script)) return false
  return !region || validRegion(region)
}

const attr = ($, el, name) => ($(el).attr(name) ?? '').trim()
// The page an href names, so /fr/ and https://example.com/fr/ count as the same. `base` is undefined when the
// page address is unknown, then only absolute hrefs resolve.
const target = ($, el, base) => {
  const href = attr($, el, 'href')
  return pageKey(absolute(href, base) ?? href)
}

const hreflangIssue = (issue) => seoIssue({ severity: 'warning', source: SOURCES.hreflang, ...issue })

function linkIssues($, el) {
  const lang = attr($, el, 'hreflang')
  const href = attr($, el, 'href')
  const context = $.html(el)
  const found = evidence($, el)
  const issues = []
  if (!validHreflang(lang)) {
    issues.push({
      type: 'invalid-hreflang',
      message: `Hreflang value "${lang}" is not a valid language or region code`,
      context,
      actual: lang,
      expected: 'a language code such as en, optionally with a region such as en-GB, or x-default',
      ...found
    })
  }
  if (!ABSOLUTE_URL.test(href)) {
    issues.push({
      type: 'relative-hreflang',
      message: href ? 'Hreflang URL is relative (Google requires absolute URLs)' : 'Hreflang link has no href',
      context,
      actual: href,
      expected: 'an absolute URL such as https://example.com/en/page',
      ...found
    })
  }
  return issues
}

// One issue per language declared more than once. Repeating the same page is redundant, two pages for one language conflict.
function duplicateIssues($, links, base) {
  const byLang = Map.groupBy(links, (el) => attr($, el, 'hreflang').toLowerCase())
  return [...byLang]
    .filter(([lang, els]) => lang && els.length > 1)
    .map(([lang, els]) => {
      const identical = new Set(els.map((el) => target($, el, base))).size === 1
      return {
        type: 'duplicate-hreflang',
        severity: identical ? 'info' : 'warning',
        message: identical
          ? `Hreflang "${lang}" is declared ${els.length} times with the same URL (redundant)`
          : `Hreflang "${lang}" is declared ${els.length} times with different URLs (conflicting)`,
        context: els.map((el) => $.html(el)).join(' '),
        selector: els.map((el) => selectorFor($, el)).join(', ')
      }
    })
}

// Each language version has to list itself too. The canonical address counts as the page itself.
function missingSelfIssue($, links, url, base) {
  const own = new Set([pageKey(url)])
  const canonical = canonicalLinks($).find((el) => attr($, el, 'href'))
  if (canonical) own.add(target($, canonical, base))
  if (links.some((el) => own.has(target($, el, base)))) return []
  return [
    {
      type: 'missing-self-hreflang',
      message: 'Hreflang links do not include this page itself',
      context: url,
      expected: 'a <link rel="alternate" hreflang> pointing to this page'
    }
  ]
}

function missingXDefaultIssue($, links) {
  const langs = links.map((el) => attr($, el, 'hreflang').toLowerCase())
  if (langs.includes(X_DEFAULT)) return []
  return [
    {
      type: 'missing-x-default',
      severity: 'info',
      message: 'Hreflang links have no x-default fallback',
      context: '<head>',
      expected: '<link rel="alternate" hreflang="x-default" href="...">'
    }
  ]
}

// Only <link> declarations in <head> are read. Pages that declare no alternates are not asked to have any.
export function checkHreflang($, page = {}) {
  const links = hreflangLinks($)
  if (links.length === 0) return []
  const base = page.url && baseUrl($, page.url)
  return [
    ...links.flatMap((el) => linkIssues($, el)),
    ...duplicateIssues($, links, base),
    ...(page.url ? missingSelfIssue($, links, page.url, base) : []),
    ...missingXDefaultIssue($, links)
  ].map(hreflangIssue)
}
