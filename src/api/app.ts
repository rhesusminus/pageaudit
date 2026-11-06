import type { FastifyServerOptions } from 'fastify'
import fastify from 'fastify'
import { fpSqlitePlugin } from 'fastify-sqlite-typed'
import { routes } from './routes.ts'

type AppOptions = {
  // ':memory:' gives the app a private database that disappears when it closes.
  dbFilename?: string
}

export function build(opts: FastifyServerOptions = {}, { dbFilename = './database.db' }: AppOptions = {}) {
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
      result TEXT NOT NULL
    )
  `)
  })

  return app
}
