import { SOURCES } from '../../sources.js'
import { seoIssue } from '../snippet.js'
import { checkRobotsHeader } from './robots-header.js'

// A page that could not be fetched at all: network error, timeout, too many redirects.
export function checkFetchError(err) {
  return [
    seoIssue({
      type: 'fetch-failed',
      severity: 'error',
      source: SOURCES.httpStatus,
      message: `Could not fetch the page: ${err.reason ?? err.message}`,
      context: ''
    })
  ]
}

// A page that returned HTML the checks could not process. A stack overflow comes from elements nested too deeply to
// walk, which a reader can act on. Any other failure is the audit's own, documented with the rule itself.
// The page's problems are unknown, so it must not pass as a clean page.
export function checkHtmlError(err) {
  const tooDeep = err instanceof RangeError && /call stack/i.test(err.message)
  return [
    {
      type: 'check-failed',
      severity: 'error',
      category: 'best-practice',
      source: tooDeep ? SOURCES.domSize : SOURCES.pageaudit,
      message: `Could not check the page: ${tooDeep ? 'its elements are nested too deeply' : err.message}`,
      context: ''
    }
  ]
}

function checkRedirects({ url, redirects }) {
  const chain = [url, ...redirects.map((r) => r.location)].join(' -> ')
  if (redirects.length > 1) {
    return [
      seoIssue({
        type: 'redirect-chain',
        severity: 'warning',
        source: SOURCES.redirects,
        message: `Redirect chain of ${redirects.length} hops (${redirects.map((r) => r.status).join(', ')}), link to the final URL directly`,
        context: chain
      })
    ]
  }
  if (redirects.length === 1) {
    return [
      seoIssue({
        type: 'redirect',
        severity: 'info',
        source: SOURCES.redirects,
        message: `Redirects (${redirects[0].status}), the final URL was audited`,
        context: chain
      })
    ]
  }
  return []
}

function checkStatus({ url, finalUrl, status, contentType, html }) {
  // The page URL is already known, so only point out where a redirect ended up.
  const landedOn = finalUrl === url ? '' : finalUrl
  if (status !== 200) {
    return [
      seoIssue({
        type: 'http-status',
        severity: 'error',
        source: SOURCES.httpStatus,
        message: `HTTP ${status} response, page checks skipped`,
        context: landedOn
      })
    ]
  }
  if (html === null) {
    return [
      seoIssue({
        type: 'not-html',
        severity: 'info',
        source: SOURCES.fileTypes,
        message: `Not an HTML page (content-type: ${contentType || 'none'}), page checks skipped`,
        context: landedOn
      })
    ]
  }
  return []
}

// Checks on the HTTP response itself, from a fetchPage() result.
export function checkResponse(response) {
  return [...checkRedirects(response), ...checkStatus(response), ...checkRobotsHeader(response)]
}
