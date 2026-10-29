import type { FastifyServerOptions } from 'fastify'
import fastify from 'fastify'
import { routes } from './routes.ts'

export function build(opts: FastifyServerOptions = {}) {
  const app = fastify(opts)

  app.register(routes)

  return app
}
