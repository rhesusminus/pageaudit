import chalk from 'chalk';
import Table from 'cli-table3';

const CATEGORY_LABELS = { images: 'Images', meta: 'Meta', headings: 'Headings' };
const COL_WIDTHS = [10, 15, 38, 46];
const CELL_PADDING = 2;
const COLORS = { error: chalk.red, warning: chalk.yellow, info: chalk.cyan };

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

// Hard-wraps plain text by character. Must run before coloring: cli-table3's
// character wrapping counts ANSI escape codes as width and splits them.
function hardWrap(text, width) {
  return text
    .split('\n')
    .flatMap((line) => {
      const chars = Array.from(line);
      const lines = [];
      for (let i = 0; i < chars.length; i += width) lines.push(chars.slice(i, i + width).join(''));
      return lines.length ? lines : [''];
    })
    .join('\n');
}

export function formatTable(report) {
  const out = [];
  for (const [key, issues] of Object.entries(report.categories)) {
    out.push(chalk.bold(`\n${CATEGORY_LABELS[key] ?? key}`));
    if (issues.length === 0) {
      out.push(chalk.green('  OK'));
      continue;
    }
    const table = new Table({
      head: ['Severity', 'Category', 'Issue', 'Context'],
      colWidths: COL_WIDTHS,
      wordWrap: true,
      style: { head: [] },
    });
    for (const issue of issues) {
      table.push([
        COLORS[issue.severity](issue.severity),
        chalk.dim(issue.category),
        issue.message,
        hardWrap(issue.context ?? '', COL_WIDTHS[3] - CELL_PADDING)
          .split('\n')
          .map((line) => chalk.dim(line))
          .join('\n'),
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
