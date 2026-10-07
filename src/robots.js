import robotsParser from 'robots-parser'
import { request } from './fetch.js'

// Google ignores everything after the first 500 KiB of a robots.txt file.
const MAX_BYTES = 500 * 1024

// Google follows at most five redirects for a robots.txt and treats more as no file.
const MAX_REDIRECTS = 5

// robots-parser differs from Google in two rare cases: it does not treat unreserved percent escapes as equal to
// the character (/%7Ex and /~x are different) and "User-agent: Googlebot*" does not match Googlebot.

// Reads and parses the robots.txt of an origin, the way Google treats the answer:
// 200 is parsed, any other 4xx than 429 means there is no file and everything is allowed,
// 5xx and 429 mean it is temporarily unreachable. A network failure returns null, the pages
// fetched from that host report it themselves.
export async function loadRobots(origin, { timeout } = {}) {
  const url = `${origin}/robots.txt`
  let res
  try {
    res = await request(url, { timeout, maxRedirects: MAX_REDIRECTS, accept: 'text/plain, */*;q=0.8' })
  } catch (err) {
    return err.tooManyRedirects ? { status: 'missing' } : null
  }
  if (res.status === 200) {
    try {
      const text = new TextDecoder().decode((await res.bytes()).subarray(0, MAX_BYTES))
      return { status: 'ok', parser: robotsParser(url, text) }
    } catch {
      return null
    }
  }
  await res.discard()
  if (res.status >= 500 || res.status === 429) return { status: 'unreachable', code: res.status }
  return { status: 'missing' }
}
