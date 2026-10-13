import { mapLimited } from '../../concurrency.js'
import { pageKey } from '../../input/resolve.js'
import { loadRobots } from '../../robots.js'
import { SOURCES } from '../../sources.js'

const issue = (fields) => ({ category: 'seo', source: SOURCES.sitemaps, ...fields })

// Pages that were audited and listed in a sitemap, with where each sitemap listed them. Pages that did not
// load are already errors on the page, and redirects or noindex on an error page are not a finding.
const listedPages = (pages, listed) =>
  pages
    .filter((page) => page.status === 200 && listed.has(page.url))
    .map((page) => ({ page, listings: listed.get(page.url) }))

const siteIssue = (rule, matches) =>
  matches.length > 0
    ? [
        issue({
          ...rule,
          context: [...new Set(matches.flatMap(({ listings }) => listings.map(({ sitemap }) => sitemap)))].join(', '),
          urls: matches.map(({ page }) => page.url)
        })
      ]
    : []

// Sitemaps should list the canonical URLs you want in search results. Listing a noindex page or a
// page whose canonical is another URL sends contradicting signals, a redirecting URL wastes a fetch.
// Pages that fail to load are already errors on the page, so they are not repeated here.
export function checkSitemapEntries(pages, listed = new Map()) {
  const entries = listedPages(pages, listed)
  const noindex = entries.filter(({ page }) => page.issues.some((i) => i.type === 'noindex'))
  const elsewhere = entries.filter(
    ({ page }) => page.facts?.canonical && pageKey(page.facts.canonical) !== pageKey(page.finalUrl)
  )
  // Only a sitemap that lists the URL that was fetched can be blamed for its redirect. One that lists
  // /blog/ while /blog was fetched may list the final URL already.
  const redirects = entries
    .map(({ page, listings }) => ({ page, listings: listings.filter(({ url }) => url === page.url) }))
    .filter(({ page, listings }) => page.redirects.length > 0 && listings.length > 0)
  return [
    ...siteIssue(
      {
        type: 'sitemap-url-noindex',
        severity: 'warning',
        message: 'The sitemap lists a page that tells search engines not to index it'
      },
      noindex
    ),
    ...siteIssue(
      {
        type: 'sitemap-url-not-canonical',
        severity: 'warning',
        message: 'The sitemap lists a page whose canonical points to a different URL'
      },
      elsewhere
    ),
    ...siteIssue(
      {
        type: 'sitemap-url-redirects',
        severity: 'info',
        message: 'The sitemap lists a URL that redirects, it should list the final URL'
      },
      redirects
    )
  ]
}

// Google rejects a sitemap file that lists more than 50,000 URLs. Files over its 50 MB limit are found while reading.
export const MAX_ENTRIES = 50_000

// How many example values an issue quotes, so a sitemap full of one mistake stays readable.
const EXAMPLES = 3
const MAX_HOSTS = 20
const MAX_CONCURRENT = 8

// W3C datetime as the sitemap protocol allows it: YYYY, YYYY-MM, YYYY-MM-DD, or a date with a time and zone.
const LASTMOD =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2})))?)?)?$/

function validLastmod(value) {
  const match = LASTMOD.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second, zoneHour, zoneMinute] = match
    .slice(1)
    .map((part) => part && Number(part))
  if (month !== undefined && (month < 1 || month > 12)) return false
  if (day !== undefined && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return false
  if (hour !== undefined && (hour > 23 || minute > 59 || second > 59)) return false
  return !(zoneHour !== undefined && (zoneHour > 23 || zoneMinute > 59))
}

const parse = (loc) => {
  try {
    return new URL(loc)
  } catch {
    return null
  }
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

// What is wrong with the <loc> values of one sitemap file, and the origins it lists. A loc that has a scheme
// but cannot be parsed (`http://`) is malformed.
function inspectLocs(locs) {
  const seen = new Set()
  const found = { duplicates: new Set(), notHttp: [], relative: [], malformed: [], origins: new Set() }
  for (const loc of locs) {
    if (seen.has(loc)) found.duplicates.add(loc)
    seen.add(loc)
    const url = parse(loc)
    if (url && (url.protocol === 'http:' || url.protocol === 'https:')) found.origins.add(url.origin)
    else if (url) found.notHttp.push(loc)
    else (HAS_SCHEME.test(loc) ? found.malformed : found.relative).push(loc)
  }
  return found
}

const badLastmods = ({ lastmods }) => lastmods.filter(({ value }) => !validLastmod(value))

const inspect = (file) => ({ ...inspectLocs(file.locs), badLastmods: badLastmods(file) })

const quote = (values, total = values.length) => {
  const shown = values.slice(0, EXAMPLES).join(', ')
  return total > EXAMPLES ? `${shown} and ${total - EXAMPLES} more` : shown
}

const fileIssue = (rule, matches) =>
  matches.length > 0
    ? [
        issue({
          ...rule,
          context: matches.map(({ detail }) => detail).join('; '),
          urls: matches.map(({ file }) => file.url)
        })
      ]
    : []

const count = (n) => n.toLocaleString('en-US')

// One rule per issue type: `detail` returns what to say about a file, or nothing when the file is fine.
const FILE_RULES = [
  {
    type: 'sitemap-too-many-urls',
    severity: 'error',
    message: `A sitemap lists more than ${count(MAX_ENTRIES)} entries, Google does not accept it`,
    detail: (file) => (file.entries > MAX_ENTRIES ? `${file.url} has ${count(file.entries)}` : null)
  },
  {
    type: 'sitemap-too-large',
    severity: 'error',
    message: 'A sitemap is larger than 50 MB uncompressed, Google does not accept it',
    detail: (file) => (file.tooLarge ? file.url : null)
  },
  {
    type: 'sitemap-empty-loc',
    severity: 'warning',
    message: 'A sitemap has entries with an empty or missing <loc>',
    detail: (file) => (file.emptyLocs > 0 ? `${file.url} has ${file.emptyLocs}` : null)
  },
  {
    type: 'sitemap-loc-relative',
    severity: 'warning',
    message: 'A sitemap lists relative addresses, they must be full URLs',
    detail: (file, found) => (found.relative.length ? `${file.url}: ${quote(found.relative)}` : null)
  },
  {
    type: 'sitemap-loc-malformed',
    severity: 'warning',
    message: 'A sitemap lists addresses that are not valid URLs',
    detail: (file, found) => (found.malformed.length ? `${file.url}: ${quote(found.malformed)}` : null)
  },
  {
    type: 'sitemap-loc-not-http',
    severity: 'warning',
    message: 'A sitemap lists addresses that are not http or https URLs',
    detail: (file, found) => (found.notHttp.length ? `${file.url}: ${quote(found.notHttp)}` : null)
  },
  {
    type: 'sitemap-duplicate-loc',
    severity: 'info',
    message: 'A sitemap lists the same address more than once',
    detail: (file, found) =>
      found.duplicates.size ? `${file.url}: ${quote([...found.duplicates], found.duplicates.size)}` : null
  },
  {
    type: 'sitemap-invalid-lastmod',
    severity: 'warning',
    message: 'A sitemap has <lastmod> dates that are not in the W3C date format (such as 2026-03-31)',
    detail: (file, found) =>
      found.badLastmods.length
        ? `${file.url}: ${quote(
            found.badLastmods.map(({ value }) => `"${value}"`),
            found.badLastmods.length
          )}`
        : null
  }
]

// The checks on every sitemap file that was read, before any URL is deduplicated or limited:
// size, entries without an address, unusable addresses, duplicates and dates that are not W3C datetimes.
// A urlset and a sitemap index follow the same limits. One issue per rule, listing the files in `urls`.
export function checkSitemapFiles(files = []) {
  const inspected = files.map((file) => ({ file, found: inspect(file) }))
  return FILE_RULES.flatMap(({ detail, ...rule }) =>
    fileIssue(
      rule,
      inspected.map(({ file, found }) => ({ file, detail: detail(file, found) })).filter((match) => match.detail)
    )
  )
}

// A sitemap may list URLs on another host only when that host says so, by naming the sitemap in its
// robots.txt (or through Search Console, which cannot be read from here). So this is only an info: it lists
// the hosts whose robots.txt does not name the sitemap. Only the first hosts of a file are looked at.
export async function checkSitemapHosts(files = [], { load = loadRobots } = {}) {
  const matches = []
  for (const file of files.filter((f) => f.kind === 'urlset')) {
    // A sitemap that redirected belongs to the host it ended up on.
    const own = parse(file.finalUrl ?? file.url)?.origin
    const addresses = new Set([file.url, file.finalUrl].filter(Boolean).map((url) => parse(url)?.href))
    const hosts = [...inspectLocs(file.locs).origins].filter((origin) => origin !== own).slice(0, MAX_HOSTS)
    const unproven = (
      await mapLimited(hosts, MAX_CONCURRENT, async (origin) => {
        const robots = await load(origin)
        const named =
          robots?.status === 'ok' && robots.parser.getSitemaps().some((url) => addresses.has(parse(url)?.href))
        return named ? null : origin
      })
    ).filter(Boolean)
    if (unproven.length) matches.push({ file, detail: `${file.url} lists ${quote(unproven)}` })
  }
  return fileIssue(
    {
      type: 'sitemap-off-host',
      severity: 'info',
      message:
        "A sitemap lists URLs on another host, and that host's robots.txt does not name the sitemap. Ignore this if you submitted the sitemap for that host in Search Console"
    },
    matches
  )
}

// A site without a Sitemap line in its robots.txt is harder for crawlers other than Google to find a sitemap
// for. Only checked when no --sitemap was given, and only on a robots.txt that was read.
export async function checkSitemapDeclared(pages, { load = loadRobots } = {}) {
  const origins = [
    ...new Set(
      pages.filter((page) => page.status === 200 && page.finalUrl).map((page) => new URL(page.finalUrl).origin)
    )
  ]
  const missing = (
    await mapLimited(origins, MAX_CONCURRENT, async (origin) => {
      const robots = await load(origin)
      return robots?.status === 'ok' && robots.parser.getSitemaps().length === 0 ? origin : null
    })
  ).filter(Boolean)
  return missing.length
    ? [
        issue({
          type: 'no-sitemap-declared',
          severity: 'info',
          message: 'robots.txt does not name a sitemap',
          context: missing.map((origin) => `${origin}/robots.txt`).join(', '),
          urls: pages
            .filter((page) => page.finalUrl && missing.includes(new URL(page.finalUrl).origin))
            .map((page) => page.url)
        })
      ]
    : []
}
