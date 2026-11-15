import { build } from './app.ts'

const allowPrivateDestinations = process.env.ALLOW_PRIVATE_DESTINATIONS === '1'

const server = build({ logger: true }, { publicUrl: process.env.PUBLIC_URL || undefined, allowPrivateDestinations })

// Fastify logs each address it listens at, so only a failure and the warning are logged here.
server.listen({ port: Number(process.env.PORT ?? 8080) }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  if (allowPrivateDestinations) {
    server.log.warn('ALLOW_PRIVATE_DESTINATIONS is set: audits can reach this machine and its private network')
  }
})
