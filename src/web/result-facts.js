// "What’s on the page": the facts the audit read from the page, in words. The rows are plain text, so the results
// page and the Markdown brief for Claude say the same thing.
import { markup } from '../html/escape.js'
import { charCount } from '../text.js'
import { count } from './format.js'

// A row: `value` is the text, `missing` marks a value that is not there (shown muted), `note` is said after it, and
// `fromPage` marks text taken from the page itself rather than written here.
const none = (value = 'None') => ({ value, missing: true })
const fromPage = (value, note) => ({ value, fromPage: true, note })
const said = (value) => ({ value })

const withLength = (text) => (text ? fromPage(text, count(charCount(text), 'character')) : none())

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

export function factRows(f) {
  return [
    ['Title', withLength(f.title)],
    ['Description', withLength(f.description)],
    ['Main heading', f.h1s.length ? fromPage(f.h1s.join(', ')) : none()],
    ['Canonical address', f.canonical ? fromPage(f.canonical) : none()],
    ['Language', f.lang ? fromPage(f.lang) : none('Not set')],
    ['Words', said(f.wordCount.toLocaleString('en'))],
    ['Links', said(`${f.links.internal} to this site, ${f.links.external} to other sites`)],
    ['Images', images(f.images)],
    ['Social preview', socialPreview(f)],
    ['Structured data', f.jsonLdTypes.length ? fromPage(f.jsonLdTypes.join(', ')) : none()],
    ['Built with', f.platform ? said(platformName(f.platform)) : none('Not recognised')]
  ]
}

function cell({ value, missing, note }) {
  if (missing) return markup`<span class="missing">${value}</span>`
  return note ? markup`${value} <span class="length">${note}</span>` : markup`${value}`
}

export function facts(f) {
  return markup`<section class="facts" aria-labelledby="facts-title">
    <h2 id="facts-title">What’s on the page</h2>
    <dl class="fact-list">
      ${factRows(f).map(([term, row]) => markup`<div><dt>${term}</dt><dd>${cell(row)}</dd></div>`)}
    </dl>
  </section>`
}
