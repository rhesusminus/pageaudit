import dns from 'node:dns/promises'
import { isIP } from 'node:net'
import ipaddr from 'ipaddr.js'
import { Agent } from 'undici'
import { fetchPage } from '../fetch.js'

const blocked = () => new Error('Audit destinations must use public network addresses')

function publicAddress(address) {
  // Reject mapped IPv4, transition mechanisms, link-local, private and special-use ranges too.
  if (!isIP(address)) return false
  const parsed = ipaddr.parse(address)
  return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3))
}

async function publicAddresses(hostname) {
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await dns.lookup(hostname, { all: true, verbatim: true })
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
