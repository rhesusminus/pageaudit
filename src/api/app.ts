import type { FastifyError, FastifyServerOptions } from 'fastify'
import fastify from 'fastify'
import { fpSqlitePlugin } from 'fastify-sqlite-typed'
import { claimNextAudit, completeAudit, failAudit, recoverInterruptedAudits } from '../db/database.ts'
import { sendPage, webPages } from '../web/plugin.ts'
import { missingPage } from '../web/status.js'
import { errorStatus } from './error-status.ts'
import { routes } from './routes.ts'
import { startAuditWorker } from './worker.ts'

type AppOptions = {
  // ':memory:' gives the app a private database that disappears when it closes.
  dbFilename?: string
  // The address people reach the server at, such as https://audit.example.com, for links in the web pages.
  publicUrl?: string
}

export function build(opts: FastifyServerOptions = {}, { dbFilename = './database.db', publicUrl }: AppOptions = {}) {
  let worker: ReturnType<typeof startAuditWorker> | undefined
  const app = fastify(opts)
  // Parsed here, so an address that is not a URL stops the server at startup rather than breaking every link.
  const publicOrigin = publicUrl ? new URL(publicUrl).origin : undefined

  app.register(fpSqlitePlugin, { dbFilename })
  app.register(routes, { onAuditQueued: () => worker?.wake() })
  app.register(webPages, { onAuditQueued: () => worker?.wake(), publicOrigin })

  // Every error answers { error }, the shape the route schemas declare. Client errors (validation, malformed JSON)
  // keep Fastify's message so the caller can fix the request. Server errors are logged and their message is hidden.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = errorStatus(error)

    if (statusCode < 500) {
      return reply.code(statusCode).send({ error: error.message })
    }

    request.log.error({ err: error }, 'request failed')
    return reply.code(statusCode).send({ error: 'Internal Server Error' })
  })

  // A browser asking for a page gets one. Every other client keeps the { error } shape of the API.
  app.setNotFoundHandler((request, reply) =>
    request.headers.accept?.includes('text/html')
      ? sendPage(reply, 404, missingPage())
      : reply.code(404).send({ error: 'Not found' })
  )

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
