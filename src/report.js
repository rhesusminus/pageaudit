import chalk from 'chalk';
import Table from 'cli-table3';

const CATEGORY_LABELS = { images: 'Images', meta: 'Meta', headings: 'Headings' };
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
      colWidths: [10, 15, 38, 46],
      wordWrap: true,
      wrapOnWordBoundary: false,
      style: { head: [] },
    });
    for (const issue of issues) {
      table.push([
        COLORS[issue.severity](issue.severity),
        chalk.dim(issue.category),
        { content: issue.message, wrapOnWordBoundary: true },
        chalk.dim(issue.context),
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
