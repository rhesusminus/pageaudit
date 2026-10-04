import { parseArgs } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { checkSite } from './checks/site/index.js'
import { fromArgs } from './input/args.js'
import { fromFile } from './input/file.js'
import { resolveUrls } from './input/resolve.js'
import { fromSitemap } from './input/sitemap.js'
import { buildReport, formatReport } from './report.js'
import { DEFAULT_CONCURRENCY, DEFAULT_DELAY_MS, runAudit } from './runner.js'

const USAGE = `Usage: pageaudit [url...] [--urls-file <path>] [--sitemap <url>] [options]
Run "pageaudit --help" for all options.`

const HELP = `Usage: pageaudit [url...] [--urls-file <path>] [--sitemap <url>] [options]

Audits one or more pages for basic SEO and HTML issues. URLs from arguments,
files and sitemaps are merged and deduplicated.

Options:
  --urls-file <path>   read URLs from a file, one per line, # for comments ("-" reads stdin)
  --sitemap <url>      read URLs from a sitemap, following a sitemap index one level deep
  --limit <n>          audit at most n pages
  --concurrency <n>    pages fetched at the same time (default ${DEFAULT_CONCURRENCY})
  --delay <ms>         minimum time between requests to the same host (default ${DEFAULT_DELAY_MS})
  --fail-on <level>    exit 1 on any "error" (default) or on any "warning" or error
  --json               print the report as JSON (default when stdout is not a TTY)
  -h, --help           show this help

--urls-file and --sitemap can be given more than once.`

const OPTIONS = {
  'urls-file': { type: 'string', multiple: true },
  sitemap: { type: 'string', multiple: true },
  limit: { type: 'string' },
  concurrency: { type: 'string' },
  delay: { type: 'string' },
  'fail-on': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
}

// ora sizes its line clearing as ceil(width / columns), so a TTY that reports
// 0 columns (Docker -t, some CI terminals) makes spinner.stop() loop forever.
export function canSpin(stream) {
  return Boolean(stream.isTTY) && stream.columns > 0
}

function integer(name, value, min) {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value) || Number(value) < min) {
    throw new Error(`--${name} must be a whole number of at least ${min}, got "${value}"`)
  }
  return Number(value)
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  const failOn = values['fail-on'] ?? 'error'
  if (failOn !== 'error' && failOn !== 'warning') {
    throw new Error(`--fail-on must be "error" or "warning", got "${failOn}"`)
  }
  return {
    help: values.help,
    urls: positionals,
    files: values['urls-file'] ?? [],
    sitemaps: values.sitemap ?? [],
    limit: integer('limit', values.limit, 1),
    concurrency: integer('concurrency', values.concurrency, 1),
    delay: integer('delay', values.delay, 0),
    failOn,
    json: values.json
  }
}

// Collects entries from every input. Only the inputs themselves are fatal (a file
// that cannot be read, a sitemap that cannot be fetched); bad URLs are skipped.
async function readInputs(options, stdin, spinner) {
  const entries = fromArgs(options.urls)
  const skipped = []
  for (const path of options.files) entries.push(...(await fromFile(path, { stdin })))
  for (const url of options.sitemaps) {
    if (spinner) spinner.text = `Reading sitemap ${url}`
    const sitemap = await fromSitemap(url)
    entries.push(...sitemap.entries)
    skipped.push(...sitemap.skipped)
  }
  const resolved = resolveUrls(entries, { limit: options.limit })
  return { ...resolved, skipped: [...skipped, ...resolved.skipped] }
}

export async function run(argv, { stdin = process.stdin } = {}) {
  let options
  try {
    options = parseOptions(argv)
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`)
    return 2
  }
  if (options.help) {
    console.log(HELP)
    return 0
  }
  if (!options.urls.length && !options.files.length && !options.sitemaps.length) {
    console.error(USAGE)
    return 2
  }

  const json = options.json ?? !process.stdout.isTTY
  const spin = !json && canSpin(process.stderr)
  const startSpinner = (text) => (spin ? ora({ text, stream: process.stderr }).start() : null)

  let inputs
  let spinner = options.sitemaps.length || options.files.includes('-') ? startSpinner('Reading URLs') : null
  try {
    inputs = await readInputs(options, stdin, spinner)
  } catch (err) {
    spinner?.fail(err.message)
    if (!spinner) console.error(err.message)
    return 2
  }
  spinner?.stop()

  const { urls, skipped, total } = inputs
  for (const { input, source, reason } of skipped) {
    console.error(chalk.yellow(`Skipped ${input} (${source}): ${reason}`))
  }
  if (!urls.length) {
    console.error('No URLs to audit.')
    return 2
  }
  if (total > urls.length) {
    console.error(`Auditing the first ${urls.length} of ${total} URLs (--limit ${options.limit}).`)
  }

  const progress = (done) => `Auditing ${done}/${urls.length} pages...`
  spinner = startSpinner(progress(0))
  const pages = await runAudit(urls, {
    concurrency: options.concurrency,
    delay: options.delay,
    onProgress: (done) => {
      if (spinner) spinner.text = progress(done)
    }
  })
  spinner?.stop()

  const report = buildReport({ pages, site: checkSite(pages), skipped })
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report, process.stdout.columns))

  const { errors, warnings } = report.summary
  return errors > 0 || (options.failOn === 'warning' && warnings > 0) ? 1 : 0
}
