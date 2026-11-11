import type { FastifyInstance } from 'fastify'
import { queueAudit } from '../db/database.ts'
import { normalize } from '../input/resolve.js'
import { DestinationError, validateDestination } from './public-destination.js'

type Reason = 'invalid' | 'private' | 'unknown-host' | 'lookup-failed'
type AuditUrlErrorOptions = { reason: Reason; host?: string | null; statusCode?: 400 | 503 }

// An address the API will not audit. `reason` says why (malformed, or which refusal), so each caller can word it for
// its readers. `host` is the host name of a well-formed address. statusCode is the HTTP status the refusal answers with.
export class AuditUrlError extends Error {
  reason: Reason
  host: string | null
  statusCode: 400 | 503

  constructor(message: string, { reason, host = null, statusCode = 400 }: AuditUrlErrorOptions) {
    super(message)
    this.name = 'AuditUrlError'
    this.reason = reason
    this.host = host
    this.statusCode = statusCode
  }
}

// Checks an address the way every caller must, then queues an audit of it and returns its id. Both the JSON API and
// the web pages queue through here, so an address is never accepted by one and refused by the other.
export async function queueCheckedAudit(db: FastifyInstance['db'], value: string) {
  let url: string
  try {
    url = normalize(value).url
  } catch (error) {
    throw new AuditUrlError((error as Error).message, { reason: 'invalid' })
  }

  try {
    await validateDestination(url)
  } catch (error) {
    if (!(error instanceof DestinationError)) throw error
    throw new AuditUrlError(error.message, {
      reason: error.reason,
      host: new URL(url).hostname,
      statusCode: error.statusCode as 400 | 503
    })
  }

  return queueAudit(db, url)
}
