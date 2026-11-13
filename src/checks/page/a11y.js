import { SOURCES } from '../../sources.js'
import { evidence } from '../evidence.js'
import { seoIssue, snippet } from '../snippet.js'
import { accessibleName, hasBrokenLabelledBy, namedByScript } from './accname.js'

const CONTROLS = 'input:not([type=hidden], [type=submit], [type=button], [type=reset], [type=image]), select, textarea'
const ID_REFERENCES = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for']

const issue = ($, el, fields) =>
  seoIssue({ category: 'accessibility', context: snippet($, el), ...fields, ...evidence($, el) })

const LABELABLE = 'input:not([type=hidden]), select, textarea, button, meter, output, progress'

// The labels that apply to a control. An explicit `for` always wins over containment: a label with a `for`
// belongs to that id, and a label without one belongs to its first labelable descendant.
function labelsFor($, el) {
  const id = $(el).attr('id')
  return $('label')
    .toArray()
    .filter((label) => {
      const target = $(label).attr('for')
      return target === undefined ? $(label).find(LABELABLE).get(0) === el : Boolean(id) && target === id
    })
}

// A control is named by its label, aria-labelledby, aria-label or title, in the HTML or set by script.
function hasName($, el) {
  const labels = labelsFor($, el)
  if (labels.some((label) => accessibleName($, label) || namedByScript($, label))) return true
  return Boolean(accessibleName($, el, { content: false })) || namedByScript($, el, { content: false })
}

function checkFormLabels($) {
  return $(CONTROLS)
    .toArray()
    .filter((el) => $(el).attr('aria-hidden') !== 'true' && !hasName($, el))
    .map((el) =>
      issue($, el, {
        type: 'form-input-no-label',
        severity: 'error',
        source: SOURCES.formLabels,
        message: hasBrokenLabelledBy($, el)
          ? 'Form field has no accessible name, its aria-labelledby points at nothing usable'
          : 'Form field has no label (screen readers cannot say what to enter)'
      })
    )
}

// Which ids other attributes depend on: a duplicate that nothing refers to is only untidy markup.
function referencedIds($) {
  const ids = new Set()
  for (const attr of ID_REFERENCES) {
    $(`[${attr}]`).each((_, el) => {
      for (const id of $(el).attr(attr).split(/\s+/).filter(Boolean)) ids.add(id)
    })
  }
  return ids
}

function checkDuplicateIds($) {
  const byId = Map.groupBy(
    $('[id]')
      .toArray()
      .filter((el) => $(el).attr('id')),
    (el) => $(el).attr('id')
  )
  const referenced = referencedIds($)
  return [...byId]
    .filter(([, els]) => els.length > 1)
    .map(([id, els]) =>
      issue($, els[0], {
        type: 'duplicate-id',
        severity: referenced.has(id) ? 'error' : 'warning',
        category: referenced.has(id) ? 'accessibility' : 'best-practice',
        source: SOURCES.htmlId,
        message: referenced.has(id)
          ? `id "${id}" is used ${els.length} times and a label or ARIA attribute points at it`
          : `id "${id}" is used ${els.length} times (ids must be unique)`
      })
    )
}

function checkMainLandmark($) {
  if ($('main, [role=main]').length) return []
  return [
    seoIssue({
      type: 'missing-main-landmark',
      severity: 'info',
      category: 'accessibility',
      source: SOURCES.landmarks,
      message: 'No <main> landmark (keyboard and screen reader users cannot jump to the content)',
      context: '<body>'
    })
  ]
}

export const checkA11y = ($) => [...checkFormLabels($), ...checkDuplicateIds($), ...checkMainLandmark($)]
