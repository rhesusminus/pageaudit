// checkHeadings(): missing and multiple h1s, skipped heading levels and empty headings.
import { SOURCES } from '../../sources.js'
import { collapseWhitespace } from '../../text.js'
import { evidence, selectorFor } from '../evidence.js'
import { perElement } from '../per-element.js'
import { MAX_CONTEXT, snippet, truncate } from '../snippet.js'
import { namedByScript } from './accname.js'
import { visibleTextStart } from './content.js'

// Whether an element holds text or an image with alt text, at any depth. Noscript content is plain text to the parser
// and no text on a page that runs scripts. Kept per element: a heading inside another one asks again about everything
// inside it, and a search of each heading would repeat that for every level.
const holdsText = perElement(($, el) =>
  el.children.some((child) => {
    if (child.type === 'text') return child.data.trim() !== ''
    if (child.type !== 'tag' || child.name === 'noscript') return false
    return child.name === 'img' ? (child.attribs.alt ?? '').trim() !== '' : holdsText($, child)
  })
)

// As much of a heading's text as an issue context can show. A context is cut to MAX_CONTEXT characters, and more
// characters than that are enough to cut it at the same place.
const headingText = (el) => collapseWhitespace(visibleTextStart(el, MAX_CONTEXT + 1))

function hasAccessibleText($, el) {
  const heading = $(el)
  if (holdsText($, el) || heading.attr('aria-label') || heading.attr('aria-labelledby')) return true
  return namedByScript($, el)
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
        context: truncate(h1s.map((el) => `<h1>${headingText(el)}</h1>`).join(' ')),
        selector: h1s.map((el) => selectorFor($, el)).join(', ')
      }
    ]
  }
  return []
}

// The outline starts at level 1, so a first <h2> skips nothing: a missing h1 is reported by checkH1s.
function checkHeadingOrder($, headings) {
  const issues = []
  let previous = 1
  for (const [index, el] of headings.entries()) {
    const level = Number(el.tagName[1])
    if (level > previous + 1) {
      issues.push({
        type: 'skipped-heading-level',
        severity: 'warning',
        category: 'accessibility',
        source: SOURCES.headings,
        message: `Heading level skipped: <h${level}> after ${index ? `<h${previous}>` : 'no heading'}`,
        context: truncate(`<h${level}>${headingText(el)}</h${level}>`),
        ...evidence($, el)
      })
    }
    if (!hasAccessibleText($, el)) {
      issues.push({
        type: 'empty-heading',
        severity: 'warning',
        category: 'accessibility',
        source: SOURCES.headings,
        message: `Empty <h${level}> heading`,
        context: snippet($, el),
        ...evidence($, el)
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
