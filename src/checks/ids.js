// The elements with each id, in document order, found in one pass and kept per document. Checks look ids up through
// it instead of querying the document once per element. They only read the parsed page, so the index stays valid.
const indexes = new WeakMap()

export function elementsById($) {
  const root = $.root().get(0)
  if (!indexes.has(root)) {
    const elements = $('[id]').toArray()
    indexes.set(
      root,
      Map.groupBy(elements, (el) => el.attribs.id)
    )
  }
  return indexes.get(root)
}
