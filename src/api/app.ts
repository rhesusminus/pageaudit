import type { FastifyServerOptions } from 'fastify'
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
  app.register(routes)

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
