import { SOURCES } from './sources.js'
import { collapseWhitespace, limit } from './text.js'

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']

// Audits scoring below this are kept. Lighthouse itself calls 0.9 and up "good".
const GOOD_SCORE = 0.9
const MAX_ITEMS = 5
const MAX_TEXT = 300
const MAX_DESCRIPTION = 400
const MD_LINK = /\[([^\]]+)\]\((https?:[^)\s]+)\)/g
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

const text = (value) =>
  typeof value === 'string' && collapseWhitespace(value) ? limit(collapseWhitespace(value), MAX_TEXT) : undefined
const whole = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)

// One affected thing, with what a fix needs: where it is (address or CSS selector), its markup, why it fails and
// how much it costs. Only the fields Lighthouse gave.
function summarizeItem(item) {
  const fields = {
    url: text(item.url ?? item.source?.url),
    selector: text(item.node?.selector),
    nodeLabel: text(item.node?.nodeLabel),
    snippet: text(item.node?.snippet),
    explanation: text(item.node?.explanation),
    label: text(item.label),
    wastedMs: whole(item.wastedMs),
    wastedBytes: whole(item.wastedBytes),
    totalBytes: whole(item.totalBytes)
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

// Lighthouse's explanation of the audit, with its markdown links turned into plain words. The first link is kept apart.
function describe(audit) {
  const description = collapseWhitespace((audit.description ?? '').replaceAll(MD_LINK, '$1'))
  const learnMore = [...(audit.description ?? '').matchAll(MD_LINK)][0]?.[2]
  return {
    ...(description ? { description: limit(description, MAX_DESCRIPTION) } : {}),
    ...(learnMore ? { learnMore } : {})
  }
}

// What fixing the audit would save, when Lighthouse worked it out.
function savings(details) {
  const ms = whole(details?.overallSavingsMs)
  const bytes = whole(details?.overallSavingsBytes)
  return ms || bytes ? { savings: { ...(ms ? { ms } : {}), ...(bytes ? { bytes } : {}) } } : {}
}

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
    ...describe(audit),
    ...savings(audit.details),
    items: (audit.details?.items ?? [])
      .map(summarizeItem)
      .filter((item) => Object.keys(item).length > 0)
      .slice(0, MAX_ITEMS)
  }
}

// An audit that crashed inside Lighthouse has no score, so say why instead of dropping it.
const isBroken = (audit) => audit.scoreDisplayMode === 'error'
const brokenMessage = (audit) => `Audit ${audit.id} failed: ${audit.errorMessage ?? 'unknown error'}`

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
    warnings: [...(lhr.runWarnings ?? []), ...audits.filter(isBroken).map(brokenMessage)]
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
// entry is { summary } or { error }, in input order. `launch`, `lighthouse` and `load` can be
// injected so tests do not need Chrome.
export async function runLighthouse(urls, { launch, lighthouse, load = loadDefaults, onProgress = () => {} } = {}) {
  let chrome
  const fail = (message) => urls.map(() => ({ error: message }))
  try {
    const defaults = launch && lighthouse ? {} : await load()
    launch ??= defaults.launch
    lighthouse ??= defaults.lighthouse
  } catch (err) {
    return fail(`Could not load Lighthouse: ${err.message}`)
  }
  try {
    chrome = await launch({ chromeFlags: ['--headless'] })
  } catch (err) {
    return fail(`Could not start Chrome: ${err.message}`)
  }
  try {
    const results = []
    for (const url of urls) {
      results.push(await auditOne(url, { lighthouse, port: chrome.port }))
      onProgress(results.length)
    }
    return results
  } finally {
    // A Chrome that already died must not throw away the results. chrome-launcher's
    // kill() is synchronous while other launchers return a promise, so await either.
    try {
      await chrome.kill()
    } catch {
      // Nothing left to clean up.
    }
  }
}

// A page Lighthouse could not audit. Only informational so that a runner without Chrome
// never fails `--fail-on warning`: the static checks still ran. The category is the
// tooling one because the failed run covered all four Lighthouse categories.
export const lighthouseFailed = (url, message) => ({
  url,
  type: 'lighthouse-failed',
  severity: 'info',
  category: 'best-practice',
  source: SOURCES.lighthouse,
  message: `Lighthouse could not audit the page: ${message}`,
  context: ''
})
