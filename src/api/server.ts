import { build } from './app.ts'

const server = build({ logger: true }, { publicUrl: process.env.PUBLIC_URL || undefined })

// Fastify logs each address it listens at, so only a failure is logged here.
server.listen({ port: Number(process.env.PORT ?? 8080) }, (err) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
})
