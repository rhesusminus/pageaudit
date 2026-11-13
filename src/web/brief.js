// The results of one check as Markdown, to paste into Claude or to point Claude Code at. It says what the results page
// says, with more of the places each finding occurs and the address of the full JSON. Text from the checked page is
// set in quotes or code spans, so a reader can tell it from what pageaudit wrote.
import { adviceFor } from '../advice.js'
import { code as codeSpan } from '../markdown.js'
import { collapseWhitespace } from '../text.js'
import { findingsOf, verdict } from './findings.js'
import { checkedAt, count, SEVERITY_LABEL, shortAddress } from './format.js'
import { factRows, platformName } from './result-facts.js'
import { failure } from './status.js'

// How many places a finding lists before it says how many more there are. More than the page shows: a model reads
// them all, and a person reading the page needs only a few examples.
const SHOWN_HITS = 10

const oneLine = (text) => collapseWhitespace(String(text))

// A code span on one line that holds any text.
const code = (text) => codeSpan(oneLine(text))

const quoted = (text) => `"${oneLine(text)}"`

function about(audit, origin) {
  const page = audit.result
  const lines = [`- Address: ${page?.finalUrl ?? audit.url}`]
  if (page) {
    const redirects = page.redirects.length
      ? `, after ${count(page.redirects.length, 'redirect')} from ${audit.url}`
      : ''
    lines.push(`- Answer: HTTP ${page.status}${redirects}`)
    if (page.facts?.platform) lines.push(`- Built with: ${platformName(page.facts.platform)}`)
  }
  lines.push(`- Checked: ${checkedAt(audit.created_at).text}`)
  lines.push(`- Full results as JSON: ${origin}/audits/${audit.id}`)
  return lines.join('\n')
}

function where(group) {
  const hits = group.hits.filter((hit) => hit.context || hit.expected || hit.selector)
  if (!hits.length) return []
  const shown = hits.slice(0, SHOWN_HITS)
  const lines = shown.map((hit) => {
    const parts = []
    if (hit.context) parts.push(code(hit.context))
    if (hit.selector) parts.push(`at ${code(hit.selector)}`)
    if (hit.expected) parts.push(`found ${code(hit.actual)}, expected ${hit.expected}`)
    return `- ${parts.join(', ')}`
  })
  const more = group.hits.length - shown.length
  if (more > 0) lines.push(`- And ${count(more, 'more place')}.`)
  return ['', `Where (${count(group.hits.length, 'place')}):`, ...lines]
}

function finding(group, number) {
  const advice = adviceFor(group.type)
  // Without advice the check's own message is all there is. It can hold text from the page, so it is a code span.
  const title = advice?.title ?? code(group.message)
  const lines = [`### ${number}. ${SEVERITY_LABEL[group.severity]}: ${title} (${code(group.type)})`]
  if (advice) lines.push('', `Why it matters: ${advice.why}`, '', `How to fix it: ${advice.fix}`)
  return [...lines, ...where(group)].join('\n')
}

function section(heading, groups, first) {
  if (!groups.length) return []
  return [`## ${heading}`, ...groups.map((group, i) => finding(group, first + i))]
}

function factList(f) {
  const rows = factRows(f).map(([term, { value, fromPage, note }]) => {
    const text = fromPage ? quoted(value) : value
    return `- ${term}: ${text}${note ? ` (${note})` : ''}`
  })
  return ['## What is on the page', rows.join('\n')]
}

function failedBrief(audit, origin) {
  const { title, why, fix, reason } = failure(audit.error)
  return [
    `# pageaudit could not check ${shortAddress(audit.url)}`,
    about(audit, origin),
    `${title}. ${why}`,
    fix,
    ...(reason ? [`Reason given: ${code(reason)}`] : [])
  ]
}

// Blocks joined into the text. Counts are joined with no-break spaces for the web page's line breaks, which plain text
// does not need, so they become spaces.
const plain = (blocks) => `${blocks.join('\n\n').replaceAll('\u00a0', ' ')}\n`

const INTRO =
  'pageaudit checked this one page for problems with search, accessibility, sharing and hygiene. Text in quotes ' +
  'or code spans comes from the page itself, not from pageaudit.'

export function resultBrief(audit, origin) {
  if (audit.status === 'failed') return plain(failedBrief(audit, origin))
  const page = audit.result
  const { groups, toFix, notes } = findingsOf(page)
  const blocks = [
    `# pageaudit results for ${shortAddress(page.finalUrl ?? audit.url)}`,
    INTRO,
    about(audit, origin),
    verdict(groups),
    ...section('What to fix', toFix, 1),
    ...section('Notes', notes, toFix.length + 1),
    ...(page.facts ? factList(page.facts) : [])
  ]
  return plain(blocks)
}
