import { parseArgs } from 'node:util'
import { DEFAULT_TITLE } from './html/render.js'
import { DEFAULT_CONCURRENCY, DEFAULT_DELAY_MS } from './runner.js'

// The command line options, for parsing them and for showing the command the wizard makes.
export const OPTIONS = {
  'urls-file': { type: 'string', multiple: true },
  sitemap: { type: 'string', multiple: true },
  limit: { type: 'string' },
  concurrency: { type: 'string' },
  delay: { type: 'string' },
  lighthouse: { type: 'boolean' },
  'lighthouse-page': { type: 'string', multiple: true },
  'lighthouse-runs': { type: 'string' },
  'check-links': { type: 'boolean' },
  out: { type: 'string' },
  digest: { type: 'string' },
  content: { type: 'string' },
  html: { type: 'string' },
  title: { type: 'string' },
  client: { type: 'string' },
  logo: { type: 'string' },
  'fail-on': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
}

const MAX_LIGHTHOUSE_RUNS = 9

export const USAGE = `Usage: pageaudit [url...] [--urls-file <path>] [--sitemap <url>] [options]
Run "pageaudit --help" for all options.`

export const HELP = `Usage: pageaudit [url...] [--urls-file <path>] [--sitemap <url>] [options]

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
  --lighthouse-runs <n>
                       run Lighthouse n times per page (1 to ${MAX_LIGHTHOUSE_RUNS}, default 1) and keep the median run, since single runs vary
  --check-links        also check where the internal links of the audited pages lead: broken links, redirects,
                       and with a whole --sitemap audited, pages no other page links to
  --fail-on <level>    exit 1 on any "error" (default) or on any "warning" or error
  --out <path>         also write the JSON report to a file, for example to hand to Claude
  --digest <path>      also write a short form of the JSON report, for Claude to read first on a large audit
  --content <dir>      also write the main content of each page as Markdown, one file per page, for Claude to
                       judge what the pages say
  --html <path>        also write a report for customers as one self-contained HTML file
  --title <text>       report title in the HTML report (default "${DEFAULT_TITLE}")
  --client <name>      client name shown in the HTML report
  --logo <file>        logo for the HTML report (png, jpg, gif, webp or svg, at most 512 KB)
  --json               print the report as JSON (default when stdout is not a TTY)
  -h, --help           show this help

--urls-file, --sitemap and --lighthouse-page can be given more than once.
Run with no arguments in a terminal to be asked what to audit, shown the command and asked whether to run it.`

function integer(name, value, min, max = Infinity) {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    const range = max === Infinity ? `at least ${min}` : `from ${min} to ${max}`
    throw new Error(`--${name} must be a whole number ${range}, got "${value}"`)
  }
  return Number(value)
}

// An empty value, such as --out "", is almost always a shell variable that was not set.
function requireValues(values, names) {
  for (const name of names) {
    if (values[name] === '') throw new Error(`--${name} needs a value`)
  }
}

export function parseOptions(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS })
  requireValues(values, ['out', 'digest', 'content', 'html', 'title', 'client', 'logo'])
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
    lighthouseRuns: integer('lighthouse-runs', values['lighthouse-runs'], 1, MAX_LIGHTHOUSE_RUNS),
    checkLinks: values['check-links'],
    out: values.out,
    digest: values.digest,
    content: values.content,
    html: values.html,
    branding: { title: values.title, client: values.client, logo: values.logo },
    json: values.json
  }
}
