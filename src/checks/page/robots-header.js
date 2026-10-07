import { SOURCES } from '../../sources.js'
import { seoIssue, truncate } from '../snippet.js'

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

// A page can say noindex or nofollow in its meta tag and in its header. That is one finding with both sources as context.
export function mergeRobotsIssues(issues) {
  const merged = []
  for (const issue of issues) {
    const first = ['noindex', 'nofollow'].includes(issue.type) && merged.find((m) => m.type === issue.type)
    if (!first) merged.push({ ...issue })
    else if (!first.context.includes(issue.context)) first.context = truncate(`${first.context} and ${issue.context}`)
  }
  return merged
}
