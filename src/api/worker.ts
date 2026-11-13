import type { FastifyInstance } from 'fastify'
import { runAudit } from '../runner.js'
import { AUDIT_ERROR } from './audit-errors.js'
import { fetchPublicPage } from './public-destination.js'

type Db = FastifyInstance['db']
type AuditPage = Awaited<ReturnType<typeof runAudit>>[number]
type AuditJob = { id: string; url: string }

export type AuditWorkerHelpers = {
  claimNextAudit: (db: Db) => Promise<AuditJob | undefined>
  completeAudit: (db: Db, id: string, page: AuditPage) => Promise<unknown>
  failAudit: (db: Db, id: string, error: string) => Promise<unknown>
}

type WorkerOptions = {
  pollIntervalMs?: number
  audit?: (url: string) => Promise<AuditPage>
}

async function runPublicAudit(url: string) {
  const [page] = await runAudit([url], { fetchPage: fetchPublicPage })
  return page
}

async function processNextAudit(
  app: FastifyInstance,
  helpers: AuditWorkerHelpers,
  audit: (url: string) => Promise<AuditPage>
) {
  const job = await helpers.claimNextAudit(app.db)
  if (!job) {
    return false
  }

  let page: AuditPage
  try {
    page = await audit(job.url)
  } catch (error) {
    app.log.error({ err: error, auditId: job.id }, 'Audit failed')
    await helpers.failAudit(app.db, job.id, AUDIT_ERROR.failed)
    return true
  }

  // A failed fetch is returned as a page, rather than thrown by the runner.
  if (page.status === null) {
    await helpers.failAudit(app.db, job.id, AUDIT_ERROR.fetchFailed)
  } else {
    await helpers.completeAudit(app.db, job.id, page)
  }

  return true
}

export function startAuditWorker(
  app: FastifyInstance,
  helpers: AuditWorkerHelpers,
  { pollIntervalMs = 1000, audit = runPublicAudit }: WorkerOptions = {}
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

  async function work() {
    while (!stopped) {
      woken = false
      try {
        if (await processNextAudit(app, helpers, audit)) {
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
