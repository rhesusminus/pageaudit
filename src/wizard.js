import { cancel, intro, isCancel, outro, text } from '@clack/prompts'
import { normalize } from './input/resolve.js'

// The setup is asked only when nothing was given and a person is at the terminal, so scripts, pipes and CI keep
// getting the usage error.
export const wantsWizard = (argv, stdin, stdout) => argv.length === 0 && Boolean(stdin.isTTY) && Boolean(stdout.isTTY)

const words = (value = '') => value.trim().split(/\s+/).filter(Boolean)

// Returns why the page URLs cannot be audited, or undefined when every one can.
export function checkPageUrls(value) {
  const urls = words(value)
  if (!urls.length) return 'Enter at least one URL'
  for (const url of urls) {
    try {
      normalize(url)
    } catch (err) {
      return `${url}: ${err.message}`
    }
  }
}

// The command line arguments that run the audit the answers describe.
export const answersToArgs = ({ pages }) => words(pages)

// Asks for the audit setup. Returns the arguments for run(), or null when the user cancelled. The streams are
// clack's input and output, given in tests.
export async function askArgs(streams = {}) {
  intro('pageaudit', streams)
  const pages = await text({
    message: 'Which pages should be audited?',
    placeholder: 'https://example.com/ (separate several with spaces)',
    validate: checkPageUrls,
    ...streams
  })
  if (isCancel(pages)) {
    cancel('Cancelled.', streams)
    return null
  }
  outro('Starting the audit', streams)
  return answersToArgs({ pages })
}
