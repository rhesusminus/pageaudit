import { gunzipSync } from 'node:zlib'
import * as cheerio from 'cheerio'
import { request } from '../fetch.js'

// Returns the <loc> values of a <urlset> or a <sitemapindex>.
export function parseSitemap(xml) {
  const $ = cheerio.load(xml, { xml: true })
  const root = $.root().children().get(0)?.tagName
  const locs = (selector) =>
    $(selector)
      .toArray()
      .map((el) => $(el).text().trim())
      .filter(Boolean)
  if (root === 'urlset') return { kind: 'urlset', locs: locs('urlset > url > loc') }
  if (root === 'sitemapindex') return { kind: 'index', locs: locs('sitemapindex > sitemap > loc') }
  throw new Error(`not a sitemap (root element is ${root ? `<${root}>` : 'missing'})`)
}

// FetchError carries the bare reason, other errors only a message.
const reason = (err) => err.reason ?? err.message

async function readSitemap(url, timeout) {
  const res = await request(url, { timeout, accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' })
  if (res.status !== 200) {
    await res.discard()
    throw new Error(`HTTP ${res.status}`)
  }
  let bytes = await res.bytes()
  // A .xml.gz file served as-is, not as Content-Encoding (which fetch already decodes).
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes)
  // The sitemap protocol requires UTF-8.
  return parseSitemap(new TextDecoder().decode(bytes))
}

// URLs listed in a sitemap. A sitemap index is followed one level deep: child
// sitemaps that fail or are themselves indexes are skipped, not fatal. Throws
// when the sitemap itself cannot be read.
export async function fromSitemap(url, { timeout } = {}) {
  let sitemap
  try {
    sitemap = await readSitemap(url, timeout)
  } catch (err) {
    throw new Error(`Could not read sitemap ${url}: ${reason(err)}`, { cause: err })
  }
  const entries = (locs, file) => locs.map((value) => ({ value, source: `sitemap ${file}`, sitemap: file }))
  if (sitemap.kind === 'urlset') return { entries: entries(sitemap.locs, url), skipped: [] }

  const result = { entries: [], skipped: [] }
  for (const child of sitemap.locs) {
    const skip = (why) => result.skipped.push({ input: child, source: `sitemap index ${url}`, reason: why })
    let nested
    try {
      nested = await readSitemap(child, timeout)
    } catch (err) {
      skip(`could not read sitemap: ${reason(err)}`, { cause: err })
      continue
    }
    if (nested.kind === 'index') skip('nested sitemap index (only one level is followed)')
    else result.entries.push(...entries(nested.locs, child))
  }
  return result
}
