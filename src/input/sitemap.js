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

// Reads a sitemap file once per `cache`, which maps every address a file was requested at, or redirected to, to its
// read, also a failed one. `fresh` is false for a file read before, whose facts are kept already.
async function readOnce(url, { cache, timeout, beforeHop }) {
  if (cache.has(url)) return { file: await cache.get(url), fresh: false }
  const read = readSitemap(url, { timeout, beforeHop })
  cache.set(url, read)
  const file = await read
  // A file is only known by its final address once it is read, so an address that redirects to a file read before
  // still costs its requests, but the file is not counted twice.
  if (cache.has(file.finalUrl) && file.finalUrl !== url) return { file: await cache.get(file.finalUrl), fresh: false }
  cache.set(file.finalUrl, read)
  return { file, fresh: true }
}

const entries = (locs, file) => locs.map((value) => ({ value, source: `sitemap ${file}`, sitemap: file }))

// Adds the entries of every child of an index to `result`. A child that fails, is too large or is itself an index is
// skipped. A child listed twice, or the index itself, is followed once.
async function followIndex(index, result, options) {
  const followed = new Set([index.url, index.finalUrl])
  for (const child of index.locs) {
    if (followed.has(child)) continue
    followed.add(child)
    const skip = (why) => result.skipped.push({ input: child, source: `sitemap index ${index.url}`, reason: why })
    let nested
    try {
      nested = await readOnce(child, options)
    } catch (err) {
      skip(`could not read sitemap: ${reason(err)}`)
      continue
    }
    if (nested.fresh) result.files.push(fileFacts(nested.file))
    if (nested.file.tooLarge) skip(TOO_LARGE)
    else if (nested.file.kind === 'index') skip('nested sitemap index (only one level is followed)')
    else for (const entry of entries(nested.file.locs, child)) result.entries.push(entry)
  }
}

// URLs listed in a sitemap, and `files` with the facts of every sitemap file that was read. A sitemap index is
// followed one level deep: child sitemaps that fail or are themselves indexes are skipped, not fatal. A file that is
// too large is skipped too, also the sitemap itself, but its facts are kept so it is still reported. Throws when the
// sitemap itself cannot be read. `beforeHop` paces the requests, see request().
export async function fromSitemap(url, { timeout, beforeHop } = {}) {
  const options = { cache: new Map(), timeout, beforeHop }
  let root
  try {
    root = await readOnce(url, options)
  } catch (err) {
    throw new Error(`Could not read sitemap ${url}: ${reason(err)}`, { cause: err })
  }
  const sitemap = root.file
  const result = { entries: [], skipped: [], files: root.fresh ? [fileFacts(sitemap)] : [] }
  if (sitemap.tooLarge) result.skipped.push({ input: url, source: '--sitemap', reason: TOO_LARGE })
  else if (sitemap.kind === 'urlset') result.entries = entries(sitemap.locs, url)
  else await followIndex(sitemap, result, options)
  return result
}
