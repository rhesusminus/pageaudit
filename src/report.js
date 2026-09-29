import chalk from 'chalk';
import Table from 'cli-table3';
import wrapAnsi from 'wrap-ansi';

const CATEGORY_LABELS = { images: 'Images', meta: 'Meta', headings: 'Headings' };
const COLORS = { error: chalk.red, warning: chalk.yellow, info: chalk.cyan };
const CELL_PADDING = 2;
// Severity and Category fit their longest values; Issue and Context share the rest.
const FIXED_WIDTHS = [10, 15];
const MIN_WIDTH = 80;
const MAX_WIDTH = 114;
const BORDERS = 5;

function columnWidths(columns) {
  const total = Math.min(Math.max(columns || MAX_WIDTH, MIN_WIDTH), MAX_WIDTH);
  const shared = total - BORDERS - FIXED_WIDTHS[0] - FIXED_WIDTHS[1];
  const issue = Math.round((shared * 38) / 84);
  return [...FIXED_WIDTHS, issue, shared - issue];
}

export function buildReport(url, categories) {
  const summary = { errors: 0, warnings: 0, infos: 0 };
  for (const issues of Object.values(categories)) {
    for (const issue of issues) {
      if (issue.severity === 'error') summary.errors++;
      else if (issue.severity === 'warning') summary.warnings++;
      else summary.infos++;
    }
  }
  return { url, categories, summary };
}

export function formatTable(report, columns) {
  const widths = columnWidths(columns);
  const out = [];
  for (const [key, issues] of Object.entries(report.categories)) {
    out.push(chalk.bold(`\n${CATEGORY_LABELS[key] ?? key}`));
    if (issues.length === 0) {
      out.push(chalk.green('  OK'));
      continue;
    }
    const table = new Table({
      head: ['Severity', 'Category', 'Issue', 'Context'],
      colWidths: widths,
      wordWrap: true,
      style: { head: [] },
    });
    for (const issue of issues) {
      table.push([
        COLORS[issue.severity](issue.severity),
        chalk.dim(issue.category),
        issue.message,
        // Wrap ourselves by display width: cli-table3's character wrapping counts ANSI
        // escape codes as width and clips wide characters instead of wrapping them.
        wrapAnsi(chalk.dim(issue.context ?? ''), widths[3] - CELL_PADDING, { hard: true, wordWrap: false, trim: false }),
      ]);
    }
    out.push(table.toString());
  }
  return out.join('\n');
}

export function formatSummary({ summary }) {
  const { errors, warnings, infos } = summary;
  const parts = [
    [`${errors} error${errors === 1 ? '' : 's'}`, errors, chalk.red],
    [`${warnings} warning${warnings === 1 ? '' : 's'}`, warnings, chalk.yellow],
    [`${infos} info${infos === 1 ? '' : 's'}`, infos, chalk.cyan],
  ];
  return `\n${parts.map(([text, count, color]) => (count ? color(text) : text)).join(', ')}`;
}
