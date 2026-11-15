import type { FastifyInstance } from 'fastify'
import { queueAudit } from '../db/database.ts'
import { normalize } from '../input/resolve.js'
import { DestinationError, validateDestination } from './public-destination.js'

// Checks an address the way every caller must, then queues an audit of it and returns its id. Both the JSON API and
// the web pages queue through here, so an address is never accepted by one and refused by the other. An address that
// is refused throws a DestinationError, whose `reason` each caller words for its readers.
export async function queueCheckedAudit(db: FastifyInstance['db'], value: string) {
  let url: string
  try {
    url = normalize(value).url
  } catch (error) {
    throw new DestinationError((error as Error).message, { reason: 'invalid' })
  }

  await validateDestination(url)
  return queueAudit(db, url)
}
