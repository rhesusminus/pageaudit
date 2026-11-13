// A finished check as findings: the issues grouped by type, split into what to fix and notes, and the one-line verdict.
// The results page and the Markdown brief both read them from here.
import { groupIssues } from '../overview.js'
import { countSeverities } from '../severity.js'
import { count } from './format.js'

export function findingsOf(page) {
  const groups = groupIssues({ pages: [page], site: [] })
  return {
    groups,
    toFix: groups.filter((group) => group.severity !== 'info'),
    notes: groups.filter((group) => group.severity === 'info')
  }
}

// Counts findings, not the places they occur, so the numbers match the lists.
export function verdict(groups) {
  const { errors, warnings, infos } = countSeverities(groups)
  if (errors) {
    const rest = warnings ? ` ${count(warnings, 'more is', 'more are')} worth a look.` : ''
    return `Fix ${count(errors, 'problem')} first.${rest}`
  }
  if (warnings) return `No serious problems. ${count(warnings, 'thing is', 'things are')} worth a look.`
  return infos
    ? 'Nothing to fix. A few notes below are worth knowing.'
    : 'Nothing to fix. This page passes every check.'
}
