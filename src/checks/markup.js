// markupStart(): the start of an element's markup, whitespace collapsed, read only as far as it is shown.
import { collapseWhitespace, limit, nonSpaceEnd } from '../text.js'

const COMMENT_DELIMITERS = '<!---->'.length

// A copy of an element with only as much of its start as holds `needed` characters that are not whitespace, or all of
// it if it is smaller. Its markup begins with the same characters as the element's own, up to where the copy stops,
// and then closes the elements still open. A tag counts as its "<" and name, an attribute as its name and "=", and a
// comment as its "<!--" and "-->": the serializer always writes them and whitespace never shrinks them. Copies keep
// their parent, which tells the serializer how to escape text, as in script. A template keeps its content fragment
// even when nothing of it fits, since the serializer reads it from there.
function startOf(el, needed) {
  let left = needed
  const copy = (node, parent) => {
    const clone = node.cloneNode(false)
    clone.parent = parent
    if (typeof node.data === 'string') {
      const { end, found } = nonSpaceEnd(node.data, left)
      clone.data = node.data.slice(0, end)
      left -= found
    }
    if (node.type === 'comment') left -= COMMENT_DELIMITERS
    if (node.attribs) {
      left -= node.name.length + 1
      for (const name of Object.keys(node.attribs)) left -= name.length + 1
    }
    for (const child of node.children ?? []) {
      if (left <= 0 && !(node.name === 'template' && clone.children.length === 0)) break
      clone.children.push(copy(child, clone))
    }
    return clone
  }
  return copy(el, el.parent)
}

// The markup of an element with whitespace collapsed, cut to `max` characters: the same as limiting the collapsed
// markup of the whole element, but serializing only its start. Collapsing keeps every character that is not
// whitespace, so a start with more than `max` of them collapses to more than `max` characters, and those are the same
// as the whole element's: both get cut at the same place. Nested elements would otherwise each serialize everything
// inside them for an issue that shows a few hundred characters.
export const markupStart = ($, el, max) => limit(collapseWhitespace($.html(startOf(el, max + 1))), max)
