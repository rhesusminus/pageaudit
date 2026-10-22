// Values a client-side framework fills in when the page runs. Google renders scripts and screen readers read the
// rendered page, so a bound src, alt or text is there, only its value is unknown to a static check. Covered are Vue
// and Alpine (`:src`, `v-bind:src`, `x-bind:src`, modifiers such as `.prop` allowed), Angular (`[src]`,
// `[attr.src]`) and AngularJS (`ng-attr-src`, and `ng-src`, `ng-srcset`, `ng-href`). `{{ }}` interpolation needs
// nothing here, it is text in the HTML already.

const ANGULARJS_SHORTHANDS = new Set(['src', 'srcset', 'href'])

const BOUND_TEXT = [
  'v-text',
  'v-html',
  'x-text',
  'x-html',
  'ng-bind',
  'ng-bind-html',
  '[textcontent]',
  '[innertext]',
  '[innerhtml]'
]

// The attribute that an attribute name binds, or null. htmlparser2 gives names in lower case.
function boundName(attr) {
  const vue = /^(?::|v-bind:|x-bind:)([^.]+)/.exec(attr)
  if (vue) return vue[1]
  const angular = /^\[(?:attr\.)?([^\]]+)\]$/.exec(attr)
  if (angular) return angular[1]
  const ngAttr = /^(?:data-)?ng-attr-(.+)$/.exec(attr)
  if (ngAttr) return ngAttr[1]
  const ng = /^(?:data-)?ng-(.+)$/.exec(attr)
  return ng && ANGULARJS_SHORTHANDS.has(ng[1]) ? ng[1] : null
}

export const isBound = (node, name) => Object.keys(node?.attribs ?? {}).some((attr) => boundName(attr) === name)

// The element's content is set by script, replacing what the HTML holds.
export const hasBoundText = (node) => BOUND_TEXT.some((attr) => node?.attribs?.[attr] !== undefined)
