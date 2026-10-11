import { collapseWhitespace } from '../../text.js'

// A simplified accessible name: what a screen reader would announce for a link or form control.
// It follows the order of the accessible name spec (aria-labelledby, aria-label, content, title)
// and honours only explicit hiding (aria-hidden, hidden), since a static check cannot see CSS.

const text = (value) => collapseWhitespace(value ?? '')

const isHidden = (node) => node.attribs['aria-hidden'] === 'true' || node.attribs.hidden !== undefined

// Text, image alt, nested aria-label and svg <title> inside an element. Explicitly hidden subtrees add nothing.
function contentText($, el, images, includeHidden = false) {
  const parts = []
  const walk = (node) => {
    if (node.type === 'text') parts.push(node.data)
    if (node.type !== 'tag' || (!includeHidden && isHidden(node))) return
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

// The text of the elements an aria-labelledby points to, hidden ones included. Ids that do not exist, or that point
// at empty elements, give nothing. A referenced element's own aria-labelledby is not followed, so references cannot loop.
function labelledByText($, el) {
  const ids = ($(el).attr('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
  return text(
    ids
      .map((id) => $(`[id="${id.replace(/["\\]/g, '\\$&')}"]`).first())
      .filter((target) => target.length)
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

// Names that stay empty only because an aria-labelledby points nowhere, for a clearer message.
export const hasBrokenLabelledBy = ($, el) => $(el).attr('aria-labelledby') !== undefined && !labelledByText($, el)
