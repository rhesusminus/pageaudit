// "What’s on the page": the facts the audit read from the page, in words. The rows are plain text, so the results
// page and the Markdown brief for Claude say the same thing.

import { AI_CRAWLER_PRODUCT } from '../checks/site/robots.js'
import { markup } from '../html/escape.js'
import { factLength, h1sAtCap } from '../report.js'
import { inWords } from '../text.js'
import { count } from './format.js'

// A row: `value` is the text, `missing` marks a value that is not there (shown muted), `note` is said after it, and
// `fromPage` marks text taken from the page itself rather than written here.
const none = (value = 'None') => ({ value, missing: true })
const fromPage = (value, note) => ({ value, fromPage: true, note })
const said = (value) => ({ value })

// "N characters", or "over N characters" for text the report cut short.
export function lengthNote(text) {
  const { count: n, cut } = factLength(text)
  return `${cut ? 'over ' : ''}${count(n, 'character')}`
}

const withLength = (text) => (text ? fromPage(text, lengthNote(text)) : none())

// The report keeps only the first main headings, so a full list may not be all of them.
const headingNote = (h1s) => (h1sAtCap(h1s) ? `the first ${h1s.length}, there may be more` : undefined)

function socialPreview({ openGraph, twitterCard }) {
  if (!openGraph?.title && !twitterCard) return none()
  const parts = [openGraph?.title ? `Open Graph${openGraph.image ? ' with an image' : ', no image'}` : 'No Open Graph']
  if (twitterCard) parts.push(`X card "${twitterCard}"`)
  return said(parts.join(', '))
}

function images({ total, missingAlt }) {
  if (!total) return none()
  return said(`${count(total, 'image')}, ${missingAlt ? `${missingAlt} without alt text` : 'all with alt text'}`)
}

// The theme name is the page's own text, so it is quoted, as everywhere else.
export const platformName = ({ name, theme }) => (theme ? `${name}, theme "${theme}"` : name)

// A crawler token with the product it works for, as in "ChatGPT search (OAI-SearchBot)": the token is what robots.txt
// names, the product is what a reader knows.
const crawler = (agent) => (AI_CRAWLER_PRODUCT.has(agent) ? `${AI_CRAWLER_PRODUCT.get(agent)} (${agent})` : agent)

// The crawlers of `access` that robots.txt keeps out of the page, in words.
function aiUse(use, access) {
  const blocked = Object.keys(access).filter((agent) => access[agent] !== 'allowed')
  return blocked.length ? `${use} blocked for ${inWords(blocked.map(crawler))}` : `${use} allowed`
}

// How the robots.txt of the page's origin treats the AI crawlers, see aiCrawlerAccess().
function aiCrawlers({ robotsTxt, aiSearch, aiTraining }) {
  // Missing is any answer Google takes for no file, such as a 404 or a 403, so the file may exist.
  if (robotsTxt === 'missing') return said('Allowed, no robots.txt was served')
  if (robotsTxt !== 'ok') return none('Unknown, robots.txt could not be read')
  return said(`${aiUse('AI search', aiSearch)}, ${aiUse('AI training', aiTraining)}`)
}

// The rows about the robots.txt of the page's origin. A check stored before the site checks ran has no origin.
const originRows = (origin) =>
  origin
    ? [
        ['AI crawlers', aiCrawlers(origin)],
        ...(origin.contentSignal ? [['Content signal', fromPage(origin.contentSignal)]] : [])
      ]
    : []

// `origin` is the report's entry for the origin of the page, see `origins` in the report.
export function factRows(f, origin) {
  return [
    ['Title', withLength(f.title)],
    ['Description', withLength(f.description)],
    ['Main heading', f.h1s.length ? fromPage(f.h1s.join(', '), headingNote(f.h1s)) : none()],
    ['Canonical address', f.canonical ? fromPage(f.canonical) : none()],
    ['Language', f.lang ? fromPage(f.lang) : none('Not set')],
    ['Words', said(f.wordCount.toLocaleString('en'))],
    ['Links', said(`${f.links.internal} to this site, ${f.links.external} to other sites`)],
    ['Images', images(f.images)],
    ['Social preview', socialPreview(f)],
    ['Structured data', f.jsonLdTypes.length ? fromPage(f.jsonLdTypes.join(', ')) : none()],
    ['Built with', f.platform ? said(platformName(f.platform)) : none('Not recognised')],
    ...originRows(origin)
  ]
}

function cell({ value, missing, note }) {
  if (missing) return markup`<span class="missing">${value}</span>`
  return note ? markup`${value} <span class="length">${note}</span>` : markup`${value}`
}

export function facts(f, origin) {
  return markup`<section class="facts" aria-labelledby="facts-title">
    <h2 id="facts-title">What’s on the page</h2>
    <dl class="fact-list">
      ${factRows(f, origin).map(([term, row]) => markup`<div><dt>${term}</dt><dd>${cell(row)}</dd></div>`)}
    </dl>
  </section>`
}
