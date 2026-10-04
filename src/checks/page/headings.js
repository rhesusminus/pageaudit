import { SOURCES } from '../../sources.js'
import { collapseWhitespace } from '../../text.js'
import { snippet, truncate } from '../snippet.js'

function hasAccessibleText($, el) {
  const heading = $(el)
  if (heading.text().trim() || heading.attr('aria-label') || heading.attr('aria-labelledby')) return true
  return heading
    .find('img[alt]')
    .toArray()
    .some((img) => $(img).attr('alt').trim() !== '')
}

// Google says a page ranks fine with no h1 or several, so these are best practice only.
function checkH1s($, headings) {
  const h1s = headings.filter((el) => el.tagName === 'h1')
  if (h1s.length === 0) {
    return [
      {
        type: 'missing-h1',
        severity: 'warning',
        category: 'best-practice',
        source: SOURCES.starterGuide,
        message: 'No <h1> on the page (not required by Google, but recommended)',
        context: '<body>'
      }
    ]
  }
  if (h1s.length > 1) {
    return [
      {
        type: 'multiple-h1',
        severity: 'info',
        category: 'best-practice',
        source: SOURCES.starterGuide,
        message: `${h1s.length} <h1> elements found (Google does not mind, one is the common convention)`,
        context: truncate(h1s.map((el) => `<h1>${collapseWhitespace($(el).text())}</h1>`).join(' '))
      }
    ]
  }
  return []
}

function checkHeadingOrder($, headings) {
  const issues = []
  let previous = 0
  for (const el of headings) {
    const level = Number(el.tagName[1])
    if (level > previous + 1) {
      issues.push({
        type: 'skipped-heading-level',
        severity: 'warning',
        category: 'accessibility',
        source: SOURCES.headings,
        message: `Heading level skipped: <h${level}> after ${previous ? `<h${previous}>` : 'no heading'}`,
        context: truncate(`<h${level}>${collapseWhitespace($(el).text())}</h${level}>`)
      })
    }
    if (!hasAccessibleText($, el)) {
      issues.push({
        type: 'empty-heading',
        severity: 'warning',
        category: 'accessibility',
        source: SOURCES.headings,
        message: `Empty <h${level}> heading`,
        context: snippet($, el)
      })
    }
    previous = level
  }
  return issues
}

export function checkHeadings($) {
  const headings = $('h1, h2, h3, h4, h5, h6').toArray()
  return [...checkH1s($, headings), ...checkHeadingOrder($, headings)]
}
