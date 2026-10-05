import { SOURCES } from './sources.js'

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']

// Audits scoring below this are kept. Lighthouse itself calls 0.9 and up "good".
const GOOD_SCORE = 0.9
const MAX_ITEMS = 3
// Display modes that carry a real score. Informative and manual audits have none.
const SCORED_MODES = new Set(['binary', 'numeric', 'metricSavings'])
const METRICS = {
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  tbt: 'total-blocking-time',
  cls: 'cumulative-layout-shift',
  speedIndex: 'speed-index'
}

const percent = (score) => (score === null || score === undefined ? null : Math.round(score * 100))

function metricValue(audit) {
  if (audit?.numericValue === undefined) return null
  // Layout shift is unitless, so keep its decimals. Times are rounded milliseconds.
  return audit.id === METRICS.cls ? Number(audit.numericValue.toFixed(3)) : Math.round(audit.numericValue)
}

const itemLabel = (item) => item.url ?? item.node?.snippet ?? item.label ?? item.source?.url ?? null

// Which category an audit counts toward, so the report can group findings.
function categoryByAudit(categories) {
  const map = new Map()
  for (const [id, category] of Object.entries(categories)) {
    for (const ref of category.auditRefs) if (!map.has(ref.id)) map.set(ref.id, id)
  }
  return map
}

function summarizeAudit(audit, category) {
  return {
    id: audit.id,
    category,
    title: audit.title,
    score: percent(audit.score),
    displayValue: audit.displayValue ?? null,
    items: (audit.details?.items ?? []).map(itemLabel).filter(Boolean).slice(0, MAX_ITEMS)
  }
}

// Reduces a Lighthouse result (lhr) to what is worth reading: category scores, the
// core metrics and the audits that did not pass. The full lhr is far too big to hand
// to a person or a model.
export function summarize(lhr) {
  const categoryOf = categoryByAudit(lhr.categories)
  const audits = Object.values(lhr.audits)
  return {
    scores: Object.fromEntries(Object.entries(lhr.categories).map(([id, { score }]) => [id, percent(score)])),
    metrics: Object.fromEntries(Object.entries(METRICS).map(([key, id]) => [key, metricValue(lhr.audits[id])])),
    audits: audits
      .filter((a) => SCORED_MODES.has(a.scoreDisplayMode) && a.score !== null && a.score < GOOD_SCORE)
      .filter((a) => categoryOf.has(a.id))
      .sort((a, b) => a.score - b.score)
      .map((a) => summarizeAudit(a, categoryOf.get(a.id))),
    warnings: lhr.runWarnings ?? []
  }
}

// Loaded on demand: Lighthouse is heavy and most runs never use it.
async function loadDefaults() {
  const [{ default: lighthouse }, { launch }] = await Promise.all([import('lighthouse'), import('chrome-launcher')])
  return { lighthouse, launch }
}

async function auditOne(url, { lighthouse, port }) {
  try {
    const result = await lighthouse(url, { port, output: 'json', logLevel: 'silent', onlyCategories: CATEGORIES })
    if (!result?.lhr) throw new Error('no result')
    if (result.lhr.runtimeError) throw new Error(result.lhr.runtimeError.message)
    return { summary: summarize(result.lhr) }
  } catch (err) {
    return { error: err.message }
  }
}

// Runs Lighthouse for every URL, one at a time in a single Chrome: parallel runs
// compete for the CPU and skew each other's performance numbers. Never throws, each
// entry is { summary } or { error }, in input order. `launch` and `lighthouse` can be
// injected so tests do not need Chrome.
export async function runLighthouse(urls, { launch, lighthouse, onProgress = () => {} } = {}) {
  let chrome
  try {
    const defaults = launch && lighthouse ? {} : await loadDefaults()
    launch ??= defaults.launch
    lighthouse ??= defaults.lighthouse
    chrome = await launch({ chromeFlags: ['--headless'] })
  } catch (err) {
    return urls.map(() => ({ error: `Could not start Chrome: ${err.message}` }))
  }
  try {
    const results = []
    for (const url of urls) {
      results.push(await auditOne(url, { lighthouse, port: chrome.port }))
      onProgress(results.length)
    }
    return results
  } finally {
    // A Chrome that already died must not throw away the results.
    await chrome.kill().catch(() => {})
  }
}

// A page Lighthouse could not audit. Only a warning: the static checks still ran.
export const lighthouseFailed = (url, message) => ({
  url,
  type: 'lighthouse-failed',
  severity: 'warning',
  category: 'performance',
  source: SOURCES.lighthouse,
  message: `Lighthouse could not audit the page: ${message}`,
  context: ''
})
