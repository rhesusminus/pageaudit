// Keeps what `compute($, el)` works out for each element, so work that many elements of a page ask for about one
// shared element (a label, a link, a parent) is done once. The checks only read the parsed page, so a kept result
// stays right, and it goes when the page does.
export function perElement(compute) {
  const results = new WeakMap()
  return ($, el) => {
    if (!results.has(el)) results.set(el, compute($, el))
    return results.get(el)
  }
}
