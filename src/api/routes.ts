import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@fastify/type-provider-typebox'
import { deleteAudit, getAudit } from '../db/database.ts'
import { AuditUrlError, queueCheckedAudit } from './queue-audit.ts'

const errorSchema = Type.Object({ error: Type.String() })

const auditSchema = {
  body: Type.Object({ url: Type.String({ format: 'uri', maxLength: 2048 }) }),
  response: {
    202: Type.Object({ id: Type.String(), status: Type.Literal('queued') }),
    400: errorSchema,
    503: errorSchema
  }
}

const getAuditSchema = {
  params: Type.Object({ id: Type.String() }),
  response: {
    200: Type.Object({
      id: Type.String(),
      url: Type.String(),
      created_at: Type.String(),
      result: Type.Union([Type.Unknown(), Type.Null()]),
      status: Type.Union([
        Type.Literal('queued'),
        Type.Literal('running'),
        Type.Literal('completed'),
        Type.Literal('failed')
      ]),
      error: Type.Union([Type.String(), Type.Null()])
    }),
    404: errorSchema
  }
}

const deleteAuditSchema = {
  params: Type.Object({ id: Type.String() }),
  response: {
    204: Type.Null(),
    404: errorSchema
  }
}

type RoutesOptions = {
  // Called after an audit is queued, so the worker can start it without waiting for its next poll.
  onAuditQueued: () => void
}

export const routes: FastifyPluginAsyncTypebox<RoutesOptions> = async (fastify, { onAuditQueued }) => {
  fastify.get(
    '/audits/:id',
    {
      schema: getAuditSchema
    },
    async (request, reply) => {
      const audit = await getAudit(fastify.db, request.params.id)

      if (!audit) {
        return reply.code(404).send({ error: 'Audit not found' })
      }

      return reply.code(200).send(audit)
    }
  )

  fastify.delete('/audits/:id', { schema: deleteAuditSchema }, async (request, reply) => {
    const deleted = await deleteAudit(fastify.db, request.params.id)

    if (!deleted) {
      return reply.code(404).send({ error: 'Audit not found' })
    }

    return reply.code(204).send(null)
  })

  fastify.post('/audits', { schema: auditSchema }, async (request, reply) => {
    let id: string

    try {
      id = await queueCheckedAudit(fastify.db, request.body.url)
    } catch (error) {
      if (!(error instanceof AuditUrlError)) throw error
      return reply.code(error.statusCode).send({ error: error.message })
    }

    onAuditQueued()

    return reply.code(202).header('location', `/audits/${id}`).send({ id, status: 'queued' })
  })
}
