import { setTimeout as sleep } from 'node:timers/promises'
import type { FastifyInstance } from 'fastify'
import { runAudit } from '../runner.js'
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
    await helpers.failAudit(app.db, job.id, 'Audit failed')
    return true
  }

  // A failed fetch is returned as a page, rather than thrown by the runner.
  if (page.status === null) {
    await helpers.failAudit(app.db, job.id, 'Could not fetch page')
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
  const controller = new AbortController()
  const { signal } = controller
  // Set by wake() and checked before sleeping, so a wake that lands while a claim is in flight is not lost.
  let woken = false
  let interruptSleep: AbortController | undefined

  async function work() {
    while (!signal.aborted) {
      woken = false
      try {
        if (await processNextAudit(app, helpers, audit)) {
          continue
        }
      } catch (error) {
        app.log.error({ err: error }, 'Audit worker error')
      }

      if (woken) {
        continue
      }

      const interrupt = new AbortController()
      interruptSleep = interrupt
      try {
        await sleep(pollIntervalMs, undefined, { signal: AbortSignal.any([signal, interrupt.signal]) })
      } catch (error) {
        if (!signal.aborted && !interrupt.signal.aborted) {
          throw error
        }
      } finally {
        interruptSleep = undefined
      }
    }
  }

  const running = work()

  return {
    // Look for a queued audit now instead of at the next poll.
    wake() {
      woken = true
      interruptSleep?.abort()
    },
    async stop() {
      // Wake an idle worker immediately; an already claimed audit finishes first.
      controller.abort()
      await running
    }
  }
}
