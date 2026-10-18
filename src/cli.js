import chalk from 'chalk'
import { checkLinks } from './checks/site/links.js'
import { checkRobotsTxt } from './checks/site/robots.js'
import { checkSite } from './checks/site/index.js'
import {
  checkSitemapDeclared,
  checkSitemapEntries,
  checkSitemapFiles,
  checkSitemapHosts
} from './checks/site/sitemap.js'
import { readLogo } from './html/logo.js'
import { renderHtml } from './html/render.js'
import { fromArgs } from './input/args.js'
import { fromFile } from './input/file.js'
import { resolveUrls } from './input/resolve.js'
import { fromSitemap } from './input/sitemap.js'
import { cachedRobotsLoader, loadRobots } from './robots.js'
import { lighthouseFailed, runLighthouse, shortSummary } from './lighthouse.js'
import { hostThrottle } from './concurrency.js'
import { buildCoverage, orphansSkipped } from './coverage.js'
import { checkLinkTargets } from './links.js'
import { lighthouseIssues } from './lighthouse-issues.js'
import { HELP, parseOptions, USAGE } from './options.js'
import { reportPathProblems, writeReportFile } from './output.js'
import { createProgress } from './progress.js'
import { buildReport } from './report.js'
import { formatReport } from './terminal.js'
import { checksFailed, DEFAULT_DELAY_MS, runAudit } from './runner.js'

// Collects entries from every input. Only the inputs themselves are fatal (a file
// that cannot be read, a sitemap that cannot be fetched); bad URLs are skipped.
async function readInputs(options, stdin, { spinner, pace }) {
  const entries = fromArgs(options.urls)
  const chosen = options.lighthousePages.map((value) => ({ value, source: '--lighthouse-page', lighthouse: true }))
  const skipped = []
  const sitemapFiles = []
  // False when a sitemap index listed a file that could not be read or was not followed, so pages may be missing.
  let sitemapsComplete = true
  const cache = new Map()
  // Pushed one by one: a list of a hundred thousand entries is too many arguments for push(...list).
  for (const path of options.files) for (const entry of await fromFile(path, { stdin })) entries.push(entry)
  // A sitemap given twice is followed once, so its skipped files are not reported twice.
  for (const url of new Set(options.sitemaps)) {
    spinner.update(`Reading sitemap ${url}`)
    const sitemap = await fromSitemap(url, { beforeHop: pace, cache })
    for (const entry of sitemap.entries) entries.push(entry)
    for (const skip of sitemap.skipped) skipped.push(skip)
    for (const file of sitemap.files) sitemapFiles.push(file)
    sitemapsComplete &&= sitemap.skipped.length === 0
  }
  const resolved = resolveUrls([...entries, ...chosen], { limit: options.limit })
  return { ...resolved, skipped: [...skipped, ...resolved.skipped], sitemapFiles, sitemapsComplete }
}

// Resolves the URLs to audit. Returns { inputs } or { exitCode } when reading the inputs failed.
async function loadInputs(options, stdin, { progress, pace }) {
  const reading = options.sitemaps.length || options.files.includes('-')
  const spinner = reading ? progress.start('Reading URLs') : progress.silent
  try {
    const inputs = await readInputs(options, stdin, { spinner, pace })
    spinner.stop()
    return { inputs }
  } catch (err) {
    spinner.fail(err.message)
    return { exitCode: 2 }
  }
}

// Reports skipped and limited inputs. Returns false when there is nothing to audit. Sitemap files that were
// read are still checked when none of their entries is a page to audit.
function announceInputs({ urls, skipped, total, sitemapFiles }, options) {
  for (const { input, source, reason } of skipped) {
    console.error(chalk.yellow(`Skipped ${input} (${source}): ${reason}`))
  }
  if (!urls.length) {
    console.error(sitemapFiles.length ? 'No URLs to audit, only the sitemap files were checked.' : 'No URLs to audit.')
    return sitemapFiles.length > 0
  }
  if (options.limit && total > options.limit) {
    // Pages picked for Lighthouse are kept past the limit.
    const extra = urls.length - options.limit
    const plus = extra > 0 ? `, plus ${extra} picked for Lighthouse` : ''
    console.error(`Auditing the first ${options.limit} of ${total} URLs (--limit ${options.limit})${plus}.`)
  }
  return true
}

async function auditUrls(urls, options, { progress, pace }) {
  const text = (done) => `Auditing ${done}/${urls.length} pages...`
  const spinner = progress.start(text(0))
  const pages = await runAudit(urls, {
    concurrency: options.concurrency,
    pace,
    onProgress: (done) => spinner.update(text(done))
  })
  spinner.stop()
  return pages
}

// Lighthouse loads the page in Chrome, so it also runs on a page whose HTML the static checks could not process.
const returnedHtml = (page) => page.facts !== null || checksFailed(page)

// Runs Lighthouse once per distinct final URL (several inputs can redirect to the same
// page) and attaches the outcome to every page that ended up there. `all` is --lighthouse and `chosen` the pages
// picked with --lighthouse-page or a marker, by the URL as given. Picked pages get the full detail, also when
// another page lands on the same final URL. Without any picked page every page does, and with some the others only
// get the short summary.
async function addLighthouse(pages, progress, runner, { all, chosen, runs }) {
  if (!all && chosen.length === 0) {
    if (runs) console.error('--lighthouse-runs has no effect without --lighthouse or a page picked for Lighthouse.')
    return
  }
  const picked = new Set(chosen)
  const isPicked = (page) => picked.has(page.url)
  // A page the user picked but that gave no HTML gets told why, instead of silently losing the run.
  for (const page of pages.filter((p) => !returnedHtml(p) && isPicked(p))) {
    page.issues.push(lighthouseFailed(page.url, 'the page did not return HTML'))
  }
  const targets = pages.filter((page) => returnedHtml(page) && (all || isPicked(page)))
  const urls = [...new Set(targets.map((page) => page.finalUrl))]
  if (!urls.length) return
  // Unset until here, so the warning above can tell whether it was given. The bar counts the runs too.
  runs ??= 1
  const { onProgress, onStatus, stop } = progress.lighthouse(urls.length, runs)
  const results = await runner(urls, { runs, onProgress, onStatus })
  stop()
  for (const page of targets) {
    const result = results[urls.indexOf(page.finalUrl)]
    const detailed = picked.size === 0 || isPicked(page)
    page.lighthouse = result.summary && !detailed ? shortSummary(result.summary) : (result.summary ?? null)
    if (result.error) page.issues.push(lighthouseFailed(page.url, result.error))
    if (result.summary) page.issues.push(...lighthouseIssues(page.url, result.summary))
  }
}

// Reads the robots.txt files of the audited sites and checks them and the sitemaps against them, with a spinner
// because a slow host can take a while. Each robots.txt is read once for all checks.
async function checkRobotsAndSitemaps(pages, inputs, options, { progress, pace }) {
  const load = cachedRobotsLoader((origin) => loadRobots(origin, { beforeHop: pace }))
  const loaded = pages.some((page) => page.status === 200 && page.finalUrl)
  const spinner = loaded || inputs.sitemapFiles.length ? progress.start('Reading robots.txt...') : progress.silent
  try {
    return [
      ...(await checkRobotsTxt(pages, { load })),
      ...checkSitemapFiles(inputs.sitemapFiles),
      ...(await checkSitemapHosts(inputs.sitemapFiles, { load })),
      ...(options.sitemaps.length ? [] : await checkSitemapDeclared(pages, { load }))
    ]
  } finally {
    spinner.stop()
  }
}

// Writes the --out and --html files and says where each one went, on stderr so the JSON on stdout stays clean.
// Returns false after printing why when one failed.
async function writeFiles(options, report, { logo }) {
  const files = []
  if (options.out) files.push(['JSON', options.out, `${JSON.stringify(report, null, 2)}\n`])
  if (options.html) {
    const { title, client } = options.branding
    files.push(['HTML', options.html, renderHtml(report, { title, client, logo })])
  }
  let ok = true
  for (const [kind, path, content] of files) {
    const failure = await writeReportFile(path, content)
    console.error(failure ?? `${kind} report written to ${path}`)
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

// Report paths that would fail only after the whole audit are refused up front.
async function reportPathsUsable(options) {
  const problems = await reportPathProblems([
    ['--out', options.out],
    ['--html', options.html]
  ])
  if (problems.length) console.error(problems.join('\n'))
  return problems.length === 0
}

// Requests every internal link target the audit has not seen yet, then checks the links. Returns the issues and
// the outcome of the link checks.
async function checkInternalLinks(pages, inputs, options, { progress, pace }) {
  const spinner = progress.start('Checking links...')
  const targets = await checkLinkTargets(pages, {
    concurrency: options.concurrency,
    pace,
    onProgress: (done, total) => spinner.update(`Checking links ${done}/${total}...`)
  })
  spinner.stop()
  if (targets.unchecked) {
    // Orphan pages are only looked for with a --sitemap, so only then does the cap stop it.
    const note = options.sitemaps.length ? ', so orphan pages were not looked for' : ''
    console.error(
      `Checked ${targets.checked} link targets, ${targets.unchecked} linked from fewer pages were not checked${note}.`
    )
  }
  const orphans = orphansSkipped(options, inputs, targets) === null
  const issues = checkLinks(pages, targets.outcomes, { orphans, listed: inputs.listed })
  return { issues, targets }
}

// The cross-page issues: duplicates, robots.txt, sitemaps and, with --check-links, internal links. `links` is the
// outcome of the link checks, undefined without --check-links.
async function checkAllPages(pages, inputs, options, session) {
  const site = [
    ...checkSite(pages),
    ...(await checkRobotsAndSitemaps(pages, inputs, options, session)),
    ...checkSitemapEntries(pages, inputs.listed)
  ]
  if (!options.checkLinks) return { site }
  const { issues, targets } = await checkInternalLinks(pages, inputs, options, session)
  return { site: [...site, ...issues], links: targets }
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

  if (!(await reportPathsUsable(options))) return 2

  const logo = await loadLogo(options.branding.logo)
  if (logo === undefined) return 2

  const json = options.json ?? !process.stdout.isTTY
  const progress = createProgress({ enabled: !json, stream: process.stderr })
  // One spacing for every request of the run, so --delay holds across sitemaps, pages, redirect hops, robots.txt
  // and link checks alike.
  const session = { progress, pace: hostThrottle(options.delay ?? DEFAULT_DELAY_MS) }

  const { inputs, exitCode } = await loadInputs(options, stdin, session)
  if (exitCode) return exitCode
  if (!announceInputs(inputs, options)) return 2

  const pages = await auditUrls(inputs.urls, options, session)
  await addLighthouse(pages, progress, lighthouse, {
    all: options.lighthouse,
    chosen: inputs.marked,
    runs: options.lighthouseRuns
  })
  const { site, links } = await checkAllPages(pages, inputs, options, session)
  // A page Lighthouse was tried on has a lighthouse block, null when the run failed.
  const lighthouseRan = pages.some((page) => page.lighthouse !== undefined)
  const coverage = buildCoverage(options, inputs, { links, lighthouseRan })
  const report = buildReport({ pages, site, skipped: inputs.skipped, coverage })
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report, process.stdout.columns))
  if (!(await writeFiles(options, report, { logo }))) return 2

  const { errors, warnings } = report.summary
  return errors > 0 || (options.failOn === 'warning' && warnings > 0) ? 1 : 0
}
