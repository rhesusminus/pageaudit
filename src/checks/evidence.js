import { isElement } from '../parse.js'
import { collapseWhitespace, limit } from '../text.js'
import { elementsById } from './ids.js'
import { perElement } from './per-element.js'

const MAX_HTML = 500
const MAX_PARENT_HTML = 200
// The page frame says nothing about where in it an element sits.
const FRAME = new Set(['html', 'head', 'body'])
const VALID_ID = /^[A-Za-z][\w-]*$/

const cap = (text, max = MAX_HTML) => limit(collapseWhitespace(text), max)

// How many elements have an id. An id that is used twice does not find one element.
const idCount = ($, id) => elementsById($).get(id)?.length ?? 0

// The step for one element: its tag, with :nth-of-type when it has same-tag siblings. One pass over the siblings.
function step(node) {
  let before = 0
  let total = 0
  for (const sibling of node.parent?.children ?? []) {
    if (!isElement(sibling) || sibling.name !== node.name) continue
    if (sibling === node) before = total + 1
    total++
  }
  return total > 1 ? `${node.name}:nth-of-type(${before})` : node.name
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
    steps.unshift(step(node))
  }
  return steps.join(' > ')
}

const openingTag = (el) =>
  `<${el.name}${Object.entries(el.attribs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')}>`

const markupOf = ($, el, max) => (FRAME.has(el.name) ? limit(openingTag(el), max) : cap($.html(el), max))

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
