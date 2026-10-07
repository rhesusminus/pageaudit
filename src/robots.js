import robotsParser from 'robots-parser'
import { request } from './fetch.js'

// Google ignores everything after the first 500 KiB of a robots.txt file.
const MAX_BYTES = 500 * 1024

// Reads and parses the robots.txt of an origin, the way Google treats the answer:
// 200 is parsed, any other 4xx than 429 means there is no file and everything is allowed,
// 5xx and 429 mean it is temporarily unreachable. A network failure returns null, the pages
// fetched from that host report it themselves.
export async function loadRobots(origin, { timeout } = {}) {
  const url = `${origin}/robots.txt`
  let res
  try {
    res = await request(url, { timeout, accept: 'text/plain, */*;q=0.8' })
  } catch {
    return null
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
