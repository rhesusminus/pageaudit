// Runs queued audits one at a time.
import type { FastifyInstance } from 'fastify'
import type { AuditResult, Db } from '../db/database.ts'
import { AUDIT_ERROR } from './audit-errors.js'
import { auditOnePage } from './audit-page.js'
import { fetchPublicPage, loadPublicRobots } from './public-destination.js'

type AuditJob = { id: string; url: string }

export type AuditWorkerHelpers = {
  claimNextAudit: (db: Db) => AuditJob | undefined
  completeAudit: (db: Db, id: string, result: AuditResult) => void
  failAudit: (db: Db, id: string, error: string) => void
}

type WorkerOptions = {
  pollIntervalMs?: number
  // Fetch private network addresses too, as the CLI does, for a server on someone's own machine.
  allowPrivateDestinations?: boolean
  audit?: (url: string) => Promise<AuditResult>
}

const runPublicAudit = (url: string) => auditOnePage(url, { fetchPage: fetchPublicPage, loadRobots: loadPublicRobots })

const runAnyAudit = (url: string) => auditOnePage(url)

// What became of an audit: what it found, or the error a failed audit stores.
type Outcome = { result: AuditResult } | { error: string }

type WorkerContext = {
  app: FastifyInstance
  helpers: AuditWorkerHelpers
  audit: (url: string) => Promise<AuditResult>
  // Waits one poll interval before something is tried again. False once the worker is stopping.
  pause: () => Promise<boolean>
}

async function runJob({ app, audit }: WorkerContext, job: AuditJob): Promise<Outcome> {
  let result: AuditResult
  try {
    result = await audit(job.url)
  } catch (error) {
    app.log.error({ err: error, auditId: job.id }, 'Audit failed')
    return { error: AUDIT_ERROR.failed }
  }

  // A failed fetch is returned as a page, rather than thrown by the runner.
  return result.page.status === null ? { error: AUDIT_ERROR.fetchFailed } : { result }
}

// SQLITE_BUSY and SQLITE_LOCKED: another connection holds the database for now, so the same write can pass on a later
// try. node:sqlite puts SQLite's result code in errcode, which can be an extended code whose low byte is the primary one.
const TRANSIENT = new Set([5, 6])

const isTransient = (error: unknown) =>
  typeof error === 'object' && error !== null && 'errcode' in error && TRANSIENT.has(Number(error.errcode) & 0xff)

function saveOutcome({ app, helpers }: WorkerContext, id: string, outcome: Outcome) {
  return 'result' in outcome
    ? helpers.completeAudit(app.db, id, outcome.result)
    : helpers.failAudit(app.db, id, outcome.error)
}

// A claimed audit reaches a final state even when saving its outcome fails, or its progress page would wait forever.
// While the database is locked, the same save is tried again every poll interval. A result that cannot be saved at
// all, such as when the disk is full or it is too large, is stored as failed instead. No other audit starts
// meanwhile, and only a stop gives up, leaving the audit to the restart recovery.
async function finish(worker: WorkerContext, job: AuditJob, outcome: Outcome) {
  const { app, helpers, pause } = worker
  const saveFailure = () => helpers.failAudit(app.db, job.id, AUDIT_ERROR.notSaved)
  let save = () => saveOutcome(worker, job.id, outcome)
  let wait = false
  for (;;) {
    if (wait && !(await pause())) return
    try {
      save()
      return
    } catch (error) {
      app.log.error({ err: error, auditId: job.id }, 'Could not save the audit result')
      // A result that can never be saved is stored as failed instead, at once.
      const giveUp = 'result' in outcome && !isTransient(error) && save !== saveFailure
      if (giveUp) save = saveFailure
      wait = !giveUp
    }
  }
}

// False when there was no audit to run.
async function processNextAudit(worker: WorkerContext) {
  const job = worker.helpers.claimNextAudit(worker.app.db)
  if (!job) {
    return false
  }

  await finish(worker, job, await runJob(worker, job))
  return true
}

export function startAuditWorker(
  app: FastifyInstance,
  helpers: AuditWorkerHelpers,
  {
    pollIntervalMs = 1000,
    allowPrivateDestinations = false,
    audit = allowPrivateDestinations ? runAnyAudit : runPublicAudit
  }: WorkerOptions = {}
) {
  let stopped = false
  // Set by wake() and checked before sleeping, so a wake that lands while a claim is in flight is not lost.
  let woken = false
  // Ends the current idle wait early. Set only while the worker sleeps.
  let endSleep: (() => void) | undefined

  const idle = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, pollIntervalMs)
      function done() {
        clearTimeout(timer)
        endSleep = undefined
        resolve()
      }
      endSleep = done
    })

  const worker: WorkerContext = {
    app,
    helpers,
    audit,
    pause: async () => {
      if (!stopped) await idle()
      return !stopped
    }
  }

  async function work() {
    while (!stopped) {
      woken = false
      try {
        if (await processNextAudit(worker)) {
          continue
        }
      } catch (error) {
        app.log.error({ err: error }, 'Audit worker error')
      }

      if (!woken && !stopped) {
        await idle()
      }
    }
  }

  const running = work()

  return {
    // Look for a queued audit now instead of at the next poll.
    wake() {
      woken = true
      endSleep?.()
    },
    async stop() {
      // Wake an idle worker immediately; an already claimed audit finishes first.
      stopped = true
      endSleep?.()
      await running
    }
  }
}
