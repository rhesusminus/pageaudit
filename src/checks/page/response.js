import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'

const issue = (fields) => ({ category: 'seo', ...fields, context: truncate(fields.context) })

// A page that could not be fetched at all: network error, timeout, too many redirects.
export function checkFetchError(err) {
  return [
    issue({
      type: 'fetch-failed',
      severity: 'error',
      source: SOURCES.httpStatus,
      message: `Could not fetch the page: ${err.reason ?? err.message}`,
      context: ''
    })
  ]
}

// Checks on the HTTP response itself, from a fetchPage() result.
export function checkResponse({ url, finalUrl, status, redirects, contentType, html }) {
  const issues = []
  // The page URL is already known, so only point out where a redirect ended up.
  const landedOn = finalUrl === url ? '' : finalUrl
  const chain = [url, ...redirects.map((r) => r.location)].join(' -> ')
  if (redirects.length > 1) {
    issues.push(
      issue({
        type: 'redirect-chain',
        severity: 'warning',
        source: SOURCES.redirects,
        message: `Redirect chain of ${redirects.length} hops (${redirects.map((r) => r.status).join(', ')}), link to the final URL directly`,
        context: chain
      })
    )
  } else if (redirects.length === 1) {
    issues.push(
      issue({
        type: 'redirect',
        severity: 'info',
        source: SOURCES.redirects,
        message: `Redirects (${redirects[0].status}), the final URL was audited`,
        context: chain
      })
    )
  }

  if (status !== 200) {
    issues.push(
      issue({
        type: 'http-status',
        severity: 'error',
        source: SOURCES.httpStatus,
        message: `HTTP ${status} response, page checks skipped`,
        context: landedOn
      })
    )
  } else if (html === null) {
    issues.push(
      issue({
        type: 'not-html',
        severity: 'info',
        source: SOURCES.fileTypes,
        message: `Not an HTML page (content-type: ${contentType || 'none'}), page checks skipped`,
        context: landedOn
      })
    )
  }
  return issues
}
