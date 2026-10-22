import { SOURCES } from '../../sources.js'
import { charCount, collapseWhitespace, htmlEntities } from '../../text.js'
import { evidence } from '../evidence.js'
import { MAX_CONTEXT, seoIssue } from '../snippet.js'
import { titleElement } from './meta.js'

// The first tag of `selector` with a non-empty content, as checkDescription() picks it. Read whole, a value cut at
// the display cap could lose the entity.
function firstContent($, selector) {
  for (const el of $(selector).toArray()) {
    const value = collapseWhitespace($(el).attr('content') ?? '')
    if (value) return { el, value }
  }
  return null
}

// Characters kept after the entity, so the context shows what it was escaped in.
const AFTER_ENTITY = 20

// The tag as written, where the extra &amp; shows. A long description often ends in the entity, so when the cap would
// cut it off, the middle of the text goes instead: the context keeps the start of the tag and ends just after the
// first entity.
function contextOf($, el, entity) {
  const html = collapseWhitespace($.html(el))
  const written = `&amp;${entity.slice(1)}`
  // The text starts after content=" in a meta tag and after <title>. The serializer writes every attribute value in
  // double quotes with " escaped, so ' content="' only matches the attribute itself, and the entity is looked for from
  // there, not in an attribute before it.
  const textAt = el.name === 'meta' ? html.indexOf(' content="') + ' content="'.length : html.indexOf('>') + 1
  const at = html.indexOf(written, textAt)
  if (at === -1) return html
  const chars = Array.from(html)
  const end = Math.min(chars.length, charCount(html.slice(0, at)) + charCount(written) + AFTER_ENTITY)
  if (end <= MAX_CONTEXT) return html
  // A tag start too long to keep is cut as well.
  const textStart = charCount(html.slice(0, textAt))
  const head = textStart <= MAX_CONTEXT / 2 ? textStart : 0
  const more = end < chars.length ? '...' : ''
  const tail = MAX_CONTEXT - head - 3 - more.length
  return `${chars.slice(0, head).join('')}...${chars.slice(end - tail, end).join('')}${more}`
}

// The text search results show for a page, with where it comes from and how much a mistake in it matters.
const FIELDS = [
  {
    label: 'Title',
    severity: 'warning',
    source: SOURCES.title,
    read: ($) => {
      const el = titleElement($).get(0)
      return el ? { el, value: collapseWhitespace($(el).text()) } : null
    }
  },
  {
    label: 'Meta description',
    severity: 'warning',
    source: SOURCES.snippet,
    read: ($) => firstContent($, 'meta[name="description" i]')
  }
]

// Text that still holds an entity such as &lt; after the browser decoded it was escaped twice, so results show the
// code instead of the character.
export function checkEscapedText($) {
  return FIELDS.flatMap(({ label, severity, source, read }) => {
    const found = read($)
    const entities = found ? htmlEntities(found.value) : []
    if (entities.length === 0) return []
    return [
      seoIssue({
        type: 'double-escaped-text',
        severity,
        source,
        message: `${label} shows ${entities.join(', ')} as text (escaped twice)`,
        context: contextOf($, found.el, entities[0]),
        actual: entities.join(', '),
        expected: 'the character itself, escaped once in the HTML',
        ...evidence($, found.el)
      })
    ]
  })
}
