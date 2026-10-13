import chalk from 'chalk'
import Table from 'cli-table3'
import wrapAnsi from 'wrap-ansi'
import { compareSeverity, worstFirst } from './severity.js'

// The report as tables for the terminal, sized to its width.

const COLORS = { error: chalk.red, warning: chalk.yellow, info: chalk.cyan }
const CELL_PADDING = 2
const MIN_WIDTH = 80
const MAX_WIDTH = 114

// Column widths for a table that fills the terminal (80 to 114 columns): fixed
// columns keep their width and flexible columns share the rest by weight.
function columnWidths(columns, layout) {
  const total = Math.min(Math.max(columns || MAX_WIDTH, MIN_WIDTH), MAX_WIDTH)
  const fixed = layout.filter((c) => c.width).reduce((sum, c) => sum + c.width, 0)
  const weights = layout.filter((c) => c.weight).reduce((sum, c) => sum + c.weight, 0)
  let flexible = total - (layout.length + 1) - fixed
  let remainingWeight = weights
  return layout.map((c) => {
    if (c.width) return c.width
    const width = Math.round((flexible * c.weight) / remainingWeight)
    flexible -= width
    remainingWeight -= c.weight
    return width
  })
}

// Wraps by display width ourselves: cli-table3's character wrapping counts ANSI
// escape codes as width and clips wide characters instead of wrapping them.
const wrap = (text, width) => wrapAnsi(text, width - CELL_PADDING, { hard: true, wordWrap: false, trim: false })

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const bySeverity = (issues) => issues.toSorted((a, b) => compareSeverity(a.severity, b.severity))

const count = (n, color) => (n ? color(String(n)) : chalk.dim('0'))

function formatStatus(status) {
  if (status === null) return chalk.red('failed')
  return status === 200 ? String(status) : chalk.red(String(status))
}

export function formatPagesTable(pages, columns) {
  const widths = columnWidths(columns, [{ weight: 1 }, { width: 8 }, { width: 8 }, { width: 10 }, { width: 7 }])
  const table = new Table({
    head: ['URL', 'Status', 'Errors', 'Warnings', 'Infos'],
    colWidths: widths,
    colAligns: ['left', 'right', 'right', 'right', 'right'],
    style: { head: [], compact: true }
  })
  for (const { url, status, counts } of worstFirst(pages)) {
    table.push([
      wrap(url, widths[0]),
      formatStatus(status),
      count(counts.errors, chalk.red),
      count(counts.warnings, chalk.yellow),
      count(counts.infos, chalk.cyan)
    ])
  }
  return table.toString()
}

export function formatIssueTable(issues, columns) {
  const widths = columnWidths(columns, [{ width: 10 }, { width: 15 }, { weight: 38 }, { weight: 46 }])
  const table = new Table({
    head: ['Severity', 'Category', 'Issue', 'Context'],
    colWidths: widths,
    wordWrap: true,
    style: { head: [] }
  })
  for (const issue of bySeverity(issues)) {
    table.push([
      COLORS[issue.severity](issue.severity),
      chalk.dim(issue.category),
      issue.message,
      wrap(chalk.dim(issue.context ?? ''), widths[3])
    ])
  }
  return table.toString()
}

export function formatSiteTable(issues, columns) {
  const widths = columnWidths(columns, [{ width: 10 }, { width: 15 }, { weight: 38 }, { weight: 46 }])
  const table = new Table({
    head: ['Severity', 'Category', 'Issue', 'Pages'],
    colWidths: widths,
    wordWrap: true,
    style: { head: [] }
  })
  for (const issue of bySeverity(issues)) {
    table.push([
      COLORS[issue.severity](issue.severity),
      chalk.dim(issue.category),
      `${issue.message}\n${wrap(chalk.dim(issue.context), widths[2])}`,
      issue.urls.map((url) => wrap(url, widths[3])).join('\n')
    ])
  }
  return table.toString()
}

const MAX_AUDITS = 8
const scoreColor = (score) => (score >= 90 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red)
const metricText = ({ fcp, lcp, tbt, cls, speedIndex }) => {
  const ms = (value) => (value === null ? 'n/a' : `${value} ms`)
  return `FCP ${ms(fcp)}, LCP ${ms(lcp)}, TBT ${ms(tbt)}, CLS ${cls ?? 'n/a'}, SI ${ms(speedIndex)}`
}

// Scores, core metrics and the worst failing audits of one page's Lighthouse run.
export function formatLighthouse({ scores, metrics, audits, omittedAudits = 0 }, columns) {
  const scoreLine = Object.entries(scores)
    .map(([id, score]) => `${id} ${score === null ? chalk.dim('n/a') : scoreColor(score)(String(score))}`)
    .join('  ')
  const widths = columnWidths(columns, [{ width: 7 }, { width: 16 }, { weight: 1 }, { width: 22 }])
  const table = new Table({ head: ['Score', 'Category', 'Audit', 'Value'], colWidths: widths, style: { head: [] } })
  for (const a of audits.slice(0, MAX_AUDITS)) {
    table.push([
      String(a.score),
      chalk.dim(a.category),
      wrap(a.title, widths[2]),
      wrap(a.displayValue ?? '', widths[3])
    ])
  }
  const left = Math.max(audits.length - MAX_AUDITS, 0) + omittedAudits
  const more = left > 0 ? chalk.dim(`  ...and ${left} more`) : ''
  return [
    `  Lighthouse: ${scoreLine}`,
    chalk.dim(`  ${metricText(metrics)}`),
    audits.length ? table.toString() : '',
    more
  ]
    .filter(Boolean)
    .join('\n')
}

export function formatReport(report, columns) {
  const out = [formatPagesTable(report.pages, columns)]
  const sorted = worstFirst(report.pages)
  for (const page of sorted.filter((p) => p.issues.length || p.lighthouse)) {
    out.push(`\n${chalk.bold(page.url)}`)
    if (page.issues.length) out.push(formatIssueTable(page.issues, columns))
    if (page.lighthouse) out.push(formatLighthouse(page.lighthouse, columns))
  }
  const clean = sorted.filter((p) => !p.issues.length && !p.lighthouse).length
  if (clean) out.push(chalk.green(`\n${plural(clean, 'page')} clean`))
  out.push(
    chalk.bold('\nSite'),
    report.site.length ? formatSiteTable(report.site, columns) : chalk.green('  No cross-page issues')
  )
  out.push(formatSummary(report))
  return out.join('\n')
}

export function formatSummary({ summary }) {
  const { pages, errors, warnings, infos } = summary
  const parts = [
    [plural(errors, 'error'), errors, chalk.red],
    [plural(warnings, 'warning'), warnings, chalk.yellow],
    [plural(infos, 'info'), infos, chalk.cyan]
  ]
  return `\n${[plural(pages, 'page'), ...parts.map(([text, n, color]) => (n ? color(text) : text))].join(', ')}`
}
