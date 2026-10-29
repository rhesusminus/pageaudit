import type { FastifyInstance } from 'fastify'
import { fetchPage } from '../fetch.js'
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
    async (request, reply) => {
      try {
        const normalized = normalize(request.body.url)
        const response = await fetchPage(normalized.url)
        request.log.info({ url: normalized.url, finalUrl: response.finalUrl, status: response.status }, 'page fetched')
        reply.code(200).send({
          url: request.body.url,
          finalUrl: response.finalUrl,
          status: response.status
        })
      } catch (error) {
        request.log.error({ err: error, url: request.body.url }, 'fetch failed')
        return reply.code(502).send({ error: 'Could not fetch page' })
      }
    }
  )
}
