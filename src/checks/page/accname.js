import { collapseWhitespace } from '../../text.js'
import { hasBoundText, isBound } from './bindings.js'

// A simplified accessible name: what a screen reader would announce for a link or form control.
// It follows the order of the accessible name spec (aria-labelledby, aria-label, content, title)
// and honours only explicit hiding (aria-hidden, hidden), since a static check cannot see CSS.
// Script, style and noscript content is not part of a name: a browser that runs scripts does not show noscript.

const text = (value) => collapseWhitespace(value ?? '')

const isHidden = (node) => node.attribs['aria-hidden'] === 'true' || node.attribs.hidden !== undefined

// Text, image alt, nested aria-label and svg <title> inside an element. Explicitly hidden subtrees add nothing.
function contentText($, el, images, includeHidden = false) {
  const parts = []
  const walk = (node) => {
    if (node.type === 'text') parts.push(node.data)
    if (node.type !== 'tag' || node.name === 'noscript' || (!includeHidden && isHidden(node))) return
    if (node.name === 'img') return void (images && parts.push($(node).attr('alt') ?? ''))
    const label = $(node).attr('aria-label')
    if (label) return void parts.push(label)
    if (node.name === 'svg') {
      const title = $(node).children('title').first().text()
      if (title) return void parts.push(title)
    }
    node.children.forEach(walk)
  }
  $(el).contents().toArray().forEach(walk)
  return text(parts.join(' '))
}

// A referenced image names with its own alt. A hidden target brings its hidden descendants along.
const referencedText = ($, target) =>
  target.is('img') ? text(target.attr('alt')) : contentText($, target.get(0), true, isHidden(target.get(0)))

// The elements an aria-labelledby points to. Ids that do not exist give nothing.
const labelledByTargets = ($, el) =>
  ($(el).attr('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => $(`[id="${id.replace(/["\\]/g, '\\$&')}"]`).first())
    .filter((target) => target.length)

// The text of the elements an aria-labelledby points to, hidden ones included. Targets that are empty give nothing.
// A referenced element's own aria-labelledby is not followed, so references cannot loop.
function labelledByText($, el) {
  return text(
    labelledByTargets($, el)
      .map((target) => text(target.attr('aria-label')) || referencedText($, target))
      .join(' ')
  )
}

// The images inside an element that are not explicitly hidden, on their own or through an ancestor within it.
export const visibleImages = ($, el) =>
  $(el)
    .find('img')
    .toArray()
    .filter((img) => !$(img).parentsUntil(el).addBack().toArray().some(isHidden))

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
// noscript add nothing, and an image counts through its alt.
function boundContent(node, images, includeHidden = false) {
  if (node.type !== 'tag' || node.name === 'noscript' || (!includeHidden && isHidden(node))) return false
  if (node.name === 'img') return images && isBound(node, 'alt')
  if (hasBoundText(node) || isBound(node, 'aria-label')) return true
  return node.children.some((child) => boundContent(child, images, includeHidden))
}

// True when a framework fills in the name accessibleName looks for, with the same options. Its value is unknown here,
// but a screen reader reads the rendered page.
export function namedByScript($, el, { images = true, content = true } = {}) {
  if (['aria-label', 'aria-labelledby', 'title'].some((name) => isBound(el, name))) return true
  const targets = labelledByTargets($, el).map((target) => target.get(0))
  if (targets.some((target) => boundContent(target, true, isHidden(target)))) return true
  return content && (hasBoundText(el) || el.children.some((child) => boundContent(child, images)))
}

// Names that stay empty only because an aria-labelledby points nowhere, for a clearer message.
export const hasBrokenLabelledBy = ($, el) => $(el).attr('aria-labelledby') !== undefined && !labelledByText($, el)
