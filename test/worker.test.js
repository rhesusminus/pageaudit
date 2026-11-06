import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { startAuditWorker } from '../src/api/worker.ts'

function setup(t, jobs, { claim, ...options } = {}) {
  const app = { db: {}, log: { error: t.mock.fn() } }
  const saved = []
  const finished = Promise.withResolvers()
  const helpers = {
    claimNextAudit: t.mock.fn(claim ?? (async () => jobs.shift())),
    completeAudit: async (_db, id, page) => {
      saved.push({ id, page })
      finished.resolve()
    },
    failAudit: async (_db, id, error) => {
      saved.push({ id, error })
      finished.resolve()
    }
  }
  const worker = startAuditWorker(app, helpers, { pollIntervalMs: 1, ...options })
  t.after(() => worker.stop())
  return { app, helpers, worker, saved, finished: finished.promise }
}

test('worker: processes jobs sequentially and stop waits for the active audit', { timeout: 1000 }, async (t) => {
  const started = Promise.withResolvers()
  const result = Promise.withResolvers()
  const page = { status: 200 }
  const jobs = [
    { id: 'first', url: 'https://first.test' },
    { id: 'second', url: 'https://second.test' }
  ]
  const state = setup(t, jobs, {
    audit: async () => {
      started.resolve()
      return result.promise
    }
  })
  await started.promise
  let stopped = false
  const stopping = state.worker.stop().then(() => {
    stopped = true
  })
  await nextTurn()
  assert.equal(stopped, false)
  assert.equal(state.helpers.claimNextAudit.mock.callCount(), 1)
  result.resolve(page)
  await stopping
  assert.deepEqual(state.saved, [{ id: 'first', page }])
  assert.equal(jobs.length, 1)
})

test('worker: saves failed fetches and thrown audit errors, then processes the next job', {
  timeout: 1000
}, async (t) => {
  const jobs = [1, 2, 3].map((id) => ({ id: String(id), url: `https://job.test/${id}` }))
  const done = Promise.withResolvers()
  const state = setup(t, jobs, {
    audit: async (url) => {
      if (url.endsWith('/1')) return { status: null }
      if (url.endsWith('/2')) throw new Error('audit crashed')
      done.resolve()
      return { status: 200 }
    }
  })
  await done.promise
  await state.worker.stop()
  assert.deepEqual(state.saved, [
    { id: '1', error: 'Could not fetch page' },
    { id: '2', error: 'Audit failed' },
    { id: '3', page: { status: 200 } }
  ])
  assert.equal(state.app.log.error.mock.callCount(), 1)
})

test('worker: retries after a database error', { timeout: 1000 }, async (t) => {
  const state = setup(t, [], { audit: async () => ({ status: 200 }) })
  let attempts = 0
  state.helpers.claimNextAudit.mock.mockImplementation(async () => {
    attempts++
    if (attempts === 1) throw new Error('database busy')
    return { id: 'retry', url: 'https://job.test' }
  })
  await state.finished
  await state.worker.stop()
  assert.equal(state.app.log.error.mock.callCount(), 1)
  assert.equal(state.saved[0].id, 'retry')
})

test('worker: wakes immediately on idle shutdown and workers have independent lifecycles', {
  timeout: 1000
}, async (t) => {
  const first = setup(t, [], { pollIntervalMs: 60_000 })
  await nextTurn()
  await first.worker.stop()
  await first.worker.stop()
  const second = setup(t, [{ id: 'new', url: 'https://job.test' }], { audit: async () => ({ status: 200 }) })
  await second.finished
  await second.worker.stop()
  assert.equal(second.saved[0].id, 'new')
})

test('worker: persistence failures are logged without marking a successful audit failed', {
  timeout: 1000
}, async (t) => {
  const result = Promise.withResolvers()
  const attempted = Promise.withResolvers()
  const state = setup(t, [{ id: 'save', url: 'https://job.test' }], { audit: async () => result.promise })
  state.helpers.completeAudit = async () => {
    attempted.resolve()
    throw new Error('database unavailable')
  }
  result.resolve({ status: 200 })
  await attempted.promise
  await state.worker.stop()
  assert.equal(state.app.log.error.mock.callCount(), 1)
  assert.deepEqual(state.saved, [])
})

test('worker: wake starts a newly queued audit without waiting for the next poll', { timeout: 1000 }, async (t) => {
  const jobs = []
  const state = setup(t, jobs, { pollIntervalMs: 60_000, audit: async () => ({ status: 200 }) })
  await nextTurn()
  assert.equal(state.helpers.claimNextAudit.mock.callCount(), 1)
  jobs.push({ id: 'woken', url: 'https://job.test' })
  state.worker.wake()
  await state.finished
  assert.deepEqual(state.saved, [{ id: 'woken', page: { status: 200 } }])
})

test('worker: a wake during an empty claim is not lost', { timeout: 1000 }, async (t) => {
  const jobs = []
  let state
  let claims = 0
  // The first claim finds nothing, but an audit is queued and the worker woken before that answer arrives.
  const claim = async () => {
    if (++claims > 1) return jobs.shift()
    await nextTurn()
    jobs.push({ id: 'raced', url: 'https://job.test' })
    state.worker.wake()
    return undefined
  }
  state = setup(t, jobs, { claim, pollIntervalMs: 60_000, audit: async () => ({ status: 200 }) })
  await state.finished
  assert.equal(state.saved[0].id, 'raced')
})
