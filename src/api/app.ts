import type { FastifyError, FastifyServerOptions } from 'fastify'
import fastify from 'fastify'
import { fpSqlitePlugin } from 'fastify-sqlite-typed'
import { claimNextAudit, completeAudit, failAudit, recoverInterruptedAudits } from '../db/database.ts'
import { routes } from './routes.ts'
import { startAuditWorker } from './worker.ts'

type AppOptions = {
  // ':memory:' gives the app a private database that disappears when it closes.
  dbFilename?: string
}

export function build(opts: FastifyServerOptions = {}, { dbFilename = './database.db' }: AppOptions = {}) {
  let worker: ReturnType<typeof startAuditWorker> | undefined
  const app = fastify(opts)

  app.register(fpSqlitePlugin, { dbFilename })
  app.register(routes, { onAuditQueued: () => worker?.wake() })

  // Every error answers { error }, the shape the route schemas declare. Client errors (validation, malformed JSON)
  // keep Fastify's message so the caller can fix the request. Server errors are logged and their message is hidden.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode !== undefined && error.statusCode >= 400 ? error.statusCode : 500

    if (statusCode < 500) {
      return reply.code(statusCode).send({ error: error.message })
    }

    request.log.error({ err: error }, 'request failed')
    return reply.code(statusCode).send({ error: 'Internal Server Error' })
  })

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }))

  app.addHook('onReady', async () => {
    await app.db.exec(`
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      result TEXT,
      status TEXT NOT NULL,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0
    )
  `)
  })

  app.addHook('onReady', async () => {
    await recoverInterruptedAudits(app.db)
    worker = startAuditWorker(app, { claimNextAudit, completeAudit, failAudit })
  })

  // Finish using SQLite before the database plugin's onClose hook closes it.
  app.addHook('preClose', async () => {
    await worker?.stop()
  })

  return app
}
