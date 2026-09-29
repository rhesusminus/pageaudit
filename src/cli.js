import { parseArgs } from 'node:util';
import ora from 'ora';
import { fetchHtml } from './fetch.js';
import { parse } from './parse.js';
import { checkImages } from './checks/images.js';
import { checkMeta } from './checks/meta.js';
import { checkHeadings } from './checks/headings.js';
import { buildReport, formatSummary, formatTable } from './report.js';

const USAGE = 'Usage: pageaudit <url> [--json]';

// ora sizes its line clearing as ceil(width / columns), so a TTY that reports
// 0 columns (Docker -t, some CI terminals) makes spinner.stop() loop forever.
export function canSpin(stream) {
  return Boolean(stream.isTTY) && stream.columns > 0;
}

export async function run(argv) {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    }));
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }

  if (values.help || positionals.length !== 1) {
    (values.help ? console.log : console.error)(USAGE);
    return values.help ? 0 : 2;
  }

  const [url] = positionals;
  const json = values.json ?? !process.stdout.isTTY;
  const spinner =
    json || !canSpin(process.stderr)
      ? null
      : ora({ text: `Auditing ${url}`, stream: process.stderr }).start();

  let report;
  try {
    const $ = parse(await fetchHtml(url));
    report = buildReport(url, {
      images: checkImages($),
      meta: checkMeta($),
      headings: checkHeadings($),
    });
  } catch (err) {
    spinner?.fail(err.message);
    if (!spinner) console.error(err.message);
    return 2;
  }
  spinner?.stop();

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTable(report, process.stdout.columns));
    console.log(formatSummary(report));
  }
  return report.summary.errors > 0 ? 1 : 0;
}
