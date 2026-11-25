import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { startAuditWorker } from '../src/api/worker.ts'

// What an audit of a page with this status finds, the way auditOnePage() returns it.
const audited = (status) => ({ page: { status }, site: [], origins: [] })

function setup(t, jobs, { claim, ...options } = {}) {
  const app = { db: {}, log: { error: t.mock.fn() } }
  const saved = []
  const finished = Promise.withResolvers()
  const helpers = {
    claimNextAudit: t.mock.fn(claim ?? (() => jobs.shift())),
    completeAudit: (_db, id, result) => {
      saved.push({ id, result })
      finished.resolve()
    },
    failAudit: (_db, id, error) => {
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
  const audit = audited(200)
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
  result.resolve(audit)
  await stopping
  assert.deepEqual(state.saved, [{ id: 'first', result: audit }])
  assert.equal(jobs.length, 1)
})

test('worker: saves failed fetches and thrown audit errors, then processes the next job', {
  timeout: 1000
}, async (t) => {
  const jobs = [1, 2, 3].map((id) => ({ id: String(id), url: `https://job.test/${id}` }))
  const done = Promise.withResolvers()
  const state = setup(t, jobs, {
    audit: async (url) => {
      if (url.endsWith('/1')) return audited(null)
      if (url.endsWith('/2')) throw new Error('audit crashed')
      done.resolve()
      return audited(200)
    }
  })
  await done.promise
  await state.worker.stop()
  assert.deepEqual(state.saved, [
    { id: '1', error: 'Could not fetch page' },
    { id: '2', error: 'Audit failed' },
    { id: '3', result: audited(200) }
  ])
  assert.equal(state.app.log.error.mock.callCount(), 1)
})

test('worker: retries after a database error', { timeout: 1000 }, async (t) => {
  const state = setup(t, [], { audit: async () => audited(200) })
  let attempts = 0
  state.helpers.claimNextAudit.mock.mockImplementation(() => {
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
  const second = setup(t, [{ id: 'new', url: 'https://job.test' }], { audit: async () => audited(200) })
  await second.finished
  await second.worker.stop()
  assert.equal(second.saved[0].id, 'new')
})

// An error as node:sqlite throws it, with SQLite's result code in errcode.
const RESULT_CODES = { SQLITE_BUSY: 5, SQLITE_LOCKED: 6, SQLITE_FULL: 13, SQLITE_TOOBIG: 18 }
const sqliteError = (name) =>
  Object.assign(new Error('database error'), { code: 'ERR_SQLITE_ERROR', errcode: RESULT_CODES[name], errstr: name })

test('worker: a result that cannot be saved marks the audit failed instead of leaving it running', {
  timeout: 1000
}, async (t) => {
  const state = setup(t, [{ id: 'save', url: 'https://job.test' }], { audit: async () => audited(200) })
  state.helpers.completeAudit = () => {
    throw sqliteError('SQLITE_TOOBIG')
  }
  await state.finished
  await state.worker.stop()
  assert.deepEqual(state.saved, [{ id: 'save', error: 'Audit result could not be saved' }])
  assert.equal(state.app.log.error.mock.callCount(), 1)
})

// The database stays locked for the first three writes, then frees up. Returns how many audits had been claimed when
// the write went through.
function lockFor(state, name, writes = 3) {
  const write = state.helpers[name]
  let attempts = 0
  const claims = { whenSaved: undefined }
  state.helpers[name] = (...args) => {
    if (++attempts <= writes) throw sqliteError(attempts % 2 ? 'SQLITE_BUSY' : 'SQLITE_LOCKED')
    claims.whenSaved ??= state.helpers.claimNextAudit.mock.callCount()
    return write(...args)
  }
  return claims
}

const twoJobs = () => [
  { id: 'locked', url: 'https://job.test/1' },
  { id: 'next', url: 'https://job.test/2' }
]

test('worker: a result is saved once the database frees up, before the next audit starts', {
  timeout: 1000
}, async (t) => {
  const state = setup(t, twoJobs(), { audit: async () => audited(200) })
  const claims = lockFor(state, 'completeAudit')
  await state.finished
  await state.worker.stop()
  assert.deepEqual(state.saved[0], { id: 'locked', result: audited(200) })
  assert.equal(state.app.log.error.mock.callCount(), 3)
  assert.equal(claims.whenSaved, 1)
})

test('worker: a failure is saved once the database frees up, before the next audit starts', {
  timeout: 1000
}, async (t) => {
  const state = setup(t, twoJobs(), { audit: async () => audited(null) })
  const claims = lockFor(state, 'failAudit')
  await state.finished
  await state.worker.stop()
  assert.deepEqual(state.saved[0], { id: 'locked', error: 'Could not fetch page' })
  assert.equal(state.app.log.error.mock.callCount(), 3)
  assert.equal(claims.whenSaved, 1)
})

test('worker: stop ends the retries of an outcome that cannot be saved', { timeout: 1000 }, async (t) => {
  const tried = Promise.withResolvers()
  const state = setup(t, [{ id: 'full', url: 'https://job.test' }], {
    pollIntervalMs: 60_000,
    audit: async () => audited(200)
  })
  state.helpers.completeAudit = () => {
    throw sqliteError('SQLITE_FULL')
  }
  state.helpers.failAudit = () => {
    tried.resolve()
    throw sqliteError('SQLITE_FULL')
  }
  await tried.promise
  await state.worker.stop()
  assert.deepEqual(state.saved, [])
  assert.equal(state.helpers.claimNextAudit.mock.callCount(), 1)
})

test('worker: wake starts a newly queued audit without waiting for the next poll', { timeout: 1000 }, async (t) => {
  const jobs = []
  const state = setup(t, jobs, { pollIntervalMs: 60_000, audit: async () => audited(200) })
  await nextTurn()
  assert.equal(state.helpers.claimNextAudit.mock.callCount(), 1)
  jobs.push({ id: 'woken', url: 'https://job.test' })
  state.worker.wake()
  await state.finished
  assert.deepEqual(state.saved, [{ id: 'woken', result: audited(200) }])
})

test('worker: a wake during an empty claim is not lost', { timeout: 1000 }, async (t) => {
  const jobs = []
  let state
  let claims = 0
  // The first claim finds nothing, but a request queues an audit and wakes the worker before the worker acts on that
  // answer: a microtask queued during the claim runs before the worker continues.
  const claim = () => {
    if (++claims > 1) return jobs.shift()
    queueMicrotask(() => {
      jobs.push({ id: 'raced', url: 'https://job.test' })
      state.worker.wake()
    })
    return undefined
  }
  state = setup(t, jobs, { claim, pollIntervalMs: 60_000, audit: async () => audited(200) })
  await state.finished
  assert.equal(state.saved[0].id, 'raced')
})
