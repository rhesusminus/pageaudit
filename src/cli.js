import { parseArgs } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { checkSite } from './checks/site/index.js'
import { fromArgs } from './input/args.js'
import { fromFile } from './input/file.js'
import { resolveUrls } from './input/resolve.js'
import { fromSitemap } from './input/sitemap.js'
import { lighthouseFailed, runLighthouse } from './lighthouse.js'
import { writeReportFile } from './output.js'
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
  --lighthouse         also run Lighthouse (needs Chrome) on every page that returned HTML, one at a time
  --fail-on <level>    exit 1 on any "error" (default) or on any "warning" or error
  --out <path>         also write the JSON report to a file, for example to hand to Claude
  --json               print the report as JSON (default when stdout is not a TTY)
  -h, --help           show this help

--urls-file and --sitemap can be given more than once.`

const OPTIONS = {
  'urls-file': { type: 'string', multiple: true },
  sitemap: { type: 'string', multiple: true },
  limit: { type: 'string' },
  concurrency: { type: 'string' },
  delay: { type: 'string' },
  lighthouse: { type: 'boolean' },
  out: { type: 'string' },
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
    lighthouse: values.lighthouse,
    out: values.out,
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

// Resolves the URLs to audit. Returns { inputs } or { exitCode } when reading the inputs failed.
async function loadInputs(options, stdin, startSpinner) {
  const spinner = options.sitemaps.length || options.files.includes('-') ? startSpinner('Reading URLs') : null
  try {
    const inputs = await readInputs(options, stdin, spinner)
    spinner?.stop()
    return { inputs }
  } catch (err) {
    spinner?.fail(err.message)
    if (!spinner) console.error(err.message)
    return { exitCode: 2 }
  }
}

// Reports skipped and limited inputs. Returns false when there is nothing to audit.
function announceInputs({ urls, skipped, total }, options) {
  for (const { input, source, reason } of skipped) {
    console.error(chalk.yellow(`Skipped ${input} (${source}): ${reason}`))
  }
  if (!urls.length) {
    console.error('No URLs to audit.')
    return false
  }
  if (total > urls.length) {
    console.error(`Auditing the first ${urls.length} of ${total} URLs (--limit ${options.limit}).`)
  }
  return true
}

async function auditUrls(urls, options, startSpinner) {
  const progress = (done) => `Auditing ${done}/${urls.length} pages...`
  const spinner = startSpinner(progress(0))
  const pages = await runAudit(urls, {
    concurrency: options.concurrency,
    delay: options.delay,
    onProgress: (done) => {
      if (spinner) spinner.text = progress(done)
    }
  })
  spinner?.stop()
  return pages
}

// Runs Lighthouse once per distinct final URL (several inputs can redirect to the same
// page) and attaches the outcome to every page that ended up there.
async function addLighthouse(pages, startSpinner, runner) {
  const targets = pages.filter((page) => page.facts !== null)
  const urls = [...new Set(targets.map((page) => page.finalUrl))]
  if (!urls.length) return
  const progress = (done) => `Lighthouse ${done}/${urls.length} pages...`
  const spinner = startSpinner(progress(0))
  const results = await runner(urls, {
    onProgress: (done) => {
      if (spinner) spinner.text = progress(done)
    }
  })
  spinner?.stop()
  for (const page of targets) {
    const result = results[urls.indexOf(page.finalUrl)]
    page.lighthouse = result.summary ?? null
    if (result.error) page.issues.push(lighthouseFailed(page.url, result.error))
  }
}

export async function run(argv, { stdin = process.stdin, lighthouse = runLighthouse } = {}) {
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

  const { inputs, exitCode } = await loadInputs(options, stdin, startSpinner)
  if (exitCode) return exitCode
  if (!announceInputs(inputs, options)) return 2

  const pages = await auditUrls(inputs.urls, options, startSpinner)
  if (options.lighthouse) await addLighthouse(pages, startSpinner, lighthouse)
  const report = buildReport({ pages, site: checkSite(pages), skipped: inputs.skipped })
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report, process.stdout.columns))
  if (options.out) {
    const failure = await writeReportFile(options.out, `${JSON.stringify(report, null, 2)}\n`)
    if (failure) {
      console.error(failure)
      return 2
    }
  }

  const { errors, warnings } = report.summary
  return errors > 0 || (options.failOn === 'warning' && warnings > 0) ? 1 : 0
}
