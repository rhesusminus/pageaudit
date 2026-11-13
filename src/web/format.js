// Small wording helpers shared by the web pages.
import { ABSOLUTE_URL } from '../checks/page/meta.js'
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

// People type addresses without a scheme, so the form assumes https:// when none is given.
export const withScheme = (value) => (ABSOLUTE_URL.test(value) ? value : `https://${value}`)

export const SEVERITY_LABEL = { error: 'Error', warning: 'Warning', info: 'Note' }

// A number and its noun, joined by a no-break space so a line never ends between them ("3 / things").
export const count = (n, one, many = `${one}s`) => `${n.toLocaleString('en')}\u00a0${n === 1 ? one : many}`

// SQLite stores created_at as "YYYY-MM-DD HH:MM:SS" in UTC. The server does not know the reader's time zone, so the
// time is shown in UTC and says so.
const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

export function checkedAt(createdAt) {
  const iso = `${createdAt.replace(' ', 'T')}Z`
  return { iso, text: `${DATE_TIME.format(new Date(iso))} UTC` }
}
