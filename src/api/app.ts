// build(): Fastify with the database, the worker, the API routes and the web pages.
import type { FastifyError, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify'
import fastify from 'fastify'
import {
  claimNextAudit,
  completeAudit,
  type Db,
  failAudit,
  openDatabase,
  recoverInterruptedAudits,
  removeHiddenAudits
} from '../db/database.ts'
import { ASSETS_PREFIX, sendPage, webPages } from '../web/plugin.ts'
import { missingPage, unknownHostPage } from '../web/status.js'
import { answersTo, sentHost } from './allowed-host.ts'
import { errorStatus } from './error-status.ts'
import { routes } from './routes.ts'
import { startAuditWorker } from './worker.ts'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
  }
}

type AppOptions = {
  // ':memory:' gives the app a private database that disappears when it closes.
  dbFilename?: string
  // The address people reach the server at, such as https://audit.example.com, for links in the web pages.
  publicUrl?: string
  // Lets audits reach private network addresses, such as a development site on localhost. Only for a server on
  // someone's own machine: on a shared server it would let anyone reach the server's own network.
  allowPrivateDestinations?: boolean
}

// A browser asking for a page gets one. Every other client keeps the { error } shape of the API.
const sendError = (
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  error: string,
  page: () => string
) =>
  request.headers.accept?.includes('text/html')
    ? sendPage(reply, statusCode, page())
    : reply.code(statusCode).send({ error })

export function build(
  opts: FastifyServerOptions = {},
  { dbFilename = './database.db', publicUrl, allowPrivateDestinations = false }: AppOptions = {}
) {
  let worker: ReturnType<typeof startAuditWorker> | undefined
  const app = fastify(opts)
  // Parsed here, so an address that is not a URL stops the server at startup rather than breaking every link.
  const publicAddress = publicUrl ? new URL(publicUrl) : undefined

  const onAuditQueued = () => worker?.wake()

  // Before every route, the API and the pages alike, and before the body is read. 421 Misdirected Request says the
  // request named a host this server does not answer for, rather than that the request was malformed. Only the static
  // files pass at any host: they hold nothing about anyone's audits, and the refusal page needs its stylesheet. The
  // route the router matched is compared, not the path, so a path that leaves /assets/ is either routed elsewhere and
  // refused here, or taken by the static files, which serve only files from their own folder.
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.url === `${ASSETS_PREFIX}*`) return
    if (answersTo(sentHost(request), publicAddress?.hostname)) return
    const error = 'This server only answers at localhost, an IP address or the host of PUBLIC_URL'
    return sendError(request, reply, 421, error, unknownHostPage)
  })

  const db = openDatabase(dbFilename)
  app.decorate('db', db)
  app.register(routes, { onAuditQueued, allowPrivateDestinations })
  app.register(webPages, { onAuditQueued, allowPrivateDestinations, publicOrigin: publicAddress?.origin })

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

  app.setNotFoundHandler((request, reply) => sendError(request, reply, 404, 'Not found', missingPage))

  app.addHook('onReady', async () => {
    db.exec(`
    -- SQLite otherwise leaves a deleted row's bytes in the file until the space is reused, and deleted results must be
    -- gone, not only unlisted.
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL,
      error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      -- Last, so reading the small columns never walks a long report's overflow pages.
      result TEXT
    );
    -- The worker claims the first queued audit, by rowid, every poll. Only queued rows are in this index, so a claim
    -- does not scan every stored audit. Every index entry ends with its rowid, so an index on (status) of rows that
    -- all share one status is in rowid order. audits_queue is the index an older version ordered by created_at.
    DROP INDEX IF EXISTS audits_queue;
    CREATE INDEX IF NOT EXISTS audits_queued ON audits (status) WHERE status = 'queued';
  `)
    removeHiddenAudits(db)
  })

  app.addHook('onReady', async () => {
    recoverInterruptedAudits(db)
    worker = startAuditWorker(app, { claimNextAudit, completeAudit, failAudit }, { allowPrivateDestinations })
  })

  // Finish using SQLite before the onClose hook closes it.
  app.addHook('preClose', async () => {
    await worker?.stop()
  })

  app.addHook('onClose', async () => {
    db.close()
  })

  return app
}
