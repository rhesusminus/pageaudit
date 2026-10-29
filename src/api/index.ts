import fastify from 'fastify'
import { routes } from './routes.ts'

const server = fastify({ logger: true })

server.register(routes)

server.get('/ping', async () => {
  return 'pong\n'
})

server.listen({ port: 8080 }, (err, address) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Server listening at ${address}`)
})
