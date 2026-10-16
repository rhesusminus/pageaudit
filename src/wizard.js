import { accessSync, constants, statSync } from 'node:fs'
import { cancel, intro, isCancel, multiselect, outro, select, text } from '@clack/prompts'
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

// The file is checked when it is entered, so a typo is asked again instead of ending the run with exit 2.
export function checkUrlFile(value = '') {
  const path = value.trim()
  if (!path) return 'Enter the path of the file'
  try {
    if (!statSync(path).isFile()) return `${path} is not a file`
    accessSync(path, constants.R_OK)
  } catch (err) {
    return `Could not read ${path}: ${err.code ?? err.message}`
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

// The command line arguments that run the audit the answers describe.
export function answersToArgs({ source, input, limit, checks = [] }) {
  const args = SOURCES[source].args(input)
  const max = limit?.trim()
  if (max && max !== NO_LIMIT) args.push('--limit', max)
  // In a fixed order, so the command does not depend on the order the checks were picked in.
  for (const [name, { flag }] of Object.entries(CHECKS)) if (checks.includes(name)) args.push(flag)
  return args
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

// Asks for the audit setup. Returns the arguments for run(), or null when the user cancelled. The streams are
// clack's input and output, given in tests.
export async function askArgs(streams = {}) {
  intro('pageaudit', streams)
  const answers = await askAll({
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
          }),
    checks: () =>
      multiselect({
        message: 'Which extra checks should run?',
        options: Object.entries(CHECKS).map(([value, { label, hint }]) => ({ value, label, hint })),
        required: false,
        ...streams
      })
  })
  if (!answers) {
    cancel('Cancelled.', streams)
    return null
  }
  const args = answersToArgs(answers)
  outro(`Would run: pageaudit ${args.join(' ')}`, streams)
  return args
}
