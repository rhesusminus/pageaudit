const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// Returns the URL to fetch (fragment removed) and a key that identifies the page:
// the host is lowercased by URL parsing, the query is kept and a trailing slash
// on the path is ignored. Throws with the reason when the input cannot be audited.
export function normalize(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(HAS_SCHEME.test(value) ? 'not a valid URL' : 'not a valid URL (missing http:// or https://)')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported protocol ${parsed.protocol} (only http and https)`)
  }
  parsed.hash = ''
  const url = parsed.href
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1)
  return { url, key: parsed.href }
}

const addListing = (listings = [], listing) =>
  listings.some((l) => l.sitemap === listing.sitemap && l.url === listing.url) ? listings : [...listings, listing]

// Merges entries from every input, in order, into a deduplicated URL list. The
// first spelling of a page wins. Rejected inputs are returned with the reason.
// `listed` maps each kept URL to where a sitemap listed it, as { sitemap, url } with the
// spelling that sitemap used, also when the first spelling came from another input.
export function resolveUrls(entries, { limit = Infinity } = {}) {
  const seen = new Map()
  const sitemaps = new Map()
  const urls = []
  const skipped = []
  for (const { value, source, sitemap } of entries) {
    let normalized
    try {
      normalized = normalize(value)
    } catch (err) {
      skipped.push({ input: value, source, reason: err.message })
      continue
    }
    if (sitemap)
      sitemaps.set(normalized.key, addListing(sitemaps.get(normalized.key), { sitemap, url: normalized.url }))
    if (seen.has(normalized.key)) continue
    seen.set(normalized.key, normalized.url)
    urls.push(normalized.url)
  }
  const listed = new Map([...seen].filter(([key]) => sitemaps.has(key)).map(([key, url]) => [url, sitemaps.get(key)]))
  return { urls: urls.slice(0, limit), skipped, total: urls.length, listed }
}

// The deduplication key of a URL, or the URL itself when it cannot be normalized.
export function pageKey(url) {
  try {
    return normalize(url).key
  } catch {
    return url
  }
}
