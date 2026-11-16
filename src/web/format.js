// Small wording helpers shared by the web pages.
import { isIP } from 'node:net'
import { isLocalhostName } from '../api/public-destination.js'
import { ABSOLUTE_URL } from '../checks/page/meta.js'
import { isoTime } from '../db/database.ts'
import { markup } from '../html/escape.js'
import { charCount } from '../text.js'

// An address as people read it: no scheme, no trailing slash.
export const shortAddress = (url) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '')

// Past this many characters an address is set smaller in a heading, so it does not fill a phone screen.
const LONG_ADDRESS = 40

// An address for a heading that may wrap. Each part between slashes is kept whole where it fits, and a line breaks
// before a slash, rather than at a hyphen inside a part ("/en-" / "US").
export function addressHeading(url) {
  const address = shortAddress(url)
  const [host, ...path] = address.split('/')
  return {
    long: charCount(address) > LONG_ADDRESS,
    text: markup`<span class="part">${host}</span>${path.map((part) => markup`<wbr><span class="part">/${part}</span>`)}`
  }
}

// People type addresses without a scheme, so the form assumes https:// when none is given. A development server on
// localhost or an IP address rarely has TLS, so it gets http://, as browsers do for localhost.
export function withScheme(value) {
  if (ABSOLUTE_URL.test(value)) return value
  return `${localHost(value) ? 'http' : 'https'}://${value}`
}

function localHost(value) {
  let hostname
  try {
    hostname = new URL(`http://${value}`).hostname
  } catch {
    return false
  }
  return isLocalhostName(hostname) || isIP(hostname.replace(/^\[|\]$/g, '')) !== 0
}

export const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Note' }

// A number and its noun, joined by a no-break space so a line never ends between them ("3 / things").
export const count = (n, one, many = `${one}s`) => `${n.toLocaleString('en')}\u00a0${n === 1 ? one : many}`

// created_at is in UTC. The server does not know the reader's time zone, so the time is shown in UTC and says so.
const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

export function checkedAt(createdAt) {
  const iso = isoTime(createdAt)
  return { iso, text: `${DATE_TIME.format(new Date(iso))} UTC` }
}
