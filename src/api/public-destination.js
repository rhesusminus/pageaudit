import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent } from 'undici'
import { fetchPage } from '../fetch.js'
import { loadRobots } from '../robots.js'

// An audit destination the API refuses, with the HTTP status the refusal should answer with. `reason` says why, so a
// caller can word it for its own readers: 'invalid' (not a web address), 'too-long' (longer than MAX_ADDRESS_LENGTH),
// 'private' (not a public address), 'unknown-host' (the name has no addresses) or 'lookup-failed' (the lookup failed in
// a way that may pass on retry).
// `host` is the name that was looked up, for the two lookup reasons.
export class DestinationError extends Error {
  /**
   * @param {string} message
   * @param {{ reason: 'invalid' | 'too-long' | 'private' | 'unknown-host' | 'lookup-failed', host?: string | null,
   *   statusCode?: 400 | 503, cause?: unknown }} options
   */
  constructor(message, { reason, host = null, statusCode = 400, cause }) {
    super(message, { cause })
    this.name = 'DestinationError'
    this.reason = reason
    this.host = host
    this.statusCode = statusCode
  }
}

// The longest address an audit is queued for, counted both as it was given and as it is fetched. The API schema and
// the form field take their limits from here too, so the API and the web form refuse the same addresses.
export const MAX_ADDRESS_LENGTH = 2048

const blocked = () =>
  new DestinationError('Audit destinations must use public network addresses', { reason: 'private' })

const unsupported = () =>
  new DestinationError('Audit destinations must be http or https addresses without a user name or password', {
    reason: 'invalid'
  })

// These codes mean the name has no addresses. Any other lookup failure (EAI_AGAIN, a timeout) may pass on retry.
const NO_ADDRESSES = new Set(['ENOTFOUND', 'ENODATA'])

async function lookupAll(hostname) {
  try {
    return await dns.lookup(hostname, { all: true, verbatim: true })
  } catch (error) {
    if (NO_ADDRESSES.has(error.code)) {
      throw new DestinationError(`Could not resolve host ${hostname}`, {
        reason: 'unknown-host',
        host: hostname,
        cause: error
      })
    }
    throw new DestinationError(`Could not resolve host ${hostname}, try again later`, {
      reason: 'lookup-failed',
      host: hostname,
      statusCode: 503,
      cause: error
    })
  }
}

function publicAddress(address) {
  // Reject mapped IPv4, transition mechanisms, link-local, private and special-use ranges too.
  if (!isIP(address)) return false
  const parsed = ipaddr.parse(address)
  return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3))
}

// localhost and its subdomains are this machine by definition, whatever DNS says.
export const isLocalhostName = (hostname) => /^(localhost|.*\.localhost)\.?$/i.test(hostname)

const resolve = async (hostname) =>
  isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupAll(hostname)

async function publicAddresses(hostname) {
  const addresses = await resolve(hostname)
  // Reject mixed public/private answers rather than relying on which address the OS chooses.
  if (addresses.length === 0 || addresses.some(({ address }) => !publicAddress(address))) throw blocked()
  return addresses
}

// With `allowPrivate`, for a server on someone's own machine, any address passes, such as a development site on
// localhost. The name is still looked up, so an address no site answers at is refused here rather than queued.
export async function validateDestination(value, { allowPrivate = false } = {}) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw unsupported()
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (allowPrivate) {
    await resolve(hostname)
    return
  }
  if (isLocalhostName(hostname)) throw blocked()
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

// The request options that keep every hop of a request on public addresses: each hop is checked before it is
// requested, and the socket connects only to the checked answers. `options.beforeHop` still runs first.
const publicOnly = (options) => ({
  ...options,
  dispatcher,
  beforeHop: async (destination) => {
    await options.beforeHop?.(destination)
    await validateDestination(destination)
  }
})

// API-only policy: local development sites remain available to the CLI.
export const fetchPublicPage = (url, options = {}) => fetchPage(url, publicOnly(options))

// loadRobots for the API: a public page can name, or redirect its robots.txt to, a private address.
export const loadPublicRobots = (origin, options = {}) => loadRobots(origin, publicOnly(options))
