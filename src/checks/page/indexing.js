import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'
import { metaContent } from './signals.js'

const issue = (fields) => ({ category: 'seo', ...fields, context: truncate(fields.context) })

// robots and googlebot meta tags both apply to Google, the directives are comma separated.
function directives($) {
  const values = ['robots', 'googlebot'].map((name) => metaContent($, `meta[name="${name}" i]`) ?? '')
  return new Set(
    values
      .join(',')
      .toLowerCase()
      .split(',')
      .map((part) => part.trim())
  )
}

const robotsContext = ($) =>
  `<meta name="robots" content="${metaContent($, 'meta[name="robots" i]') ?? metaContent($, 'meta[name="googlebot" i]')}">`

function checkRobots($) {
  const rules = directives($)
  const issues = []
  if (rules.has('noindex') || rules.has('none')) {
    issues.push(
      issue({
        type: 'noindex',
        severity: 'warning',
        source: SOURCES.robotsMeta,
        message: 'The page tells search engines not to index it (noindex), so it will not appear in search results',
        context: robotsContext($)
      })
    )
  }
  if (rules.has('nofollow') || rules.has('none')) {
    issues.push(
      issue({
        type: 'nofollow',
        severity: 'info',
        source: SOURCES.robotsMeta,
        message: 'The page tells search engines not to follow its links (nofollow)',
        context: robotsContext($)
      })
    )
  }
  return issues
}

const checkViewport = ($) =>
  metaContent($, 'meta[name="viewport" i]')
    ? []
    : [
        issue({
          type: 'missing-viewport',
          severity: 'warning',
          source: SOURCES.viewport,
          message: 'No viewport meta tag, so mobile browsers render the page at desktop width and scale it down',
          context: '<meta name="viewport" content="width=device-width, initial-scale=1">'
        })
      ]

const checkLang = ($) =>
  ($('html').attr('lang') ?? '').trim()
    ? []
    : [
        issue({
          type: 'missing-lang',
          severity: 'warning',
          category: 'accessibility',
          source: SOURCES.languageOfPage,
          message:
            'The <html> element has no lang attribute, so screen readers and translators have to guess the language',
          context: '<html>'
        })
      ]

export const checkIndexing = ($) => [...checkRobots($), ...checkViewport($), ...checkLang($)]
