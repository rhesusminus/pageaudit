import { collapseWhitespace, limit } from '../../text.js'
import { absolute } from './signals.js'

const MAX_MAIN_TEXT = 1500
const MAX_EXCERPT = 200
const MAX_IMAGES = 20
const MAX_IMAGE_TEXT = 150
const MAX_ALT = 120
const MAX_SRC = 2000

const NOT_VISIBLE = new Set(['script', 'style', 'noscript', 'template', 'svg'])
const PAGE_CHROME = new Set(['nav', 'header', 'footer', 'aside'])
const HEADING = /^h[1-6]$/
const MAIN_AREAS = ['main, [role="main" i]', 'article']

// Walks the visible text of a tree in document order. A space goes around every element so that
// "<p>a</p><p>b</p>" reads "a b". `onHeading` takes over a heading, which then is not walked into.
function walk(node, { skip, onText, onHeading }) {
  for (const child of node.children ?? []) {
    if (child.type === 'text') onText(child.data)
    else if (child.type === 'tag' && !skip.has(child.name)) {
      if (onHeading && HEADING.test(child.name)) onHeading(child)
      else {
        onText(' ')
        walk(child, { skip, onText, onHeading })
        onText(' ')
      }
    }
  }
}

const bodyOf = ($) => $('body').get(0) ?? $.root().get(0)

// The text a visitor reads in the main area, without navigation and footers, cut to a size a model can take in.
export function mainText($) {
  const area = MAIN_AREAS.map((selector) => $(selector).first().get(0)).find(Boolean)
  const skip = area ? NOT_VISIBLE : new Set([...NOT_VISIBLE, ...PAGE_CHROME])
  let text = ''
  walk(area ?? bodyOf($), { skip, onText: (value) => (text += value) })
  return limit(collapseWhitespace(text), MAX_MAIN_TEXT) || null
}

// The first words under each heading, up to the next heading, keyed by the heading element.
export function headingExcerpts($) {
  const excerpts = new Map()
  let current = null
  const onHeading = (el) => {
    current = { text: '' }
    excerpts.set(el, current)
  }
  const onText = (value) => {
    if (current && current.text.length < MAX_EXCERPT * 2) current.text += value
  }
  walk(bodyOf($), { skip: NOT_VISIBLE, onText, onHeading })
  return new Map([...excerpts].map(([el, { text }]) => [el, limit(collapseWhitespace(text), MAX_EXCERPT) || null]))
}

// The words around an image tell what it shows: its figure caption, or the text of the block it sits in.
function imageContext($, el) {
  const image = $(el)
  const caption = image.closest('figure').find('figcaption').first().text()
  const block = image.closest('figure, p, li, a, td, article, section, div')
  const text = collapseWhitespace(caption) || collapseWhitespace(block.clone().find('img').remove().end().text())
  return limit(text, MAX_IMAGE_TEXT) || null
}

// The first images with the address, alt text and surrounding words, to write or improve alt text from.
export function imageSamples($, base) {
  return $('img')
    .toArray()
    .slice(0, MAX_IMAGES)
    .map((el) => {
      const src = ($(el).attr('src') ?? '').trim()
      const alt = collapseWhitespace($(el).attr('alt') ?? '')
      return {
        src: src.startsWith('data:') ? limit(src, 60) : limit(absolute(src, base) ?? src, MAX_SRC) || null,
        alt: $(el).attr('alt') === undefined ? null : limit(alt, MAX_ALT),
        context: imageContext($, el)
      }
    })
}
