// accessibleName(): a simplified accessible name for links and form controls.
import { collapseWhitespace, nonSpaceEnd } from '../../text.js'
import { elementsById } from '../ids.js'
import { perElement } from '../per-element.js'
import { hasBoundText, isBound } from './bindings.js'

// A simplified accessible name: what a screen reader would announce for a link or form control.
// It follows the order of the accessible name spec (aria-labelledby, aria-label, content, title)
// and honours only explicit hiding (aria-hidden, hidden), since a static check cannot see CSS.
// Script, style and noscript content is not part of a name: a browser that runs scripts does not show noscript.

// Accessible names only feed emptiness checks and the generic-text match. The cap counts collapsed characters (not
// just letters and digits), so a name cut short is judged the same unless it holds hundreds of punctuation characters
// or symbols, which link names do not.
const MAX_NAME = 500

const text = (value) => {
  const raw = value ?? ''
  const { end, found } = nonSpaceEnd(raw, MAX_NAME)
  return found ? collapseWhitespace(raw.slice(0, end)).slice(0, MAX_NAME) : ''
}

// Joins non-empty collapsed parts from `items` with one space, stopping once MAX_NAME characters have been gathered.
function joinCapped(items, partOf) {
  const parts = []
  let length = 0
  for (const item of items) {
    const part = partOf(item)
    if (!part) continue
    parts.push(part)
    length += part.length + (parts.length > 1 ? 1 : 0)
    if (length >= MAX_NAME) break
  }
  return parts.join(' ').slice(0, MAX_NAME)
}

const isHidden = (node) => node.attribs['aria-hidden'] === 'true' || node.attribs.hidden !== undefined

// Text, image alt, nested aria-label and svg <title> inside an element, stopping once MAX_NAME characters of
// collapsed text have been gathered. Explicitly hidden subtrees add nothing. Kept per element for each set of
// options, so nested targets and elements reuse each child's capped text instead of walking its subtree again.
function contentTextOf(images, includeHidden) {
  const nodeText = ($, node) => {
    if (node.type === 'text') return text(node.data)
    if (node.type !== 'tag' || node.name === 'noscript' || (!includeHidden && isHidden(node))) return ''
    // Attributes are read from the node: a cheerio wrapper for every node walked costs more than the walk itself.
    if (node.name === 'img') return images ? text(node.attribs.alt) : ''
    const label = node.attribs['aria-label']
    if (label) return text(label)
    if (node.name === 'svg') {
      const title = $(node).children('title').first().text()
      if (title) return text(title)
    }
    return childrenText($, node)
  }
  const childrenText = perElement(($, el) => joinCapped(el.children, (child) => nodeText($, child)))
  return childrenText
}

// The four content-text walks, indexed [images][includeHidden], each option read as a boolean.
const CONTENT_TEXT = [false, true].map((images) =>
  [false, true].map((includeHidden) => contentTextOf(images, includeHidden))
)

const contentText = ($, el, images, includeHidden = false) =>
  CONTENT_TEXT[Number(Boolean(images))][Number(Boolean(includeHidden))]($, el)

// A referenced image names with its own alt. A hidden target brings its hidden descendants along.
const referencedText = ($, target) =>
  target.is('img') ? text(target.attr('alt')) : contentText($, target.get(0), true, isHidden(target.get(0)))

// The elements an aria-labelledby points to: the first element with each id, each id once. Ids that do not exist give
// nothing.
const labelledByTargets = ($, el) =>
  [...new Set(($(el).attr('aria-labelledby') ?? '').split(/\s+/).filter(Boolean))]
    .map((id) => elementsById($).get(id)?.[0])
    .filter(Boolean)

// What a referenced element adds to a name: its own aria-label first, then its text. Whitespace is already collapsed.
// Kept per target, since any number of elements can point at one large element.
const targetName = perElement(($, target) => text($(target).attr('aria-label')) || referencedText($, $(target)))

// The text of the elements an aria-labelledby points to, hidden ones included, stopping once MAX_NAME characters have
// been gathered. Targets that are empty give nothing. A referenced element's own aria-labelledby is not followed, so
// references cannot loop. Each part is collapsed already, so joining them is enough and a long shared name is not
// scanned again for every reference.
const labelledByText = ($, el) => joinCapped(labelledByTargets($, el), (target) => targetName($, target))

// The images inside an element that are not explicitly hidden, on their own or through an ancestor within it, in
// document order. A plain walk that skips hidden subtrees: cheerio's find sorts what it finds, comparing positions
// among siblings, which grows faster than the number of images when they are siblings.
export function visibleImages(el) {
  const images = []
  const walk = (node) => {
    if (node.type !== 'tag' || isHidden(node)) return
    if (node.name === 'img') images.push(node)
    node.children.forEach(walk)
  }
  el.children.forEach(walk)
  return images
}

// `images: false` leaves image alt out, for the check that reports images on their own.
// `content: false` ignores what is inside the element, for form fields whose content is not a name.
export function accessibleName($, el, { images = true, content = true } = {}) {
  const own = $(el)
  const labelled = labelledByText($, el)
  if (labelled) return labelled
  const label = text(own.attr('aria-label'))
  if (label) return label
  return (content && contentText($, el, images)) || text(own.attr('title'))
}

// Content with text or a name set by script, see bindings.js. It mirrors contentText: explicitly hidden subtrees and
// noscript add nothing, and an image counts through its alt. Kept per node for each set of options: nested elements,
// such as headings or labels, each ask about everything inside them.
function boundContentOf(images, includeHidden) {
  const check = perElement((_, node) => {
    if (node.type !== 'tag' || node.name === 'noscript' || (!includeHidden && isHidden(node))) return false
    if (node.name === 'img') return images && isBound(node, 'alt')
    if (hasBoundText(node) || isBound(node, 'aria-label')) return true
    return node.children.some((child) => check(null, child))
  })
  return (node) => check(null, node)
}

// The four checks, indexed [images][includeHidden], each option read as a boolean.
const BOUND_CONTENT = [false, true].map((images) =>
  [false, true].map((includeHidden) => boundContentOf(images, includeHidden))
)

const boundContent = (node, images, includeHidden = false) =>
  BOUND_CONTENT[Number(Boolean(images))][Number(Boolean(includeHidden))](node)

// A referenced element names with its own aria-label first, images included, as in targetName.
const boundTarget = perElement(
  (_, target) => isBound(target, 'aria-label') || boundContent(target, true, isHidden(target))
)

// True when a framework fills in the name accessibleName looks for, with the same options. Its value is unknown here,
// but a screen reader reads the rendered page.
export function namedByScript($, el, { images = true, content = true } = {}) {
  if (['aria-label', 'aria-labelledby', 'title'].some((name) => isBound(el, name))) return true
  if (labelledByTargets($, el).some((target) => boundTarget($, target))) return true
  return content && (hasBoundText(el) || el.children.some((child) => boundContent(child, images)))
}

// Names that stay empty only because an aria-labelledby points nowhere, for a clearer message.
export const hasBrokenLabelledBy = ($, el) => $(el).attr('aria-labelledby') !== undefined && !labelledByText($, el)
