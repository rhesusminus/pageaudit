import { build } from './app.ts'

const server = build({ logger: true })

server.listen({ port: 8080 }, (err, address) => {
  if (err) {
    server.log.error(err)
    process.exit(1)
  }
  server.log.info(`Server listening at ${address}`)
})
