import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareSeverity, countSeverities, worseSeverity, worstFirst } from '../src/severity.js'

const issues = (...severities) => severities.map((severity) => ({ severity }))

test('compareSeverity: sorts errors first, then warnings, then infos', () => {
  assert.deepEqual(['info', 'error', 'warning', 'error'].toSorted(compareSeverity), [
    'error',
    'error',
    'warning',
    'info'
  ])
})

test('worseSeverity: picks the more severe of two', () => {
  assert.equal(worseSeverity('warning', 'error'), 'error')
  assert.equal(worseSeverity('warning', 'info'), 'warning')
  assert.equal(worseSeverity('info', 'info'), 'info')
})

test('countSeverities: counts each severity', () => {
  assert.deepEqual(countSeverities(issues('error', 'info', 'warning', 'error')), { errors: 2, warnings: 1, infos: 1 })
  assert.deepEqual(countSeverities([]), { errors: 0, warnings: 0, infos: 0 })
})

test('worstFirst: most errors first, then warnings, then infos, ties keep input order', () => {
  const pages = [
    { url: 'infos', issues: issues('info', 'info') },
    { url: 'warning', issues: issues('warning') },
    { url: 'tie', issues: issues('warning') },
    { url: 'error', issues: issues('error', 'info') }
  ]
  const sorted = worstFirst(pages)
  assert.deepEqual(
    sorted.map((page) => page.url),
    ['error', 'warning', 'tie', 'infos']
  )
  assert.deepEqual(sorted[0].counts, { errors: 1, warnings: 0, infos: 1 })
})
