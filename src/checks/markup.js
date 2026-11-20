import { collapseWhitespace, limit } from '../text.js'

const NON_SPACE = /\S/gu

// Where `text` has held `count` characters that are not whitespace, or its end if it holds fewer, and how many it
// holds up to there. A character is a code point, so a cut never splits one.
function nonSpaceEnd(text, count) {
  NON_SPACE.lastIndex = 0
  let found = 0
  while (found < count && NON_SPACE.exec(text)) found++
  return { end: found < count ? text.length : NON_SPACE.lastIndex, found }
}

// A copy of an element with only as much of its start as holds `needed` characters that are not whitespace, or all of
// it if it is smaller. Its markup begins with the same characters as the element's own, up to where the copy stops,
// and then closes the elements still open. Tags and attribute names count as their name, since whitespace never
// shrinks them. Copies keep their parent, which tells the serializer how to escape text, as in script. A template
// keeps its content fragment even when nothing of it fits, since the serializer reads it from there.
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
