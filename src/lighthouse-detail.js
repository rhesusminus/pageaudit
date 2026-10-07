import { collapseWhitespace, limit } from './text.js'

const MAX_ITEMS = 5
const MAX_TEXT = 300
const MAX_EXPLANATION = 500
const MAX_DESCRIPTION = 400
const MAX_DEPTH = 3
// [text](address), also when the address holds one level of parentheses.
const MD_LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g
// Details types that hold affected things of their own.
const NESTED = new Set(['table', 'list', 'list-section', 'node', 'checklist'])
// axe starts its failure summaries with this, which says nothing the audit title does not.
const FIX_LEAD_IN = /^Fix (?:any|all) of the following:\s*/i

const text = (value, max = MAX_TEXT) => {
  if (typeof value !== 'string') return undefined
  const clean = collapseWhitespace(value)
  return clean ? limit(clean, max) : undefined
}
// Zero means "no estimate" in Lighthouse, so a number only counts when it is above zero.
const positive = (value) =>
  typeof value === 'number' && value > 0 && Math.round(value) > 0 ? Math.round(value) : undefined
const defined = (fields) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))

// A value that is an address or a { type: 'link', url } object.
const addressOf = (value) => text(typeof value === 'object' ? value?.url : value)

// The node an item points at: its `node`, or its `source` when that is a node.
const nodeOf = (item) => item.node ?? (item.source?.type === 'node' ? item.source : undefined)

// One affected thing, with what a fix needs: where it is (address or CSS selector), its markup, why it fails and
// how much it costs. Only the fields Lighthouse gave.
function summarizeItem(item) {
  const node = nodeOf(item) ?? {}
  const snippet = text(node.snippet)
  const nodeLabel = text(node.nodeLabel)
  const explanation = text(node.explanation ?? item.subItems?.items?.[0]?.reason, MAX_EXPLANATION)
  return defined({
    url: addressOf(item.url) ?? addressOf(item.source?.url) ?? addressOf(item.sourceLocation?.url),
    line: positive(item.sourceLocation?.line + 1),
    selector: text(node.selector),
    nodeLabel: nodeLabel && !snippet?.includes(nodeLabel) ? nodeLabel : undefined,
    snippet,
    explanation: explanation?.replace(FIX_LEAD_IN, ''),
    label: text(item.label) ?? text(item.entity?.text ?? item.entity) ?? text(item.description),
    wastedMs: positive(item.wastedMs),
    wastedBytes: positive(item.wastedBytes),
    totalBytes: positive(item.totalBytes)
  })
}

// The affected things of any details shape. Lists and tables nest, nodes can stand for themselves, and a checklist
// has an object of { value, label } entries of which the failed ones count.
function entries(details, depth = 0) {
  if (!details || typeof details !== 'object' || depth > MAX_DEPTH) return []
  if (details.type === 'node') return [{ node: details }]
  if (details.type === 'list-section') return [{ label: details.value }]
  if (details.type === 'checklist' && !Array.isArray(details.items)) {
    return Object.entries(details.items ?? {})
      .filter(([, check]) => check?.value === false)
      .map(([key, check]) => ({ label: check.label ?? key }))
  }
  if (!Array.isArray(details.items)) return []
  return details.items.flatMap((item) => (NESTED.has(item?.type) ? entries(item, depth + 1) : [item]))
}

export const itemsOf = (details) =>
  entries(details)
    .filter((item) => item && typeof item === 'object')
    .map(summarizeItem)
    .filter((item) => Object.keys(item).length > 0)
    .slice(0, MAX_ITEMS)

// Lighthouse's explanation of the audit, with its markdown links turned into plain words. The first web link is kept apart.
export function describe(audit) {
  const raw = audit.description ?? ''
  const description = text(raw.replaceAll(MD_LINK, '$1'), MAX_DESCRIPTION)
  const learnMore = [...raw.matchAll(MD_LINK)].map((match) => match[2]).find((url) => /^https?:/.test(url))
  return defined({ description, learnMore })
}

const rounded = (value) => (typeof value === 'number' && value > 0 ? Number(value.toFixed(3)) : undefined)

// What fixing the audit would save, when Lighthouse worked it out: overall time and bytes, and the gain per metric
// (`metricSavings`, which all the newer audits use). Layout shift is unitless, the rest are milliseconds.
export function savings(audit) {
  const { details, metricSavings = {} } = audit
  const metrics = defined(
    Object.fromEntries(
      Object.entries(metricSavings).map(([metric, value]) => [
        metric.toLowerCase(),
        metric === 'CLS' ? rounded(value) : positive(value)
      ])
    )
  )
  const found = defined({
    ms: positive(details?.overallSavingsMs),
    bytes: positive(details?.overallSavingsBytes ?? details?.debugData?.wastedBytes),
    metrics: Object.keys(metrics).length > 0 ? metrics : undefined
  })
  return Object.keys(found).length > 0 ? { savings: found } : {}
}
