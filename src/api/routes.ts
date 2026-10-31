import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@fastify/type-provider-typebox'
import { titleElement } from '../checks/page/meta.js'
import { fetchPage } from '../fetch.js'
import { normalize } from '../input/resolve.js'
import { parse } from '../parse.js'

const auditSchema = {
  body: Type.Object({ url: Type.String({ format: 'uri', maxLength: 2048 }) }),
  response: {
    200: Type.Object({ url: Type.String(), finalUrl: Type.String(), status: Type.Integer() }),
    400: Type.Object({ error: Type.String() }),
    502: Type.Object({ error: Type.String() })
  }
}

export const routes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post('/audits', { schema: auditSchema }, async (request, reply) => {
    let normalized: ReturnType<typeof normalize>
    let fetched: Awaited<ReturnType<typeof fetchPage>>

    try {
      normalized = normalize(request.body.url)
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message })
    }

    try {
      fetched = await fetchPage(normalized.url)
      request.log.info({ url: normalized.url, finalUrl: fetched.finalUrl, status: fetched.status }, 'page fetched')
    } catch (error) {
      request.log.error({ err: error, url: request.body.url }, 'fetch failed')
      return reply.code(502).send({ error: 'Could not fetch page' })
    }

    const $ = parse(fetched.html ?? '')
    const title = titleElement($).text().trim()

    return reply.code(200).send({
      url: request.body.url,
      finalUrl: fetched.finalUrl,
      status: fetched.status
    })
  })
}
