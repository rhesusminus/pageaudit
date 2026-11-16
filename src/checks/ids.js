import { perElement } from './per-element.js'

// The elements with each id, in document order, found in one pass and kept per document. Checks look ids up through
// it instead of querying the document once per element.
const indexOf = perElement(($) => Map.groupBy($('[id]').toArray(), (el) => el.attribs.id))

export const elementsById = ($) => indexOf($, $.root().get(0))
