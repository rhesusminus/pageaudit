import { collapseWhitespace, limit } from '../../text.js'

const MAX_TEXT = 120

// Relative asset addresses resolve against a placeholder, only their host and path are compared.
const PLACEHOLDER = 'https://page.invalid/'

// Only links that load a file count: a rel="author" or rel="me" link to a page on squarespace.com says nothing about
// the platform of this page.
const ASSETS = ['stylesheet', 'preload', 'modulepreload', 'icon'].map((rel) => `link[rel~="${rel}" i][href]`).join(', ')

// The scripts, stylesheets, preloads and icons a page loads, as URLs. An address that does not parse is left out.
const assetUrls = ($) =>
  $(`script[src], ${ASSETS}`)
    .toArray()
    .flatMap((el) => {
      try {
        return [new URL(($(el).attr('src') ?? $(el).attr('href')).trim(), PLACEHOLDER)]
      } catch {
        return []
      }
    })

const onHost = (url, hosts) => hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))

const clean = (text) => (typeof text === 'string' && limit(collapseWhitespace(text), MAX_TEXT)) || null

// Far longer than the theme object Shopify writes, so a script that only looks like one is not read to its end.
const MAX_THEME_JSON = 10_000

// The object assigned to Shopify.theme, or null. It is read up to each closing brace in turn until it parses, so a
// brace or semicolon inside a quoted theme name does not cut it short and line breaks do not matter.
function shopifyThemeObject(inline) {
  const start = inline.search(/\bShopify\.theme\s*=\s*\{/)
  if (start < 0) return null
  const text = inline.slice(inline.indexOf('{', start)).slice(0, MAX_THEME_JSON)
  for (let end = text.indexOf('}'); end >= 0; end = text.indexOf('}', end + 1)) {
    try {
      return JSON.parse(text.slice(0, end + 1))
    } catch {
      // Not the end of the object yet, or not JSON at all.
    }
  }
  return null
}

// Every Shopify storefront writes Shopify.theme, such as {"name":"Copy of Dawn","schema_name":"Dawn"}. schema_name is
// the theme the shop started from, the name is whatever the shop called its copy.
const shopifyTheme = (page) => clean(shopifyThemeObject(page.inline)?.schema_name)

// The folder of the first theme a WordPress page loads a file from, the theme's slug. WordPress may be installed in a
// subfolder such as /blog/, so the folders are found anywhere in the path.
const wordPressTheme = (page) =>
  clean(page.assets.map((url) => url.pathname.match(/\/wp-content\/themes\/([^/]+)\//)?.[1]).find(Boolean) ?? null)

// What each platform leaves in the HTML it serves, in the order they are tried. Shopify's markers are only on its own
// storefronts: the Buy Button that other sites embed loads from sdks.shopifycdn.com, not cdn.shopify.com.
const PLATFORMS = [
  {
    name: 'Shopify',
    found: (page) =>
      /\bShopify\.(?:theme|shop)\s*=/.test(page.inline) ||
      page.assets.some((url) => onHost(url, ['cdn.shopify.com']) || url.pathname.startsWith('/cdn/shop/')),
    theme: shopifyTheme
  },
  {
    name: 'WordPress',
    // Security plugins often remove the generator tag, the files under /wp-content/ and /wp-includes/ stay.
    found: (page) =>
      page.generators.some((value) => value.startsWith('wordpress')) ||
      page.assets.some((url) => /\/wp-(?:content|includes)\//.test(url.pathname)),
    theme: wordPressTheme
  },
  {
    name: 'Wix',
    found: (page) =>
      page.generators.some((value) => value.startsWith('wix.com')) ||
      page.assets.some((url) => onHost(url, ['wixstatic.com', 'parastorage.com']))
  },
  {
    name: 'Squarespace',
    found: (page) => page.assets.some((url) => onHost(url, ['squarespace.com']))
  },
  {
    name: 'Webflow',
    found: (page) =>
      page.generators.some((value) => value.startsWith('webflow')) ||
      page.$('html[data-wf-site]').length > 0 ||
      page.assets.some((url) => onHost(url, ['website-files.com']))
  }
]

// The script types a browser runs. JSON-LD and templates are data, a product description in them may mention Shopify.
const JAVASCRIPT = /^(?:|module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i

// The shop or site builder a page runs on as { name, theme }, or null when it is none of the ones pageaudit knows.
// theme is null when the platform does not say. Read from the HTML as served, so a site that hides its platform
// is not found.
export function pagePlatform($) {
  const page = {
    $,
    generators: $('meta[name="generator" i]')
      .toArray()
      .map((el) => collapseWhitespace($(el).attr('content') ?? '').toLowerCase()),
    assets: assetUrls($),
    inline: $('script:not([src])')
      .toArray()
      .filter((el) => JAVASCRIPT.test(($(el).attr('type') ?? '').trim()))
      .map((el) => $(el).text())
      .join('\n')
  }
  const platform = PLATFORMS.find(({ found }) => found(page))
  return platform ? { name: platform.name, theme: platform.theme?.(page) ?? null } : null
}

// The most common of `values`, the first one seen on a tie, or undefined when there are none.
function mostCommon(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let top
  for (const [value, count] of counts) if (top === undefined || count > counts.get(top)) top = value
  return top
}

// The platform found on most of the loaded pages of an origin, with the theme most of those pages name, the first one
// seen on a tie. Null when no page shows a platform. A page that names no theme still counts for its platform. Pages
// count by their final URL, like the robots.txt of an origin does, see loadedByOrigin() in robots.js.
export function originPlatform(pages, origin) {
  const found = pages
    .filter((page) => page.facts?.platform && page.status === 200 && new URL(page.finalUrl).origin === origin)
    .map((page) => page.facts.platform)
  const name = mostCommon(found.map((platform) => platform.name))
  if (name === undefined) return null
  const themes = found.filter((platform) => platform.name === name && platform.theme).map((platform) => platform.theme)
  return { name, theme: mostCommon(themes) ?? null }
}
