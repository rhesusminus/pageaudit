import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phaseOf } from '../src/lighthouse.js'
import { canSpin, createProgress, lighthouseProgress, progressBar } from '../src/progress.js'

const TTY = { isTTY: true, columns: 80 }

// A spinner factory that records what each spinner is asked to do, in place of ora.
function fakeSpinners() {
  const calls = []
  const spinner = ({ text, stream }) => {
    calls.push(['create', text, stream])
    const current = {
      start: () => (calls.push(['start']), current),
      stop: () => calls.push(['stop']),
      fail: (message) => calls.push(['fail', message]),
      set text(next) {
        calls.push(['text', next])
      }
    }
    return current
  }
  return { calls, spinner }
}

test('canSpin: a spinner is only shown on a TTY that reports columns', () => {
  assert.equal(canSpin({ isTTY: true, columns: 80 }), true)
  assert.equal(canSpin({ isTTY: true, columns: 0 }), false)
  assert.equal(canSpin({ isTTY: true }), false)
  assert.equal(canSpin({ isTTY: false, columns: 80 }), false)
  assert.equal(canSpin({}), false)
})

test('createProgress: a started spinner is updated, stopped and failed on the stream', () => {
  const { calls, spinner } = fakeSpinners()
  const progress = createProgress({ enabled: true, stream: TTY, spinner })
  const handle = progress.start('Reading URLs')
  handle.update('Reading sitemap https://a.test/sitemap.xml')
  handle.stop()
  progress.start('Checking links...').fail('no route')
  assert.deepEqual(calls, [
    ['create', 'Reading URLs', TTY],
    ['start'],
    ['text', 'Reading sitemap https://a.test/sitemap.xml'],
    ['stop'],
    ['create', 'Checking links...', TTY],
    ['start'],
    ['fail', 'no route']
  ])
})

test('createProgress: shows nothing for JSON output or a stream that cannot spin, but still prints a failure', (t) => {
  const errors = []
  t.mock.method(console, 'error', (message) => errors.push(message))
  for (const [enabled, stream] of [
    [false, TTY],
    [true, { isTTY: true, columns: 0 }],
    [true, { isTTY: false, columns: 80 }]
  ]) {
    const { calls, spinner } = fakeSpinners()
    const progress = createProgress({ enabled, stream, spinner })
    const handle = progress.start('Auditing 0/1 pages...')
    handle.update('Auditing 1/1 pages...')
    handle.stop()
    const lighthouse = progress.lighthouse(2, 1)
    lighthouse.onStatus({ text: 'Loading page...', progress: 0.2 }, 1)
    lighthouse.onProgress(1)
    lighthouse.stop()
    progress.start('Reading URLs').fail('Could not read the sitemap')
    assert.deepEqual(calls, [])
  }
  assert.deepEqual(errors, Array(3).fill('Could not read the sitemap'))
})

test('createProgress: the silent handle never shows a spinner, but still prints a failure', (t) => {
  const errors = []
  t.mock.method(console, 'error', (message) => errors.push(message))
  const { calls, spinner } = fakeSpinners()
  const progress = createProgress({ enabled: true, stream: TTY, spinner })
  progress.silent.update('Reading URLs')
  progress.silent.stop()
  progress.silent.fail('Could not read urls.txt')
  assert.deepEqual(calls, [])
  assert.deepEqual(errors, ['Could not read urls.txt'])
})

test('createProgress: the Lighthouse spinner follows phases and runs, and a finished page resets the phase', () => {
  const { calls, spinner } = fakeSpinners()
  const stream = { ...TTY }
  const lighthouse = createProgress({ enabled: true, stream, spinner }).lighthouse(2, 2)
  const loading = { text: 'Loading page...', progress: 0.2 }
  lighthouse.onStatus(loading, 1)
  lighthouse.onStatus(loading, 2)
  lighthouse.onProgress(1)
  // The width is read on every update, so a resized terminal gets a line that fits.
  stream.columns = 30
  lighthouse.onStatus(loading, 1)
  lighthouse.stop()
  assert.deepEqual(calls, [
    ['create', lighthouseProgress({ done: 0, phase: null, run: 1 }, 2, 2, 80), stream],
    ['start'],
    ['text', lighthouseProgress({ done: 0, phase: loading, run: 1 }, 2, 2, 80)],
    ['text', lighthouseProgress({ done: 0, phase: loading, run: 2 }, 2, 2, 80)],
    ['text', lighthouseProgress({ done: 1, phase: null, run: 1 }, 2, 2, 80)],
    ['text', lighthouseProgress({ done: 1, phase: loading, run: 1 }, 2, 2, 30)],
    ['stop']
  ])
})

test('progressBar: fills 20 cells and rounds down, so it is full only when done', () => {
  assert.equal(progressBar(0), '[░░░░░░░░░░░░░░░░░░░░]   0%')
  assert.equal(progressBar(0.4), '[████████░░░░░░░░░░░░]  40%')
  assert.equal(progressBar(0.999), '[███████████████████░]  99%')
  assert.equal(progressBar(1), '[████████████████████] 100%')
})

test('lighthouseProgress: a bar over every run, then pages done or the running page with its phase and run', () => {
  const loading = { text: 'Loading page...', progress: 0.2 }
  assert.equal(
    lighthouseProgress({ done: 0, phase: null, run: 1 }, 4, 1, 80),
    `Lighthouse ${progressBar(0)} 0/4 pages...`
  )
  assert.equal(
    lighthouseProgress({ done: 1, phase: null, run: 1 }, 4, 1, 80),
    `Lighthouse ${progressBar(0.25)} 1/4 pages...`
  )
  assert.equal(
    lighthouseProgress({ done: 1, phase: loading, run: 1 }, 4, 1, 80),
    `Lighthouse ${progressBar(0.3)} page 2/4: Loading page...`
  )
  // Page 2 of 4 with 2 runs each: 2 runs of page 1, 1 run of page 2 and a fifth of the second run, out of 8.
  assert.equal(
    lighthouseProgress({ done: 1, phase: loading, run: 2 }, 4, 2, 80),
    `Lighthouse ${progressBar(3.2 / 8)} page 2/4, run 2/2: Loading page...`
  )
})

test('lighthouseProgress: cuts the line to the terminal width, the bar last', () => {
  const state = { done: 1, phase: { text: 'Loading page...', progress: 0.2 }, run: 1 }
  const full = `Lighthouse ${progressBar(0.4)} page 2/3: Loading page...`
  assert.equal(lighthouseProgress(state, 3, 1, undefined), full)
  assert.equal(lighthouseProgress(state, 3, 1, 48), `Lighthouse ${progressBar(0.4)} page...`)
  // Terminals too narrow for the dots still never get a line wider than they are.
  assert.equal(lighthouseProgress(state, 3, 1, 5), 'Lig')
  assert.equal(lighthouseProgress(state, 3, 1, 3), 'L')
  assert.equal(lighthouseProgress(state, 3, 1, 2), '')
  assert.equal(lighthouseProgress(state, 3, 1, 1), '')
})

test('lighthouseProgress: every phase fits whole in an 80-column terminal, up to page 12/40 on run 2/3', () => {
  const messages = ['Connecting to browser', 'Navigating to https://a.test/', 'Getting artifact: A', 'Auditing: A']
  for (const phase of [...messages, 'Generating results'].map(phaseOf)) {
    const line = lighthouseProgress({ done: 11, phase, run: 2 }, 40, 3, 80)
    assert.ok(line.endsWith(phase.text), line)
  }
})
