import assert from 'node:assert/strict'
import { test } from 'node:test'
import { measurementText } from '../src/measurement.js'

test('measurementText: says what was found against what was expected', () => {
  assert.equal(
    measurementText({ actual: 74, expected: 'at most 60 characters' }),
    'Found 74, expected at most 60 characters.'
  )
  assert.equal(measurementText({ actual: 0 }), 'Found 0.')
})

test('measurementText: a missing or empty found value is left out, not shown as blank or undefined', () => {
  assert.equal(measurementText({ expected: 'an x-default link' }), 'Expected an x-default link.')
  assert.equal(measurementText({ actual: '', expected: 'an absolute URL' }), 'Expected an absolute URL.')
  assert.equal(measurementText({ actual: null, expected: 'an absolute URL' }), 'Expected an absolute URL.')
  assert.equal(measurementText({}), '')
})

test('measurementText: formats the found value for the output it goes into', () => {
  const code = (value) => `\`${value}\``
  assert.equal(
    measurementText({ actual: '/de/', expected: 'an absolute URL' }, code),
    'Found `/de/`, expected an absolute URL.'
  )
})
