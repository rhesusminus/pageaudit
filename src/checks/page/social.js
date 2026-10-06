import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'
import { metaContent } from './signals.js'

const issue = (fields) => ({
  category: 'best-practice',
  severity: 'info',
  source: SOURCES.openGraph,
  ...fields,
  context: truncate(fields.context)
})

const REQUIRED = ['title', 'description', 'image']

// Open Graph and Twitter tags control link previews on social and chat apps. Google Search does not use them, so these are only info.
export function checkSocial($) {
  const issues = []
  const present = (name) => metaContent($, `meta[property="og:${name}" i]`) !== null
  const anyOg = $('meta[property^="og:" i]').length > 0
  if (!anyOg) {
    issues.push(
      issue({
        type: 'missing-open-graph',
        message: 'No Open Graph tags (links to this page get a plain preview on social and chat apps)',
        context: '<head>'
      })
    )
  } else {
    const missing = REQUIRED.filter((name) => !present(name))
    if (missing.length > 0) {
      issues.push(
        issue({
          type: 'incomplete-open-graph',
          message: `Open Graph is missing ${missing.map((name) => `og:${name}`).join(', ')}`,
          context: `<meta property="og:${missing[0]}" content="...">`
        })
      )
    }
  }
  if (!metaContent($, 'meta[name="twitter:card" i]')) {
    issues.push(
      issue({
        type: 'missing-twitter-card',
        message: 'No twitter:card tag (X and Twitter fall back to Open Graph, but the card type is a guess)',
        context: '<meta name="twitter:card" content="summary_large_image">'
      })
    )
  }
  return issues
}
