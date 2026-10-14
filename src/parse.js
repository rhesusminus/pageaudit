import * as cheerio from 'cheerio'

// Chrome's HTML parser nests elements no deeper than this (kMaximumHTMLParserDOMTreeDepth + 1, the document being
// depth 0). Google renders with Chrome.
const MAX_ELEMENT_DEPTH = 513

const VOID_ELEMENTS = new Set(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr'.split(' ')
)
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'

// domhandler types script and style elements 'script' and 'style' instead of 'tag'.
export const isElement = (node) => node?.type === 'tag' || node?.type === 'script' || node?.type === 'style'

const link = (parent, children) => {
  children.forEach((node, i) => {
    node.parent = parent
    node.prev = children[i - 1] ?? null
    node.next = children[i + 1] ?? null
  })
  parent.children = children
}

// An element counts itself towards the depth, so it moves from a parent at MAX_ELEMENT_DEPTH on. A node that is never
// open, an HTML void element or a comment, moves only from a parent one level deeper.
const moves = (node, parentDepth) => {
  if (node.type === 'text') return false
  const open = isElement(node) && !(node.namespace === HTML_NAMESPACE && VOID_ELEMENTS.has(node.name))
  return parentDepth >= (open ? MAX_ELEMENT_DEPTH : MAX_ELEMENT_DEPTH + 1)
}

// Chrome attaches a node that would be nested too deep as a child of its parent's parent instead. Text is not moved:
// it stays in the element it was written in. Everything that moves ends up a flat sibling in document order under
// `anchor`, the element one level above the cap. Iterative on purpose: the trees it is called for are deep enough to
// overflow the stack.
//
// This works on the finished tree, so it is exact except at the cap itself, where Chrome's open-element depth differs
// from the tree depth: content foster-parented out of a <table>, and self-closing foreign elements (the tree does not
// keep the flag). Matching those needs a tree adapter.
function flattenBelowCap(anchor) {
  const result = []
  for (const child of anchor.children) {
    result.push(child)
    const pending = [[child, MAX_ELEMENT_DEPTH, false]]
    while (pending.length) {
      const [node, depth, isMoved] = pending.pop()
      if (isMoved) result.push(node)
      if (!node.children?.length) continue
      const all = node.children
      const flags = all.map((c) => moves(c, depth))
      const kept = all.filter((_, i) => !flags[i])
      if (kept.length < all.length) link(node, kept)
      // Reversed, so the first child comes off the stack first, which keeps document order.
      for (let i = all.length - 1; i >= 0; i--) if (all[i].type !== 'text') pending.push([all[i], depth + 1, flags[i]])
    }
  }
  link(anchor, result)
}

function capDepth(root) {
  const stack = [[root, 0]]
  while (stack.length) {
    const [node, depth] = stack.pop()
    if (!node.children?.length) continue
    if (depth === MAX_ELEMENT_DEPTH - 1) flattenBelowCap(node)
    else for (const child of node.children) stack.push([child, depth + 1])
  }
}

export function parse(html) {
  const $ = cheerio.load(html)
  // <template> content is inert (never rendered), but cheerio exposes it to selectors.
  // Removing the element also removes any nested templates.
  $('template').remove()
  capDepth($.root()[0])
  return $
}
