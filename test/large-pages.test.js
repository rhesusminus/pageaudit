import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkLinks } from '../src/checks/page/links.js'
import { parse } from '../src/parse.js'

// Work over page-sized input stays linear. A check runs on a page of size n and of size 4n: a linear check takes about
// 4 times as long, one that rescans the page for each element about 16 times. Comparing the two on one machine does not
// depend on how fast that machine is. After one warm-up run the sizes take turns, so both see the same load from other
// work, and the fastest run of each counts.
const RUNS = 5
const MAX_RATIO = 8

// CPU time of this thread. Unlike a clock, it leaves out the time other processes have the CPU, and garbage collection
// and compiling on background threads.
const cpuMs = () => {
  const { user, system } = process.threadCpuUsage()
  return (user + system) / 1000
}

// Each run gets a page of its own, so nothing a check keeps per page carries over to the next run.
function timed(check, html) {
  const $ = parse(html)
  const start = cpuMs()
  check($)
  return cpuMs() - start
}

function assertLinear(check, n, page) {
  const [small, large] = [page(n), page(4 * n)]
  timed(check, small)
  const runs = Array.from({ length: RUNS }, () => [timed(check, small), timed(check, large)])
  const fastestSmall = Math.min(...runs.map(([time]) => time))
  const fastestLarge = Math.min(...runs.map(([, time]) => time))
  const ratio = fastestLarge / fastestSmall
  assert.ok(
    ratio < MAX_RATIO,
    `4 times the page took ${ratio.toFixed(1)} times as long (${fastestSmall.toFixed(1)} ms, ${fastestLarge.toFixed(1)} ms)`
  )
}

const repeat = (count, part) => Array.from({ length: count }, (_, i) => part(i)).join('')

test('large pages: aria-labelledby references are each looked up once', () => {
  assertLinear(checkLinks, 3000, (n) =>
    repeat(n, (i) => `<span id="l${i}">Item</span><a href="/${i}" aria-labelledby="l${i}"></a>`)
  )
})
