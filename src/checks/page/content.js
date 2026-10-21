import { collapseWhitespace, limit } from '../../text.js'
import { absolute } from './signals.js'

const MAX_MAIN_TEXT = 1500
const MAX_EXCERPT = 200
const MAX_IMAGES = 20
const MAX_IMAGE_TEXT = 150
const MAX_SIDE = 75
const MAX_DATA_URI = 60
const BLOCKS = new Set(['figure', 'p', 'li', 'td', 'article', 'section', 'div', 'body'])
const MAX_ALT = 120
const MAX_SRC = 2000

const NOT_VISIBLE = new Set(['script', 'style', 'noscript', 'template', 'svg'])

// The text of an element without script, style and noscript content, joined like cheerio's .text(): no space goes
// between elements, so "<b>Sh</b>op" stays "Shop". domhandler gives script and style their own node types, so walking
// only into tags leaves them out. Unlike NOT_VISIBLE, which keeps svg out of prose, svg stays in, so the <title> of
// an icon link still counts as its text. Templates are already removed by parse(). No node gives no text.
export const visibleText = (node) =>
  (node?.children ?? [])
    .map((child) => {
      if (child.type === 'text') return child.data
      return child.type === 'tag' && child.name !== 'noscript' ? visibleText(child) : ''
    })
    .join('')

const PAGE_CHROME = new Set(['nav', 'header', 'footer', 'aside'])
const HEADING = /^h[1-6]$/
const BODY_SKIP = new Set([...NOT_VISIBLE, ...PAGE_CHROME])
const MAIN_AREAS = [
  ['main, [role="main" i]', 'main'],
  ['article', 'article']
]

// Walks the visible text of a tree in document order, until `onText` returns true. A space goes around every
// element so that "<p>a</p><p>b</p>" reads "a b". `onHeading` takes over a heading, which then is not walked into.
function walk(node, { skip, onText, onHeading }) {
  for (const child of node.children ?? []) {
    if (child.type === 'text') {
      if (onText(child.data)) return true
    } else if (child.type === 'tag' && !skip.has(child.name)) {
      if (onHeading && HEADING.test(child.name)) onHeading(child)
      else if (onText(' ') || walk(child, { skip, onText, onHeading }) || onText(' ')) return true
    }
  }
  return false
}

// Gathers text and says when it holds more than `max` characters once whitespace is collapsed, so the walk can stop.
function collector(max) {
  let raw = ''
  return {
    add(value) {
      raw += value
      if (raw.length <= max * 2) return false
      raw = collapseWhitespace(raw)
      return raw.length > max
    },
    text: () => limit(collapseWhitespace(raw), max) || null
  }
}

const bodyOf = ($) => $('body').get(0) ?? $.root().get(0)

function textOf(root, skip, max) {
  const found = collector(max)
  walk(root, { skip, onText: found.add })
  return found.text()
}

// The part of the page a visitor reads: the first of <main> and <article> that has text, else the body without
// navigation and footers. An empty main area, such as the shell of a client-side app, is passed over. `skip` names
// the elements to leave out of `root`, and `area` says which one it is: main, article or body.
export function mainArea($) {
  for (const [selector, area] of MAIN_AREAS) {
    const root = $(selector).first().get(0)
    if (root && textOf(root, NOT_VISIBLE, 1)) return { root, skip: NOT_VISIBLE, area }
  }
  return { root: bodyOf($), skip: BODY_SKIP, area: 'body' }
}

// The text a visitor reads in the main area, cut to a size a model can take in.
export function mainText($) {
  const { root, skip } = mainArea($)
  return textOf(root, skip, MAX_MAIN_TEXT)
}

// The first words under each heading, up to the next heading, keyed by the heading element.
export function headingExcerpts($) {
  const excerpts = new Map()
  let current = null
  const onHeading = (el) => {
    current = collector(MAX_EXCERPT)
    excerpts.set(el, current)
  }
  const onText = (value) => {
    if (current) current.add(value)
    return false
  }
  walk(bodyOf($), { skip: NOT_VISIBLE, onText, onHeading })
  return new Map([...excerpts].map(([el, found]) => [el, found.text()]))
}

// Up to MAX_SIDE characters of text on one side of an element, looking at its siblings and, if there are too few,
// at those of its parents, until the surrounding block ends. Images do not count.
function textBeside(el, direction) {
  let text = ''
  for (let node = el; node && text.length < MAX_SIDE; node = node.parent) {
    for (let sibling = node[direction]; sibling && text.length < MAX_SIDE; sibling = sibling[direction]) {
      const own = sibling.type === 'text' ? sibling.data : textOf(sibling, NOT_VISIBLE, MAX_SIDE)
      text = direction === 'prev' ? `${own ?? ''} ${text}` : `${text} ${own ?? ''}`
    }
    if (!node.parent || BLOCKS.has(node.parent.name)) break
  }
  const found = collapseWhitespace(text)
  if (found.length <= MAX_SIDE) return found
  // Cut at a word boundary so a word is never left in pieces.
  return direction === 'prev'
    ? found.slice(-MAX_SIDE).replace(/^\S*\s/, '')
    : found.slice(0, MAX_SIDE).replace(/\s\S*$/, '')
}

// The words around an image tell what it shows: its figure caption, or the text just before and after it.
function imageContext($, el) {
  const caption = collapseWhitespace(visibleText($(el).closest('figure').find('figcaption').get(0)))
  const text = caption || collapseWhitespace(`${textBeside(el, 'prev')} ${textBeside(el, 'next')}`)
  return limit(text, MAX_IMAGE_TEXT) || null
}

export function imageSrc(src, base) {
  if (!src) return null
  if (/^data:/i.test(src)) return limit(src, MAX_DATA_URI)
  return limit(absolute(src, base) ?? src, MAX_SRC)
}

// The first images with the address, alt text and surrounding words, to write or improve alt text from.
export function imageSamples($, base) {
  return $('img')
    .toArray()
    .slice(0, MAX_IMAGES)
    .map((el) => {
      const alt = $(el).attr('alt')
      return {
        src: imageSrc(($(el).attr('src') ?? '').trim(), base),
        alt: alt === undefined ? null : limit(collapseWhitespace(alt), MAX_ALT),
        context: imageContext($, el)
      }
    })
}
