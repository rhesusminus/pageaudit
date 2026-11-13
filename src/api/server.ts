import { build } from './app.ts'

const server = build({ logger: true }, { publicUrl: process.env.PUBLIC_URL || undefined })

server.listen({ port: Number(process.env.PORT ?? 8080) }, (err, address) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Server listening at ${address}`)
})
