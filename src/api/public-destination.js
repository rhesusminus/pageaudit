import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent } from 'undici'
import { fetchPage } from '../fetch.js'

// An audit destination the API refuses, with the HTTP status the refusal should answer with.
export class DestinationError extends Error {
  constructor(message, statusCode = 400, options) {
    super(message, options)
    this.name = 'DestinationError'
    this.statusCode = statusCode
  }
}

const blocked = () => new DestinationError('Audit destinations must use public network addresses')

// These codes mean the name has no addresses. Any other lookup failure (EAI_AGAIN, a timeout) may pass on retry.
const NO_ADDRESSES = new Set(['ENOTFOUND', 'ENODATA'])

async function lookupAll(hostname) {
  try {
    return await dns.lookup(hostname, { all: true, verbatim: true })
  } catch (error) {
    if (NO_ADDRESSES.has(error.code)) {
      throw new DestinationError(`Could not resolve host ${hostname}`, 400, { cause: error })
    }
    throw new DestinationError(`Could not resolve host ${hostname}, try again later`, 503, { cause: error })
  }
}

function publicAddress(address) {
  // Reject mapped IPv4, transition mechanisms, link-local, private and special-use ranges too.
  if (!isIP(address)) return false
  const parsed = ipaddr.parse(address)
  return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3))
}

async function publicAddresses(hostname) {
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupAll(hostname)
  // Reject mixed public/private answers rather than relying on which address the OS chooses.
  if (addresses.length === 0 || addresses.some(({ address }) => !publicAddress(address))) throw blocked()
  return addresses
}

export async function validateDestination(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw blocked()
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.localhost)\.?$/i.test(hostname)) throw blocked()
  await publicAddresses(hostname)
}

// The socket uses exactly the checked answers. Never let fetch perform a second, unchecked DNS lookup.
export function publicLookup(hostname, options, callback) {
  publicAddresses(hostname).then((addresses) => {
    const candidates = options.family ? addresses.filter(({ family }) => family === options.family) : addresses
    if (candidates.length === 0) return callback(blocked())
    if (options.all) return callback(null, candidates)
    callback(null, candidates[0].address, candidates[0].family)
  }, callback)
}

const dispatcher = new Agent({ connect: { lookup: publicLookup } })

// API-only policy: local development sites remain available to the CLI.
export function fetchPublicPage(url, options = {}) {
  return fetchPage(url, {
    ...options,
    dispatcher,
    beforeHop: async (destination) => {
      await options.beforeHop?.(destination)
      await validateDestination(destination)
    }
  })
}
