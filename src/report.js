import chalk from 'chalk';
import Table from 'cli-table3';

const CATEGORY_LABELS = { images: 'Images', meta: 'Meta', headings: 'Headings' };

export function buildReport(url, categories) {
  let errors = 0;
  let warnings = 0;
  for (const issues of Object.values(categories)) {
    for (const issue of issues) {
      if (issue.severity === 'error') errors++;
      else warnings++;
    }
  }
  return { url, categories, summary: { errors, warnings } };
}

const paint = (severity) => (severity === 'error' ? chalk.red : chalk.yellow);

export function formatTable(report) {
  const out = [];
  for (const [key, issues] of Object.entries(report.categories)) {
    out.push(chalk.bold(`\n${CATEGORY_LABELS[key] ?? key}`));
    if (issues.length === 0) {
      out.push(chalk.green('  OK'));
      continue;
    }
    const table = new Table({
      head: ['Severity', 'Issue', 'Context'],
      colWidths: [10, 46, 60],
      wordWrap: true,
      wrapOnWordBoundary: false,
      style: { head: [] },
    });
    for (const issue of issues) {
      table.push([
        paint(issue.severity)(issue.severity),
        { content: issue.message, wrapOnWordBoundary: true },
        chalk.dim(issue.context),
      ]);
    }
    out.push(table.toString());
  }
  return out.join('\n');
}

export function formatSummary({ summary }) {
  const { errors, warnings } = summary;
  const e = `${errors} error${errors === 1 ? '' : 's'}`;
  const w = `${warnings} warning${warnings === 1 ? '' : 's'}`;
  return `\n${errors ? chalk.red(e) : e}, ${warnings ? chalk.yellow(w) : w}`;
}
