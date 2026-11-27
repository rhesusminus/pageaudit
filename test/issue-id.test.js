import assert from 'node:assert/strict'
import { test } from 'node:test'
import { issueId, uniqueIds } from '../src/issue-id.js'

test('issueId: formats as type followed by a dash and 8 lowercase hex characters', () => {
  assert.match(issueId('/about', 'title', 'missing'), /^title-[0-9a-f]{8}$/)
})

test('issueId: returns the same id on repeated calls with the same arguments', () => {
  const first = issueId('/about', 'title', 'missing')
  const second = issueId('/about', 'title', 'missing')
  assert.equal(first, second)
})

test('issueId: changes id when where, type, or detail changes', () => {
  const base = issueId('/about', 'title', 'missing')
  assert.notEqual(issueId('/contact', 'title', 'missing'), base)
  assert.notEqual(issueId('/about', 'meta', 'missing'), base)
  assert.notEqual(issueId('/about', 'title', 'too-long'), base)
})

test('issueId: treats a missing detail the same as an empty string', () => {
  assert.equal(issueId('/about', 'title'), issueId('/about', 'title', ''))
})

test('uniqueIds: keeps already unique ids unchanged and in order', () => {
  assert.deepEqual(uniqueIds(['a', 'b', 'c']), ['a', 'b', 'c'])
})

test('uniqueIds: appends -2, -3, ... to repeats in order of appearance', () => {
  assert.deepEqual(uniqueIds(['a', 'b', 'a', 'a']), ['a', 'b', 'a-2', 'a-3'])
  assert.deepEqual(uniqueIds(['a', 'b', 'b', 'a']), ['a', 'b', 'b-2', 'a-2'])
})

test('uniqueIds: returns an empty list for an empty input', () => {
  assert.deepEqual(uniqueIds([]), [])
})
