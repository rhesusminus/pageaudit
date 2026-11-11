import { join } from 'node:path'
import formbody from '@fastify/formbody'
import fastifyStatic from '@fastify/static'
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { errorStatus } from '../api/error-status.ts'
import { DestinationError } from '../api/public-destination.js'
import { queueCheckedAudit } from '../api/queue-audit.ts'
import { deleteAudit, getAudit } from '../db/database.ts'
import { resultBrief } from './brief.js'
import { shortAddress, withScheme } from './format.js'
import { EMPTY_ADDRESS, homePage } from './home.js'
import { deletePage, resultPage } from './result.js'
import { errorPage, failedPage, notFoundPage, progressPage, refusedPage, requestErrorPage } from './status.js'

type WebOptions = {
  // Called after an audit is queued, so the worker can start it without waiting for its next poll.
  onAuditQueued: () => void
  // The origin people reach this server at, such as https://audit.example.com, when it runs behind a proxy. Without
  // it, links that leave the page use the address of each request.
  publicOrigin?: string
}

type Audit = NonNullable<Awaited<ReturnType<typeof getAudit>>>

// Pages load only their own stylesheet and script, and can only send forms and requests back here.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'"
].join('; ')

export function sendPage(reply: FastifyReply, statusCode: number, html: string) {
  return reply
    .code(statusCode)
    .type('text/html; charset=utf-8')
    .header('content-security-policy', CONTENT_SECURITY_POLICY)
    .header('cache-control', 'no-store')
    .send(html)
}

function auditPage(audit: Audit, origin: string) {
  if (audit.status === 'completed') return resultPage(audit, origin)
  if (audit.status === 'failed') return failedPage(audit)
  return progressPage(audit)
}

// The results as Markdown for Claude. A check still running has no results yet, so it answers 409.
function sendBrief(reply: FastifyReply, audit: Audit | undefined, origin: string) {
  const text = (code: number, body: string) =>
    reply.code(code).type('text/plain; charset=utf-8').header('cache-control', 'no-store').send(body)
  if (!audit) return text(404, 'There are no results at this address.\n')
  if (audit.status !== 'completed' && audit.status !== 'failed') return text(409, 'The check is still running.\n')
  const name = `pageaudit-${shortAddress(audit.url)
    .replace(/[^a-z0-9.-]+/gi, '-')
    .slice(0, 80)}.md`
  return reply
    .type('text/markdown; charset=utf-8')
    .header('content-disposition', `inline; filename="${name}"`)
    .header('cache-control', 'no-store')
    .send(resultBrief(audit, origin))
}

// Why an address was not checked, in the words of someone who typed it into the form.
function addressProblem({ reason, host }: DestinationError) {
  if (reason === 'private') return 'That address is not on the public internet, so it cannot be checked.'
  if (reason === 'unknown-host') return `No site answers at ${host}. Check the spelling of the address.`
  if (reason === 'lookup-failed') return `Could not look up ${host} just now. Try again in a minute.`
  return 'That is not a web address. Enter one like example.com/about.'
}

// The address this server is reached at, for links that leave the page, such as the one in the brief for Claude.
const originOf = (request: FastifyRequest, publicOrigin?: string) =>
  publicOrigin ?? `${request.protocol}://${request.host}`

// The forms here change state, so only a form posted from this site's own pages is taken. Browsers send
// Sec-Fetch-Site, and only 'same-origin' passes: 'same-site' also covers sibling subdomains, which someone else may
// control. A browser too old for Sec-Fetch-Site still sends Origin with a post. A client that sends neither is not a
// browser and not the threat this guards against.
function fromThisSite(request: FastifyRequest, publicOrigin?: string) {
  const site = request.headers['sec-fetch-site']
  if (site) return site === 'same-origin'
  const { origin } = request.headers
  if (origin === undefined) return true
  // Without a configured origin only the host is compared, since behind a proxy the request itself may arrive over
  // http. "null" (a sandboxed or privacy-sensitive context) never matches.
  return publicOrigin ? origin === publicOrigin : URL.parse(origin)?.host === request.host
}

// Client errors, such as a form too large or a body that does not parse, keep their status. Only server errors are
// logged, and neither shows its message.
function pageError(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  const statusCode = errorStatus(error)
  if (statusCode < 500) return sendPage(reply, statusCode, requestErrorPage())
  request.log.error({ err: error }, 'page failed')
  return sendPage(reply, 500, errorPage())
}

export const webPages: FastifyPluginAsync<WebOptions> = async (fastify, { onAuditQueued, publicOrigin }) => {
  await fastify.register(formbody)
  await fastify.register(fastifyStatic, { root: join(import.meta.dirname, 'public'), prefix: '/assets/', index: false })

  const sameOriginOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fromThisSite(request, publicOrigin)) return sendPage(reply, 403, refusedPage())
  }

  fastify.setErrorHandler(pageError)

  fastify.get<{ Querystring: { deleted?: string } }>('/', async (request, reply) => {
    const notice = request.query.deleted === undefined ? null : 'The results were deleted.'
    return sendPage(reply, 200, homePage({ notice }))
  })

  fastify.post<{ Body: { url?: unknown } | undefined }>(
    '/check',
    { preHandler: sameOriginOnly },
    async (request, reply) => {
      // The form posts one url field. A repeated field or a body of another shape holds no address to check.
      const url = request.body?.url
      const value = typeof url === 'string' ? url.trim() : ''
      if (!value) return sendPage(reply, 400, homePage({ value, problem: EMPTY_ADDRESS }))

      try {
        const id = await queueCheckedAudit(fastify.db, withScheme(value))
        onAuditQueued()
        return reply.redirect(`/check/${id}`, 303)
      } catch (error) {
        if (!(error instanceof DestinationError)) throw error
        return sendPage(reply, error.statusCode, homePage({ value, problem: addressProblem(error) }))
      }
    }
  )

  fastify.get<{ Params: { id: string } }>('/check/:id', async (request, reply) => {
    const audit = await getAudit(fastify.db, request.params.id)
    if (!audit) return sendPage(reply, 404, notFoundPage())
    return sendPage(reply, 200, auditPage(audit, originOf(request, publicOrigin)))
  })

  fastify.get<{ Params: { id: string } }>('/check/:id.md', async (request, reply) => {
    return sendBrief(reply, await getAudit(fastify.db, request.params.id), originOf(request, publicOrigin))
  })

  // The results page asks in a dialog before it deletes. Without JavaScript its button opens this page, which asks.
  fastify.get<{ Params: { id: string } }>('/check/:id/delete', async (request, reply) => {
    const audit = await getAudit(fastify.db, request.params.id)
    if (!audit) return sendPage(reply, 404, notFoundPage())
    return sendPage(reply, 200, deletePage(audit))
  })

  fastify.post<{ Params: { id: string } }>(
    '/check/:id/delete',
    { preHandler: sameOriginOnly },
    async (request, reply) => {
      if (!(await deleteAudit(fastify.db, request.params.id))) return sendPage(reply, 404, notFoundPage())
      return reply.redirect('/?deleted', 303)
    }
  )
}
