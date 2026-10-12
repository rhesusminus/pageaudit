// Called through the module object, so the test runner's mocked timers replace it.
import timers from 'node:timers/promises'

// Runs fn over the items, at most `limit` at a time. The results keep the order of the items.
export async function mapLimited(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Spaces out requests per host: wait(url) resolves when a request to that URL's host may start, at least `delay` ms
// after the previous start on that host.
export function hostThrottle(delay) {
  const nextStart = new Map()
  return async function wait(url) {
    const host = new URL(url).host
    const now = Date.now()
    const start = Math.max(now, nextStart.get(host) ?? 0)
    nextStart.set(host, start + delay)
    if (start > now) await timers.setTimeout(start - now)
  }
}
