import { isElement } from '../parse.js'
import { limit } from '../text.js'
import { elementsById } from './ids.js'
import { markupStart } from './markup.js'
import { perElement } from './per-element.js'

const MAX_HTML = 500
const MAX_PARENT_HTML = 200
// The page frame says nothing about where in it an element sits.
const FRAME = new Set(['html', 'head', 'body'])
const VALID_ID = /^[A-Za-z][\w-]*$/

// How many elements have an id. An id that is used twice does not find one element.
const idCount = ($, id) => elementsById($).get(id)?.length ?? 0

// Where each child element of a parent stands among the children with its tag, and how many there are per tag. One
// pass over the children, kept per parent: every sibling with an issue asks.
const childPositions = perElement((_, parent) => {
  const totals = new Map()
  const positions = new Map()
  for (const child of parent.children.filter(isElement)) {
    totals.set(child.name, (totals.get(child.name) ?? 0) + 1)
    positions.set(child, totals.get(child.name))
  }
  return { totals, positions }
})

// The step for one element: its tag, with :nth-of-type when it has same-tag siblings.
function step($, node) {
  if (!node.parent) return node.name
  const { totals, positions } = childPositions($, node.parent)
  return totals.get(node.name) > 1 ? `${node.name}:nth-of-type(${positions.get(node)})` : node.name
}

// A CSS selector that finds the element again: the nearest unique #id, or a path of
// tag:nth-of-type steps from <html>. It lets an LLM or a person pick one of several identical tags.
export function selectorFor($, el) {
  const steps = []
  for (let node = el; isElement(node); node = node.parent) {
    const id = node.attribs.id
    if (id && VALID_ID.test(id) && idCount($, id) === 1) {
      steps.unshift(`#${id}`)
      break
    }
    steps.unshift(step($, node))
  }
  return steps.join(' > ')
}

const openingTag = (el) =>
  `<${el.name}${Object.entries(el.attribs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')}>`

const markupOf = ($, el, max) => (FRAME.has(el.name) ? limit(openingTag(el), max) : markupStart($, el, max))

const parentMarkup = perElement(($, parent) => markupOf($, parent, MAX_PARENT_HTML))

const evidenceOf = perElement(($, el) => {
  const parent = isElement(el.parent) && !FRAME.has(el.parent.name) ? el.parent : null
  return {
    selector: selectorFor($, el),
    html: markupOf($, el, MAX_HTML),
    ...(parent ? { parentHtml: parentMarkup($, parent) } : {})
  }
})

// Where an issue is and what surrounds it: a selector, the element's own markup and its parent's, both bounded.
// Siblings share the work: the result is kept per element and the parent's markup per parent.
export const evidence = ($, el) => (el ? evidenceOf($, el) : {})

// Adds evidence to every issue in a list that came from one element.
export const withEvidence = ($, el, issues) => issues.map((issue) => ({ ...issue, ...evidence($, el) }))
