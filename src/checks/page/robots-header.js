import { SOURCES } from '../../sources.js'
import { seoIssue } from '../snippet.js'

// Rules that take a value after a colon, so that colon does not start a user agent prefix.
const VALUE_RULES = new Set(['unavailable_after', 'max-snippet', 'max-image-preview', 'max-video-preview'])
const PREFIXED = /^([a-z0-9_-]+)\s*:\s*(.*)$/

// The X-Robots-Tag rules that apply to Google: those without a user agent and those prefixed with googlebot.
// A prefix applies to the rules after it. Repeated headers arrive joined with ", " so their boundaries are lost.
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

export function checkRobotsHeader({ robotsHeader }) {
  if (!robotsHeader) return []
  const rules = googleRules(robotsHeader)
  const context = `X-Robots-Tag: ${robotsHeader}`
  const issues = []
  if (rules.includes('noindex') || rules.includes('none')) {
    issues.push(
      seoIssue({
        type: 'noindex',
        severity: 'warning',
        source: SOURCES.robotsMeta,
        message:
          'The server tells search engines not to index the page (X-Robots-Tag noindex), so it will not appear in search results',
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
        message: 'The server tells search engines not to follow the links on the page (X-Robots-Tag nofollow)',
        context
      })
    )
  }
  return issues
}
