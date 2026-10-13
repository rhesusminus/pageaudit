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
// after the previous start on that host. Waiters on a host are let through one at a time, each measured from when
// the one before it actually started. Timers fire late while the event loop is busy, for example checking a large
// page, and booking start times ahead would then let every overdue request start at once.
export function hostThrottle(delay) {
  const hosts = new Map()
  return function wait(url) {
    const key = new URL(url).host
    const host = hosts.get(key) ?? { started: -Infinity, queue: Promise.resolve() }
    hosts.set(key, host)
    host.queue = host.queue.then(async () => {
      // Checked again after every wait, a timer may also fire a moment early.
      for (let left = host.started + delay - Date.now(); left > 0; left = host.started + delay - Date.now()) {
        await timers.setTimeout(left)
      }
      host.started = Date.now()
    })
    return host.queue
  }
}
