import { SOURCES } from '../../sources.js'
import { limit } from '../../text.js'
import { seoIssue } from '../snippet.js'

// Rules that take a value after a colon, so that colon does not start a user agent prefix.
const VALUE_RULES = new Set(['unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview'])
// An agent name starts with a letter, so the 16 in a date like "16:00 GMT" is not one.
const PREFIXED = /^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/

// The X-Robots-Tag rules that apply to Google: those without a user agent and those prefixed with googlebot.
// A prefix applies to the rules after it. Repeated headers arrive joined with ", " and fetch cannot give them back
// separately, so a generic header after one for another crawler ("bingbot: nofollow" then "noindex") is read as
// bingbot's and missed.
export function googleRules(header) {
  const rules = []
  let agent = null
  for (const part of header.split(',')) {
    let rule = part.trim().toLowerCase()
    const prefixed = PREFIXED.exec(rule)
    if (prefixed && !VALUE_RULES.has(prefixed[1])) {
      agent = prefixed[1]
      rule = prefixed[2].trim()
    }
    if (agent === null || agent === 'googlebot') rules.push(rule)
  }
  return rules
}

// Error pages are often noindex on purpose and are already errors, so only a 200 is checked.
export function checkRobotsHeader({ robotsHeader, status }) {
  if (!robotsHeader || status !== 200) return []
  const rules = googleRules(robotsHeader)
  const context = `X-Robots-Tag: ${robotsHeader}`
  const issues = []
  if (rules.includes('noindex') || rules.includes('none')) {
    issues.push(
      seoIssue({
        type: 'noindex',
        severity: 'warning',
        source: SOURCES.robotsMeta,
        message: 'The page tells search engines not to index it (noindex), so it will not appear in search results',
        context
      })
    )
  }
  if (rules.includes('nofollow') || rules.includes('none')) {
    issues.push(
      seoIssue({
        type: 'nofollow',
        severity: 'info',
        source: SOURCES.robotsMeta,
        message: 'The page tells search engines not to follow its links (nofollow)',
        context
      })
    )
  }
  return issues
}

const CONTEXT_MAX = 120
const SEPARATOR = ' and '

// A page can say noindex or nofollow in its meta tag and in its header. That is one finding with both sources as
// context, each source getting an equal share of the room so that a long header cannot push the meta tag out.
// The merged finding keeps the element evidence of the meta tag, which the header has none of.
export function mergeRobotsIssues(issues) {
  const contexts = new Map()
  const evidence = new Map()
  for (const { type, context, selector, html, parentHtml } of issues) {
    if (!['noindex', 'nofollow'].includes(type)) continue
    contexts.set(type, [...new Set([...(contexts.get(type) ?? []), context])])
    if (selector && !evidence.has(type)) evidence.set(type, { selector, html, parentHtml })
  }
  const done = new Set()
  return issues.flatMap((issue) => {
    if (!contexts.has(issue.type)) return [issue]
    if (done.has(issue.type)) return []
    done.add(issue.type)
    const all = contexts.get(issue.type)
    const room = Math.floor((CONTEXT_MAX - SEPARATOR.length * (all.length - 1)) / all.length)
    return [
      { ...issue, ...evidence.get(issue.type), context: all.map((context) => limit(context, room)).join(SEPARATOR) }
    ]
  })
}
