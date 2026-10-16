import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { cancel, confirm, intro, isCancel, multiselect, outro, select, text } from '@clack/prompts'
import stringWidth from 'string-width'
import { OPTIONS } from './cli.js'
import { logoType, MAX_LOGO_BYTES } from './html/logo.js'
import { DEFAULT_TITLE } from './html/render.js'
import { normalize } from './input/resolve.js'

// The setup is asked only when nothing was given and a person is at the terminal, so scripts, pipes and CI keep
// getting the usage error.
export const wantsWizard = (argv, stdin, stdout) => argv.length === 0 && Boolean(stdin.isTTY) && Boolean(stdout.isTTY)

const words = (value = '') => value.trim().split(/\s+/).filter(Boolean)

// Returns why the URL cannot be audited, or undefined when it can.
function checkUrl(url) {
  try {
    normalize(url)
  } catch (err) {
    return `${url}: ${err.message}`
  }
}

// Returns why the page URLs cannot be audited, or undefined when every one can.
export function checkPageUrls(value) {
  const urls = words(value)
  if (!urls.length) return 'Enter at least one URL'
  for (const url of urls) {
    const problem = checkUrl(url)
    if (problem) return problem
  }
}

export function checkSitemapUrl(value) {
  const urls = words(value)
  if (urls.length !== 1) return 'Enter one sitemap URL'
  return checkUrl(urls[0])
}

// Returns why the path is not a file that can be read, or undefined when it is.
function checkReadableFile(path) {
  try {
    if (!statSync(path).isFile()) return `${path} is not a file`
    accessSync(path, constants.R_OK)
  } catch (err) {
    return `Could not read ${path}: ${err.code ?? err.message}`
  }
}

// Files are checked when they are entered, so a typo is asked again instead of ending the run with exit 2.
export function checkUrlFile(value = '') {
  const path = value.trim()
  if (!path) return 'Enter the path of the file'
  return checkReadableFile(path)
}

// The answer for an optional value that was left out. An empty answer becomes it, so the answer shown is never blank.
const NONE = 'none'

export function checkLogoFile(value = '') {
  const path = value.trim()
  if (!path || path === NONE) return
  if (!logoType(path)) return 'The logo must be a png, jpg, gif, webp or svg file'
  const problem = checkReadableFile(path)
  if (problem) return problem
  if (statSync(path).size > MAX_LOGO_BYTES) return `${path} is larger than ${MAX_LOGO_BYTES / 1024} KB`
}

// A report path must be a file in a folder that exists. A report that cannot be written only fails at the end of
// the audit, so this is checked when the path is entered. An existing file is fine, the wizard asks before
// replacing it.
export function checkReportPath(value = '') {
  const path = value.trim()
  if (!path) return 'Enter the path of the file'
  try {
    if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) return `${path} is a folder, enter a file path`
    if (!statSync(dirname(path), { throwIfNoEntry: false })?.isDirectory()) {
      return `The folder ${dirname(path)} does not exist`
    }
  } catch (err) {
    // Such as a folder that cannot be opened (EACCES) or a name that is too long.
    return `Could not use ${path}: ${err.code ?? err.message}`
  }
}

// The file a report path ends up in once links are followed, so two spellings of one file compare equal. The file
// itself may not exist yet, its folder does.
function destination(path) {
  const full = resolve(path)
  try {
    return realpathSync(full)
  } catch {
    try {
      return join(realpathSync(dirname(full)), basename(full))
    } catch {
      return full
    }
  }
}

// The limit answer that audits every page. An empty answer becomes it, so the answer shown is never blank.
const NO_LIMIT = 'all'

export function checkLimit(value = '') {
  const limit = value.trim()
  if (limit && limit !== NO_LIMIT && !(/^\d+$/.test(limit) && Number(limit) >= 1)) {
    return `Enter a whole number of at least 1, or leave it empty to audit ${NO_LIMIT}`
  }
}

// Where the URLs come from: the choice shown, the question for the input and its arguments.
const SOURCES = {
  pages: {
    label: 'A page or a few pages',
    message: 'Which pages should be audited?',
    placeholder: 'https://example.com/ (separate several with spaces)',
    validate: checkPageUrls,
    args: (input) => words(input)
  },
  sitemap: {
    label: 'A sitemap',
    message: 'Which sitemap lists the pages?',
    placeholder: 'https://example.com/sitemap.xml',
    validate: checkSitemapUrl,
    args: (input) => ['--sitemap', input.trim()]
  },
  file: {
    label: 'A file with one URL per line',
    message: 'Which file lists the URLs?',
    placeholder: 'urls.txt',
    validate: checkUrlFile,
    args: (input) => ['--urls-file', input.trim()]
  }
}

// The checks that can be added to the static ones, with the hint shown while choosing and their option.
const CHECKS = {
  lighthouse: {
    label: 'Lighthouse',
    hint: 'speed and quality scores, needs Chrome, slow',
    flag: '--lighthouse'
  },
  links: { label: 'Internal links', hint: 'where the internal links lead, more requests', flag: '--check-links' }
}

// The report files that can be written next to the terminal report.
const REPORTS = {
  html: { label: 'HTML report', hint: 'one file to show a customer' },
  json: { label: 'JSON report', hint: 'for scripts or Claude' }
}

// The trimmed answer to the client or logo question, or undefined when it was left out.
const optional = (value) => {
  const answer = value?.trim()
  return answer && answer !== NONE ? answer : undefined
}

// The command line arguments that run the audit the answers describe.
export function answersToArgs({ source, input, limit, checks = [], html, title, client, logo, json }) {
  const args = SOURCES[source].args(input)
  const max = limit?.trim()
  if (max && max !== NO_LIMIT) args.push('--limit', max)
  // In a fixed order, so the command does not depend on the order the checks were picked in.
  for (const [name, { flag }] of Object.entries(CHECKS)) if (checks.includes(name)) args.push(flag)
  if (html?.trim()) {
    args.push('--html', html.trim())
    const heading = title?.trim()
    if (heading && heading !== DEFAULT_TITLE) args.push('--title', heading)
    if (optional(client)) args.push('--client', optional(client))
    if (optional(logo)) args.push('--logo', optional(logo))
  }
  if (json?.trim()) args.push('--out', json.trim())
  return args
}

// Quotes an argument for a POSIX shell, unless it only holds characters every shell takes as they are. A leading =
// is quoted too, because zsh turns =name into the path of the command name.
export const shellQuote = (arg) =>
  /^[\w@%+:,./-][\w@%+=:,./-]*$/.test(arg) ? arg : `'${arg.replaceAll("'", String.raw`'\''`)}'`

// The command as lines that fit in `width` columns, each but the last continued with a backslash, so it can be
// pasted into a shell as it is. An option stays on the line of its value. A part longer than a line gets one of
// its own.
export function commandLines(args, width) {
  const parts = []
  let i = 0
  while (i < args.length) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : undefined
    const takesValue = Object.hasOwn(OPTIONS, name ?? '') && OPTIONS[name].type === 'string' && i + 1 < args.length
    const count = takesValue ? 2 : 1
    parts.push(
      args
        .slice(i, i + count)
        .map(shellQuote)
        .join(' ')
    )
    i += count
  }
  const lines = []
  let line = 'pageaudit'
  for (const part of parts) {
    // Columns as the terminal shows them, where a wide character takes two. Two are kept for the " \" that
    // continues the line.
    if (stringWidth(`${line} ${part}`) + 2 > width) {
      lines.push(`${line} \\`)
      line = `  ${part}`
    } else {
      line = `${line} ${part}`
    }
  }
  return [...lines, line]
}

// Asks the questions in order. Each gets the answers so far and returns a prompt, or undefined to be skipped.
// Returns the answers, or null as soon as one is cancelled.
async function askAll(questions) {
  const answers = {}
  for (const [name, ask] of Object.entries(questions)) {
    const answer = await ask(answers)
    if (isCancel(answer)) return null
    answers[name] = answer
  }
  return answers
}

// Asks for the path of a report file, and when the file exists whether to replace it. Answering no asks for the
// path again. Returns the trimmed path or clack's cancel symbol.
async function askReportPath({ message, defaultPath, validate }, streams) {
  for (;;) {
    const answer = await text({
      message,
      placeholder: defaultPath,
      defaultValue: defaultPath,
      // clack checks the empty input before it becomes the default, so the default is what gets checked.
      validate: (value) => validate(value?.trim() ? value : defaultPath),
      ...streams
    })
    if (isCancel(answer)) return answer
    // clack only puts in the default for an empty answer, not for one of spaces.
    const path = answer.trim() || defaultPath
    if (!existsSync(path)) return path
    const replace = await confirm({
      message: `${path} already exists. Replace it?`,
      initialValue: false,
      ...streams
    })
    if (isCancel(replace)) return replace
    if (replace) return path
  }
}

// What to audit: the source, its input and, for a sitemap or a file, the limit.
const sourceQuestions = (streams) => ({
  source: () =>
    select({
      message: 'What should be audited?',
      options: Object.entries(SOURCES).map(([value, { label }]) => ({ value, label })),
      ...streams
    }),
  input: ({ source }) => {
    const { message, placeholder, validate } = SOURCES[source]
    return text({ message, placeholder, validate, ...streams })
  },
  limit: ({ source }) =>
    source === 'pages'
      ? undefined
      : text({
          message: 'How many pages at most?',
          placeholder: NO_LIMIT,
          defaultValue: NO_LIMIT,
          validate: checkLimit,
          ...streams
        })
})

const checkQuestions = (streams) => ({
  checks: () =>
    multiselect({
      message: 'Which extra checks should run?',
      options: Object.entries(CHECKS).map(([value, { label, hint }]) => ({ value, label, hint })),
      required: false,
      ...streams
    })
})

// The questions about the HTML report, asked only when it was picked.
const htmlQuestions = (streams) => ({
  html: ({ reports }) =>
    reports.includes('html')
      ? askReportPath(
          { message: 'Where should the HTML report go?', defaultPath: 'report.html', validate: checkReportPath },
          streams
        )
      : undefined,
  title: ({ html }) =>
    html
      ? text({
          message: 'What is the title of the report?',
          placeholder: DEFAULT_TITLE,
          defaultValue: DEFAULT_TITLE,
          ...streams
        })
      : undefined,
  client: ({ html }) =>
    html ? text({ message: 'Who is the client?', placeholder: NONE, defaultValue: NONE, ...streams }) : undefined,
  logo: ({ html }) =>
    html
      ? text({
          message: `Which logo should it show? (png, jpg, gif, webp or svg, at most ${MAX_LOGO_BYTES / 1024} KB)`,
          placeholder: NONE,
          defaultValue: NONE,
          validate: checkLogoFile,
          ...streams
        })
      : undefined
})

// Both reports in one file would leave only the one written last.
const checkJsonPath = (html) => (value) =>
  checkReportPath(value) ??
  (html && destination(value.trim()) === destination(html) ? 'The HTML report goes there' : undefined)

const reportQuestions = (streams) => ({
  reports: () =>
    multiselect({
      message: 'Which report files should be written?',
      options: Object.entries(REPORTS).map(([value, { label, hint }]) => ({ value, label, hint })),
      required: false,
      ...streams
    }),
  ...htmlQuestions(streams),
  json: ({ reports, html }) =>
    reports.includes('json')
      ? askReportPath(
          { message: 'Where should the JSON report go?', defaultPath: 'report.json', validate: checkJsonPath(html) },
          streams
        )
      : undefined
})

// Asks for the audit setup. Returns the arguments for run(), or null when the user cancelled. The streams are
// clack's input and output, given in tests.
export async function askArgs(streams = {}) {
  intro('pageaudit', streams)
  const answers = await askAll({
    ...sourceQuestions(streams),
    ...checkQuestions(streams),
    ...reportQuestions(streams)
  })
  if (!answers) {
    cancel('Cancelled.', streams)
    return null
  }
  const args = answersToArgs(answers)
  // The lines are indented to the text of clack's last line, "└  Would run:".
  const indent = '   '
  const width = ((streams.output ?? process.stdout).columns ?? 80) - indent.length
  const command = commandLines(args, width).map((line) => `${indent}${line}`)
  outro(['Would run:', ...command].join('\n'), streams)
  return args
}
