import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@fastify/type-provider-typebox'
import { getAudit, saveAudit } from '../db/database.ts'
import { normalize } from '../input/resolve.js'
import { runAudit } from '../runner.js'

const auditSchema = {
  body: Type.Object({ url: Type.String({ format: 'uri', maxLength: 2048 }) }),
  response: {
    200: Type.Object({ url: Type.String(), finalUrl: Type.String(), id: Type.String() }),
    400: Type.Object({ error: Type.String() }),
    502: Type.Object({ error: Type.String() })
  }
}

const getAuditSchema = {
  params: Type.Object({ id: Type.String() }),
  response: {
    200: Type.Object({
      id: Type.String(),
      url: Type.String(),
      created_at: Type.String(),
      deleted_at: Type.Union([Type.String(), Type.Null()]),
      result: Type.Unknown()
    }),
    404: Type.Object({ error: Type.String() })
  }
}

export const routes: FastifyPluginAsyncTypebox = async (fastify) => {
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

  fastify.post('/audits', { schema: auditSchema }, async (request, reply) => {
    let normalized: ReturnType<typeof normalize>

    try {
      normalized = normalize(request.body.url)
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }

    const [page] = await runAudit([normalized.url], {
      onProgress: (done, total) => {
        request.log.info({ done, total }, 'audit progress')
      }
    })

    const id = await saveAudit(fastify.db, normalized.url, {
      finalUrl: page.finalUrl,
      status: page.status,
      result: page
    })

    return reply.code(200).send({
      url: request.body.url,
      finalUrl: page.finalUrl,
      id
    })
  })
}
