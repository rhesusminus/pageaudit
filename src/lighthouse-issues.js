import { issueId } from './issue-id.js'
import { SOURCES } from './sources.js'

// Lighthouse numbers come from one simulated load on one machine, so they are lab data and vary from run to run.
// Two levels keep them from shouting: a value past "good" is only info, one past "poor" is a warning. They are
// never errors, so a noisy run cannot fail a build on its own.
//
// Metric limits follow web.dev: LCP 2.5 s and 4 s, TBT 200 ms and 600 ms, CLS 0.1 and 0.25.
// A category score under 90 is info and under 50 a warning, which is how Lighthouse colors them.
const METRIC_RULES = [
  {
    type: 'lcp-slow',
    metric: 'lcp',
    category: 'performance',
    source: SOURCES.lcp,
    good: 2500,
    poor: 4000,
    format: (value) => `${(value / 1000).toFixed(1)} s`,
    name: 'Largest Contentful Paint'
  },
  {
    type: 'cls-high',
    metric: 'cls',
    category: 'performance',
    source: SOURCES.cls,
    good: 0.1,
    poor: 0.25,
    format: (value) => String(value),
    name: 'Cumulative Layout Shift'
  },
  {
    type: 'tbt-high',
    metric: 'tbt',
    category: 'performance',
    source: SOURCES.tbt,
    good: 200,
    poor: 600,
    format: (value) => `${value} ms`,
    name: 'Total Blocking Time'
  }
]

const SCORE_RULES = [
  { type: 'score-low-performance', score: 'performance', category: 'performance', name: 'performance' },
  { type: 'score-low-accessibility', score: 'accessibility', category: 'accessibility', name: 'accessibility' },
  { type: 'score-low-best-practices', score: 'best-practices', category: 'best-practice', name: 'best practices' },
  { type: 'score-low-seo', score: 'seo', category: 'seo', name: 'SEO' }
]
const SCORE_GOOD = 90
const SCORE_POOR = 50

// The id comes from the page and the rule, as the page issues do, so a rule never has two issues on one page.
const make = (url, rule, fields) => ({
  url,
  id: issueId(url, rule.type, ''),
  type: rule.type,
  severity: fields.severity,
  category: rule.category,
  source: rule.source ?? SOURCES.lighthouse,
  message: fields.message,
  context: fields.context,
  ...fields.evidence,
  actual: fields.actual,
  expected: fields.expected
})

function metricIssue(url, rule, summary) {
  const value = summary.metrics?.[rule.metric]
  if (typeof value !== 'number' || value <= rule.good) return []
  const severity = value > rule.poor ? 'warning' : 'info'
  const element = rule.metric === 'lcp' ? summary.lcpElement : undefined
  return [
    make(url, rule, {
      severity,
      message: `${rule.name} is ${rule.format(value)} in the lab test (good is ${rule.format(rule.good)} or less)`,
      context: element?.snippet ?? element?.selector ?? `${rule.name} ${rule.format(value)}`,
      evidence: element ? { selector: element.selector, html: element.snippet } : {},
      actual: value,
      expected: `at most ${rule.good}${rule.metric === 'cls' ? '' : ' ms'}`
    })
  ]
}

function scoreIssue(url, rule, summary) {
  const value = summary.scores?.[rule.score]
  if (typeof value !== 'number' || value >= SCORE_GOOD) return []
  return [
    make(url, rule, {
      severity: value < SCORE_POOR ? 'warning' : 'info',
      message: `The Lighthouse ${rule.name} score is ${value} out of 100 (90 and up is good)`,
      context: `${rule.score} ${value}`,
      evidence: {},
      actual: value,
      expected: `at least ${SCORE_GOOD}`
    })
  ]
}

// The issues for one page from its Lighthouse summary, so the exit code, the rules and the reports treat them
// like any other finding. The audits behind them stay in the summary.
export const lighthouseIssues = (url, summary) => [
  ...METRIC_RULES.flatMap((rule) => metricIssue(url, rule, summary)),
  ...SCORE_RULES.flatMap((rule) => scoreIssue(url, rule, summary))
]
