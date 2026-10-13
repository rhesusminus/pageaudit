// Severity counting and ordering, shared by the JSON report, the terminal and the HTML report.

const ORDER = { error: 0, warning: 1, info: 2 }

// Sorts severities most severe first.
export const compareSeverity = (a, b) => ORDER[a] - ORDER[b]

export const worseSeverity = (a, b) => (compareSeverity(a, b) <= 0 ? a : b)

export function countSeverities(issues) {
  const counts = { errors: 0, warnings: 0, infos: 0 }
  for (const { severity } of issues) {
    if (severity === 'error') counts.errors++
    else if (severity === 'warning') counts.warnings++
    else counts.infos++
  }
  return counts
}

// Worst pages first: most errors, then warnings, then infos. Ties keep input order.
export function worstFirst(pages) {
  return pages
    .map((page) => ({ ...page, counts: countSeverities(page.issues) }))
    .sort(
      (a, b) =>
        b.counts.errors - a.counts.errors || b.counts.warnings - a.counts.warnings || b.counts.infos - a.counts.infos
    )
}
