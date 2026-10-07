import { parseArgs } from 'node:util'
import chalk from 'chalk'
import ora from 'ora'
import { checkRobotsTxt } from './checks/site/robots.js'
import { checkSite } from './checks/site/index.js'
import { checkSitemapEntries } from './checks/site/sitemap.js'
import { readLogo } from './html/logo.js'
import { renderHtml } from './html/render.js'
import { fromArgs } from './input/args.js'
import { fromFile } from './input/file.js'
import { resolveUrls } from './input/resolve.js'
import { fromSitemap } from './input/sitemap.js'
import { lighthouseFailed, runLighthouse, shortSummary } from './lighthouse.js'
import { directoryOutputs, writeReportFile } from './output.js'
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
  --lighthouse-page <url>
                       run Lighthouse with full detail on this page (added to the audit if missing, never cut by
                       --limit). A URL in a --urls-file can be followed by "lighthouse" to do the same.
                       With these and no --lighthouse, only those pages run. With --lighthouse too, the others
                       get a short summary.
  --fail-on <level>    exit 1 on any "error" (default) or on any "warning" or error
  --out <path>         also write the JSON report to a file, for example to hand to Claude
  --html <path>        also write a report for customers as one self-contained HTML file
  --title <text>       report title in the HTML report (default "Website audit")
  --client <name>      client name shown in the HTML report
  --logo <file>        logo for the HTML report (png, jpg, gif, webp or svg, at most 512 KB)
  --json               print the report as JSON (default when stdout is not a TTY)
  -h, --help           show this help

--urls-file, --sitemap and --lighthouse-page can be given more than once.`

const OPTIONS = {
  'urls-file': { type: 'string', multiple: true },
  sitemap: { type: 'string', multiple: true },
  limit: { type: 'string' },
  concurrency: { type: 'string' },
  delay: { type: 'string' },
  lighthouse: { type: 'boolean' },
  'lighthouse-page': { type: 'string', multiple: true },
  out: { type: 'string' },
  html: { type: 'string' },
  title: { type: 'string' },
  client: { type: 'string' },
  logo: { type: 'string' },
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

// An empty value, such as --out "", is almost always a shell variable that was not set.
function requireValues(values, names) {
  for (const name of names) {
    if (values[name] === '') throw new Error(`--${name} needs a value`)
  }
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  requireValues(values, ['out', 'html', 'title', 'client', 'logo'])
  if (values['lighthouse-page']?.includes('')) throw new Error('--lighthouse-page needs a value')
  const failOn = values['fail-on'] ?? 'error'
  if (failOn !== 'error' && failOn !== 'warning') {
    throw new Error(`--fail-on must be "error" or "warning", got "${failOn}"`)
  }
  if (!values.html && (values.title || values.client || values.logo)) {
    throw new Error('--title, --client and --logo only apply together with --html')
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
    lighthousePages: values['lighthouse-page'] ?? [],
    out: values.out,
    html: values.html,
    branding: { title: values.title, client: values.client, logo: values.logo },
    json: values.json
  }
}

// Collects entries from every input. Only the inputs themselves are fatal (a file
// that cannot be read, a sitemap that cannot be fetched); bad URLs are skipped.
async function readInputs(options, stdin, spinner) {
  const entries = fromArgs(options.urls)
  const chosen = options.lighthousePages.map((value) => ({ value, source: '--lighthouse-page', lighthouse: true }))
  const skipped = []
  for (const path of options.files) entries.push(...(await fromFile(path, { stdin })))
  for (const url of options.sitemaps) {
    if (spinner) spinner.text = `Reading sitemap ${url}`
    const sitemap = await fromSitemap(url)
    entries.push(...sitemap.entries)
    skipped.push(...sitemap.skipped)
  }
  const resolved = resolveUrls([...entries, ...chosen], { limit: options.limit })
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
  if (options.limit && total > options.limit) {
    // Pages picked for Lighthouse are kept past the limit.
    const extra = urls.length - options.limit
    const plus = extra > 0 ? `, plus ${extra} picked for Lighthouse` : ''
    console.error(`Auditing the first ${options.limit} of ${total} URLs (--limit ${options.limit})${plus}.`)
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
// page) and attaches the outcome to every page that ended up there. `all` is --lighthouse and `chosen` the pages
// picked with --lighthouse-page or a marker, by the URL as given. Picked pages get the full detail, also when
// another page lands on the same final URL. Without any picked page every page does, and with some the others only
// get the short summary.
async function addLighthouse(pages, startSpinner, runner, { all, chosen }) {
  const picked = new Set(chosen)
  const isPicked = (page) => picked.has(page.url)
  // A page the user picked but that gave no HTML gets told why, instead of silently losing the run.
  for (const page of pages.filter((p) => p.facts === null && isPicked(p))) {
    page.issues.push(lighthouseFailed(page.url, 'the page did not return HTML'))
  }
  const targets = pages.filter((page) => page.facts !== null && (all || isPicked(page)))
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
    const detailed = picked.size === 0 || isPicked(page)
    page.lighthouse = result.summary && !detailed ? shortSummary(result.summary) : (result.summary ?? null)
    if (result.error) page.issues.push(lighthouseFailed(page.url, result.error))
  }
}

// Reads the robots.txt files of the audited sites, with a spinner because a slow host can take a while.
async function readRobots(pages, startSpinner) {
  const loaded = pages.some((page) => page.status === 200 && page.finalUrl)
  const spinner = loaded ? startSpinner('Reading robots.txt...') : null
  try {
    return await checkRobotsTxt(pages)
  } finally {
    spinner?.stop()
  }
}

// Writes the --out and --html files. Returns false after printing why when one failed.
async function writeFiles(options, report, { logo, totalUrls }) {
  const files = []
  if (options.out) files.push([options.out, `${JSON.stringify(report, null, 2)}\n`])
  if (options.html) {
    const { title, client } = options.branding
    files.push([options.html, renderHtml(report, { title, client, logo, totalUrls })])
  }
  let ok = true
  for (const [path, content] of files) {
    const failure = await writeReportFile(path, content)
    if (failure) console.error(failure)
    ok &&= !failure
  }
  return ok
}

// The logo is read before the audit starts, so a bad file fails fast. Returns the data
// URI, null when there is no logo, or undefined after printing why it failed.
async function loadLogo(path) {
  if (!path) return null
  try {
    return await readLogo(path)
  } catch (err) {
    console.error(err.message)
    return undefined
  }
}

// Report files that are directories fail only after the whole audit, so they are refused up front.
async function outputsAreFiles(options) {
  const directories = await directoryOutputs([
    ['--out', options.out],
    ['--html', options.html]
  ])
  if (directories.length) console.error(directories.join('\n'))
  return directories.length === 0
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
  if (!options.urls.length && !options.files.length && !options.sitemaps.length && !options.lighthousePages.length) {
    console.error(USAGE)
    return 2
  }

  if (!(await outputsAreFiles(options))) return 2

  const logo = await loadLogo(options.branding.logo)
  if (logo === undefined) return 2

  const json = options.json ?? !process.stdout.isTTY
  const spin = !json && canSpin(process.stderr)
  const startSpinner = (text) => (spin ? ora({ text, stream: process.stderr }).start() : null)

  const { inputs, exitCode } = await loadInputs(options, stdin, startSpinner)
  if (exitCode) return exitCode
  if (!announceInputs(inputs, options)) return 2

  const pages = await auditUrls(inputs.urls, options, startSpinner)
  if (options.lighthouse || inputs.marked.length) {
    await addLighthouse(pages, startSpinner, lighthouse, { all: options.lighthouse, chosen: inputs.marked })
  }
  const site = [
    ...checkSite(pages),
    ...(await readRobots(pages, startSpinner)),
    ...checkSitemapEntries(pages, inputs.listed)
  ]
  const report = buildReport({ pages, site, skipped: inputs.skipped })
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report, process.stdout.columns))
  if (!(await writeFiles(options, report, { logo, totalUrls: inputs.total }))) return 2

  const { errors, warnings } = report.summary
  return errors > 0 || (options.failOn === 'warning' && warnings > 0) ? 1 : 0
}
