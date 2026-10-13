import { gunzipSync } from 'node:zlib'
import * as cheerio from 'cheerio'
import { request } from '../fetch.js'

// Returns the <loc> values of a <urlset> or a <sitemapindex>, and what a validation of the file needs:
// the number of entries (also those without a <loc>), how many have no <loc> text, and every <lastmod>.
// Nothing is deduplicated or limited here, that is the job of the checks that read it.
export function parseSitemap(xml) {
  const $ = cheerio.load(xml, { xml: true })
  const root = $.root().children().get(0)?.tagName
  const kinds = { urlset: ['urlset > url', 'urlset'], sitemapindex: ['sitemapindex > sitemap', 'index'] }
  if (!kinds[root]) throw new Error(`not a sitemap (root element is ${root ? `<${root}>` : 'missing'})`)
  const [selector, kind] = kinds[root]
  const sitemap = { kind, locs: [], entries: 0, emptyLocs: 0, lastmods: [] }
  for (const el of $(selector).toArray()) {
    sitemap.entries++
    const loc = $(el).children('loc').first().text().trim()
    if (loc) sitemap.locs.push(loc)
    else sitemap.emptyLocs++
    const lastmod = $(el).children('lastmod').first()
    if (lastmod.length) sitemap.lastmods.push({ loc, value: lastmod.text().trim() })
  }
  return sitemap
}

// FetchError carries the bare reason, other errors only a message.
const reason = (err) => err.reason ?? err.message

async function readSitemap(url, { timeout, beforeHop }) {
  const res = await request(url, { timeout, beforeHop, accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' })
  if (res.status !== 200) {
    await res.discard()
    throw new Error(`HTTP ${res.status}`)
  }
  let { bytes } = await res.read(Infinity)
  // A .xml.gz file served as-is, not as Content-Encoding (which fetch already decodes).
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
  // The sitemap protocol requires UTF-8. The limit of 50 MB is on the uncompressed file.
  return { ...parseSitemap(new TextDecoder().decode(bytes)), url, finalUrl: res.finalUrl, bytes: bytes.length }
}

// The facts of one sitemap file that its validation needs, kept before URLs are deduplicated or limited.
const fileFacts = ({ url, finalUrl, kind, bytes, entries, emptyLocs, locs, lastmods }) => ({
  url,
  finalUrl,
  kind,
  bytes,
  entries,
  emptyLocs,
  locs,
  lastmods
})

// URLs listed in a sitemap, and `files` with the facts of every sitemap file that was read. A sitemap index is followed one level deep: child
// sitemaps that fail or are themselves indexes are skipped, not fatal. Throws
// when the sitemap itself cannot be read. `beforeHop` paces the requests, see request().
export async function fromSitemap(url, { timeout, beforeHop } = {}) {
  let sitemap
  try {
    sitemap = await readSitemap(url, { timeout, beforeHop })
  } catch (err) {
    throw new Error(`Could not read sitemap ${url}: ${reason(err)}`, { cause: err })
  }
  const entries = (locs, file) => locs.map((value) => ({ value, source: `sitemap ${file}`, sitemap: file }))
  if (sitemap.kind === 'urlset')
    return { entries: entries(sitemap.locs, url), skipped: [], files: [fileFacts(sitemap)] }

  const result = { entries: [], skipped: [], files: [fileFacts(sitemap)] }
  const recorded = new Set([url])
  for (const child of sitemap.locs) {
    const skip = (why) => result.skipped.push({ input: child, source: `sitemap index ${url}`, reason: why })
    let nested
    try {
      nested = await readSitemap(child, { timeout, beforeHop })
    } catch (err) {
      skip(`could not read sitemap: ${reason(err)}`, { cause: err })
      continue
    }
    // An index that lists itself, or a file listed twice, is one file.
    if (!recorded.has(nested.url)) result.files.push(fileFacts(nested))
    recorded.add(nested.url)
    if (nested.kind === 'index') skip('nested sitemap index (only one level is followed)')
    else for (const entry of entries(nested.locs, child)) result.entries.push(entry)
  }
  return result
}
