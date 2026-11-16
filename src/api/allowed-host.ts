import { isIP } from 'node:net'
import type { FastifyRequest } from 'fastify'
import { isLocalhostName } from './public-destination.js'

// Whether `host`, the Host header of a request, names this server. The server runs on someone's own machine, and a
// site they visit can point its own name at that machine (DNS rebinding). The browser then counts this server as part
// of that site, lets its scripts read the answers and sends its forms as same-origin. It still sends the site's own
// name in Host, so the server answers only to names nobody else can point here: localhost and its subdomains, IP
// addresses, and the host of PUBLIC_URL. The port is not compared: rebinding changes the name and keeps the port, and
// a proxy or port forward may reach the server on another port than the one it listens on.
// The Host header as the client sent it. Fastify's request.host reads X-Forwarded-Host instead when trustProxy is on,
// and a script on a page this server answers for may set that header to anything, such as localhost. Host itself is
// set by the browser from the address of the page, and no script can change it.
export const sentHost = (request: FastifyRequest) => request.headers.host ?? ''

export function answersTo(host: string, publicHostname?: string) {
  // Parsed as a browser parses the host of an address, so case and IP spellings compare as they do there.
  const hostname = URL.parse(`http://${host}`)?.hostname
  if (!hostname) return false
  return isLocalhostName(hostname) || isIP(hostname.replace(/^\[|\]$/g, '')) !== 0 || hostname === publicHostname
}
