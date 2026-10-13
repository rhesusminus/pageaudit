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

// Google rejects a sitemap file that is larger than 50 MB uncompressed, so nothing past that is read.
const MAX_BYTES = 52_428_800
const TOO_LARGE = 'sitemap is larger than 50 MB uncompressed, Google does not accept it'

// True for a gzip file: a .xml.gz served as-is, not as Content-Encoding (which fetch already decodes).
const gzipped = (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b

// Gzip can make a file larger: data it cannot compress, or a file packed with level 0, grows by 5 bytes per 64 KiB
// block, about 4 KiB at 50 MB. A compressed file larger than the limit plus this is larger than the limit unpacked.
const GZIP_SLACK = 1024 * 1024

// The uncompressed body of a sitemap, or null when it is larger than MAX_BYTES. A gzipped file whose compressed
// size is over the limit and GZIP_SLACK is taken as too large without unpacking it.
async function sitemapBytes(res) {
  const { bytes, truncated } = await res.read((head) => (gzipped(head) ? MAX_BYTES + GZIP_SLACK : MAX_BYTES))
  if (truncated) return null
  if (!gzipped(bytes)) return bytes
  try {
    return gunzipSync(bytes, { maxOutputLength: MAX_BYTES })
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE') return null
    throw err
  }
}

// A file that is too large is not parsed, Google ignores all of it, so it lists nothing.
async function readSitemap(url, { timeout, beforeHop }) {
  const res = await request(url, { timeout, beforeHop, accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' })
  if (res.status !== 200) {
    await res.discard()
    throw new Error(`HTTP ${res.status}`)
  }
  const bytes = await sitemapBytes(res)
  const file = { url, finalUrl: res.finalUrl, tooLarge: bytes === null }
  if (file.tooLarge) return { ...file, kind: null, locs: [], entries: 0, emptyLocs: 0, lastmods: [] }
  // The sitemap protocol requires UTF-8.
  return { ...parseSitemap(new TextDecoder().decode(bytes)), ...file }
}

// The facts of one sitemap file that its validation needs, kept before URLs are deduplicated or limited.
const fileFacts = ({ url, finalUrl, kind, tooLarge, entries, emptyLocs, locs, lastmods }) => ({
  url,
  finalUrl,
  kind,
  tooLarge,
  entries,
  emptyLocs,
  locs,
  lastmods
})

// URLs listed in a sitemap, and `files` with the facts of every sitemap file that was read. A sitemap index is followed one level deep: child
// sitemaps that fail or are themselves indexes are skipped, not fatal. A file that is too large is skipped too, also
// the sitemap itself, but its facts are kept so it is still reported. Throws
// when the sitemap itself cannot be read. `beforeHop` paces the requests, see request().
export async function fromSitemap(url, { timeout, beforeHop } = {}) {
  let sitemap
  try {
    sitemap = await readSitemap(url, { timeout, beforeHop })
  } catch (err) {
    throw new Error(`Could not read sitemap ${url}: ${reason(err)}`, { cause: err })
  }
  if (sitemap.tooLarge)
    return {
      entries: [],
      skipped: [{ input: url, source: '--sitemap', reason: TOO_LARGE }],
      files: [fileFacts(sitemap)]
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
    if (nested.tooLarge) skip(TOO_LARGE)
    else if (nested.kind === 'index') skip('nested sitemap index (only one level is followed)')
    else for (const entry of entries(nested.locs, child)) result.entries.push(entry)
  }
  return result
}
