import type { FastifyInstance } from 'fastify'
import { normalize } from '../input/resolve.js'

const schema = {
  body: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string' } }
  }
}

export const routes = (fastify: FastifyInstance) => {
  fastify.post<{ Body: { url: string } }>(
    '/audits',
    {
      schema,
      preHandler: async (request, reply) => {
        try {
          normalize(request.body.url)
        } catch (error) {
          return reply.code(400).send({ error: (error as Error).message })
        }
      }
    },
    async () => ({ success: true })
  )
}
