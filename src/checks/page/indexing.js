import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'
import { metaContent } from './signals.js'

const issue = (fields) => ({ category: 'seo', ...fields, context: truncate(fields.context) })

// Every robots and googlebot meta tag applies to Google and their directives add up, so all of them are read, uncut.
function robotsTags($) {
  return $('meta[name="robots" i], meta[name="googlebot" i]')
    .toArray()
    .map((el) => {
      const content = $(el).attr('content') ?? ''
      return {
        content,
        rules: content
          .toLowerCase()
          .split(',')
          .map((part) => part.trim()),
        html: `<meta name="${$(el).attr('name')}" content="${content}">`
      }
    })
}

function robotsIssue(tags, directive, fields) {
  const tag = tags.find(({ rules }) => rules.includes(directive) || rules.includes('none'))
  return tag ? [issue({ source: SOURCES.robotsMeta, ...fields, context: tag.html })] : []
}

const checkRobots = ($) => {
  const tags = robotsTags($)
  return [
    ...robotsIssue(tags, 'noindex', {
      type: 'noindex',
      severity: 'warning',
      message: 'The page tells search engines not to index it (noindex), so it will not appear in search results'
    }),
    ...robotsIssue(tags, 'nofollow', {
      type: 'nofollow',
      severity: 'info',
      message: 'The page tells search engines not to follow its links (nofollow)'
    })
  ]
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
