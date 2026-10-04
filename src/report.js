import chalk from 'chalk'
import Table from 'cli-table3'
import wrapAnsi from 'wrap-ansi'

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }
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

export function countSeverities(issues) {
  const counts = { errors: 0, warnings: 0, infos: 0 }
  for (const { severity } of issues) {
    if (severity === 'error') counts.errors++
    else if (severity === 'warning') counts.warnings++
    else counts.infos++
  }
  return counts
}

// The JSON report. Facts used by the site checks are internal and left out.
export function buildReport({ pages, site, skipped = [] }) {
  const totals = countSeverities([...pages.flatMap((page) => page.issues), ...site])
  return {
    pages: pages.map(({ url, finalUrl, status, redirects, issues }) => ({ url, finalUrl, status, redirects, issues })),
    site,
    skipped,
    summary: { pages: pages.length, ...totals }
  }
}

// Worst pages first: most errors, then warnings, then infos. Ties keep input order.
function worstFirst(pages) {
  return pages
    .map((page) => ({ ...page, counts: countSeverities(page.issues) }))
    .sort(
      (a, b) =>
        b.counts.errors - a.counts.errors || b.counts.warnings - a.counts.warnings || b.counts.infos - a.counts.infos
    )
}

const bySeverity = (issues) => issues.toSorted((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

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

export function formatReport(report, columns) {
  const out = [formatPagesTable(report.pages, columns)]
  const sorted = worstFirst(report.pages)
  for (const page of sorted.filter((p) => p.issues.length)) {
    out.push(`\n${chalk.bold(page.url)}`, formatIssueTable(page.issues, columns))
  }
  const clean = sorted.filter((p) => !p.issues.length).length
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
