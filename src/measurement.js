// What a check found against what it expected, worded the same in every output: "Found 74, expected at most 60
// characters." Some checks know only what they expected, such as a page without an x-default hreflang link, and some
// found an empty value, such as an hreflang link with href="". Neither has a found value to show.

const hasFound = (actual) => actual !== undefined && actual !== null && actual !== ''

// The sentence, or '' when there is nothing to say. `show` formats the found value for the output it goes into, such
// as a Markdown code span; the caller escapes the result for HTML.
export function measurementText({ actual, expected }, show = String) {
  const found = hasFound(actual) ? `Found ${show(actual)}` : ''
  if (found && expected) return `${found}, expected ${expected}.`
  if (found) return `${found}.`
  return expected ? `Expected ${expected}.` : ''
}
