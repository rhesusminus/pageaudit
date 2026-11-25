// queueCheckedAudit(): checks an address and queues it, for the API and the web form alike.
import { type Db, queueAudit } from '../db/database.ts'
import { normalize } from '../input/resolve.js'
import { DestinationError, MAX_ADDRESS_LENGTH, validateDestination } from './public-destination.js'

// The address counts both as it was given, as the API schema and the form field count it, and as it is fetched,
// stored and shown, which encodes a space or a letter such as é as several characters. A fragment counts only as given.
// Characters are UTF-16 units, as the form field's maxlength counts them.
function checkLength(address: string) {
  if (address.length <= MAX_ADDRESS_LENGTH) return
  const message = `Audit destinations must be at most ${MAX_ADDRESS_LENGTH} characters long, as sent and once percent-encoded`
  throw new DestinationError(message, { reason: 'too-long' })
}

// Checks an address the way every caller must, then queues an audit of it and returns its id. Both the JSON API and
// the web pages queue through here, so an address is never accepted by one and refused by the other. An address that
// is refused throws a DestinationError, whose `reason` each caller words for its readers. `allowPrivate` lets a server
// on someone's own machine check private addresses too.
export async function queueCheckedAudit(
  db: Db,
  value: string,
  { allowPrivate = false }: { allowPrivate?: boolean } = {}
) {
  // Before parsing, so an address of any size costs no more than counting it.
  checkLength(value)
  let url: string
  try {
    url = normalize(value).url
  } catch (error) {
    throw new DestinationError((error as Error).message, { reason: 'invalid' })
  }

  checkLength(url)
  await validateDestination(url, { allowPrivate })
  return queueAudit(db, url)
}
