// Accessibility checks: form labels, duplicate ids and the main landmark.
import { SOURCES } from '../../sources.js'
import { evidence } from '../evidence.js'
import { elementsById } from '../ids.js'
import { seoIssue, snippet } from '../snippet.js'
import { accessibleName, hasBrokenLabelledBy, namedByScript } from './accname.js'

const CONTROLS = 'input:not([type=hidden], [type=submit], [type=button], [type=reset], [type=image]), select, textarea'
const ID_REFERENCES = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'for']

const issue = ($, el, fields) =>
  seoIssue({ category: 'accessibility', context: snippet($, el), ...fields, ...evidence($, el) })

const LABELABLE = 'input:not([type=hidden]), select, textarea, button, meter, output, progress'

// The first labelable descendant of each label without a `for`, from one walk over the page instead of a search
// inside each label, which nested labels would repeat for every level. The labels still waiting for an element are
// the ones the walk is inside, so the next labelable element is the first one of each.
function firstLabelable($) {
  const labelable = new Set($(LABELABLE).toArray())
  const found = new Map()
  let waiting = []
  const visit = (node) => {
    for (const child of node.children ?? []) {
      if (child.type !== 'tag') continue
      if (labelable.has(child)) {
        for (const label of waiting) found.set(label, child)
        waiting = []
      }
      const isLabel = child.name === 'label' && child.attribs.for === undefined
      if (isLabel) waiting.push(child)
      visit(child)
      // A label still waiting is the last one added, since the labels inside it were removed when the walk left them.
      if (isLabel && waiting.at(-1) === child) waiting.pop()
    }
  }
  visit($.root().get(0))
  return found
}

// Whether a label with a name applies to a control, from one pass over the labels instead of one per control. An
// explicit `for` always wins over containment: a label with a `for` belongs to every element with that id, and a label
// without one belongs to its first labelable descendant.
function namedByLabel($) {
  const ids = new Set()
  const controls = new Set()
  const firstInside = firstLabelable($)
  for (const label of $('label').toArray()) {
    if (!accessibleName($, label) && !namedByScript($, label)) continue
    const target = $(label).attr('for')
    if (target === undefined) controls.add(firstInside.get(label))
    else if (target) ids.add(target)
  }
  return (el) => controls.has(el) || ids.has($(el).attr('id'))
}

// A control without a label is named by its aria-labelledby, aria-label or title, in the HTML or set by script.
const hasOwnName = ($, el) =>
  Boolean(accessibleName($, el, { content: false })) || namedByScript($, el, { content: false })

function checkFormLabels($) {
  const labelled = namedByLabel($)
  return $(CONTROLS)
    .toArray()
    .filter((el) => $(el).attr('aria-hidden') !== 'true' && !labelled(el) && !hasOwnName($, el))
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
  const referenced = referencedIds($)
  return [...elementsById($)]
    .filter(([id, els]) => id && els.length > 1)
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
