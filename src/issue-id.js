import { createHash } from 'node:crypto'

// A short id for one issue, so a suggestion can refer back to it. It depends on the page, the issue type and where
// the issue is, so it is the same on every run while the page keeps its structure.
export const issueId = (where, type, detail) =>
  `${type}-${createHash('sha1')
    .update(`${where}\n${type}\n${detail || ''}`)
    .digest('hex')
    .slice(0, 8)}`

// Two issues that would share an id (same element twice, identical context) get -2, -3 and so on.
export function uniqueIds(ids) {
  const seen = new Map()
  return ids.map((id) => {
    const count = (seen.get(id) ?? 0) + 1
    seen.set(id, count)
    return count === 1 ? id : `${id}-${count}`
  })
}
