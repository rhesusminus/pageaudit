import type { FastifyServerOptions } from 'fastify'
import fastify from 'fastify'
import { routes } from './routes.ts'

const opts: FastifyServerOptions = {
  logger: true
}

const server = fastify(opts)

server.register(routes)

server.listen({ port: 8080 }, (err, address) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Server listening at ${address}`)
})
