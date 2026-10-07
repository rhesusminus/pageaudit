import { collapseWhitespace, limit } from '../text.js'

const MAX_HTML = 500

const cap = (text) => limit(collapseWhitespace(text), MAX_HTML)

// A CSS selector that finds the element again: the nearest #id, or a path of
// tag:nth-of-type steps from <html>. An LLM or a person can use it to locate one of several identical tags.
export function selectorFor($, el) {
  const steps = []
  for (let node = el; node?.type === 'tag'; node = node.parent) {
    const id = $(node).attr('id')
    if (id && /^[A-Za-z][\w-]*$/.test(id)) {
      steps.unshift(`#${id}`)
      break
    }
    const same = $(node.parent?.children ?? []).filter((_, sibling) => sibling.name === node.name)
    const index = same.toArray().indexOf(node) + 1
    steps.unshift(same.length > 1 ? `${node.name}:nth-of-type(${index})` : node.name)
  }
  return steps.join(' > ')
}

// Where an issue is and what surrounds it: a selector, the element's own markup and its parent's, both bounded.
export function evidence($, el) {
  const parent = el.parent?.type === 'tag' ? el.parent : null
  return {
    selector: selectorFor($, el),
    html: cap($.html(el)),
    ...(parent ? { parentHtml: cap($.html(parent)) } : {})
  }
}

// Adds evidence to every issue in a list that came from one element.
export const withEvidence = ($, el, issues) => issues.map((issue) => ({ ...issue, ...evidence($, el) }))
