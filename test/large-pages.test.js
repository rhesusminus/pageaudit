import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evidence } from '../src/checks/evidence.js'
import { checkA11y } from '../src/checks/page/a11y.js'
import { checkHeadings } from '../src/checks/page/headings.js'
import { checkImages } from '../src/checks/page/images.js'
import { checkLinks } from '../src/checks/page/links.js'
import { snippet } from '../src/checks/snippet.js'
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

// Each run gets a page of its own, so nothing a check keeps per page carries over to the next run. The page is
// prepared before the clock starts: parsed for a check, kept as text when parsing itself is measured.
function timed(check, html, prepare) {
  const input = prepare(html)
  const start = cpuMs()
  check(input)
  return cpuMs() - start
}

// The fastest time of each of two pages, after one warm-up run of each. The pages take turns.
function fastestTimes(check, first, second, prepare) {
  timed(check, first, prepare)
  timed(check, second, prepare)
  const runs = Array.from({ length: RUNS }, () => [timed(check, first, prepare), timed(check, second, prepare)])
  return [Math.min(...runs.map(([time]) => time)), Math.min(...runs.map(([, time]) => time))]
}

function assertLinear(check, n, page) {
  const [small, large] = fastestTimes(check, page(n), page(4 * n), parse)
  const ratio = large / small
  assert.ok(
    ratio < MAX_RATIO,
    `4 times the page took ${ratio.toFixed(1)} times as long (${small.toFixed(1)} ms, ${large.toFixed(1)} ms)`
  )
}

// Parsing takes about as long however deeply the same elements nest. Comparing sizes does not work here: a deep tree
// costs a little more per element even when parsing it is linear, so 4 times the depth measured over 6 times as long.
// A deep page against a flat page with as many elements measures up to about 1.7, and twice that under load, while
// work in the square of the depth makes the deep page 10 or more times slower.
const MAX_DEPTH_RATIO = 4

function assertDepthFree(n) {
  const flatPage = '<div>x</div>'.repeat(n)
  const deepPage = `${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`
  const [flat, deep] = fastestTimes(parse, flatPage, deepPage, (html) => html)
  const ratio = deep / flat
  assert.ok(
    ratio < MAX_DEPTH_RATIO,
    `${n} nested elements took ${ratio.toFixed(1)} times as long as ${n} flat ones (${flat.toFixed(1)} ms, ${deep.toFixed(1)} ms)`
  )
}

const repeat = (count, part) => Array.from({ length: count }, (_, i) => part(i)).join('')

test('large pages: deeply nested elements are parsed in one pass', () => {
  // parse5 before 8.1.1 searched its stack of open elements for each new element, so parsing took time in the square of
  // the nesting depth. cheerio still asks for parse5 7, and package.json overrides it.
  assertDepthFree(20000)
})

test('large pages: labelled fields are matched to their labels in one pass', () => {
  assertLinear(checkA11y, 1250, (n) => repeat(n, () => '<label><input type="checkbox"> x</label>'))
  assertLinear(checkA11y, 3000, (n) => repeat(n, (i) => `<label for="f${i}">x</label><input id="f${i}">`))
})

test('large pages: evidence for sibling fields counts the siblings once', () => {
  assertLinear(checkA11y, 4000, (n) => repeat(n, () => '<input>'))
})

test('large pages: aria-labelledby references are each looked up once', () => {
  assertLinear(checkLinks, 3000, (n) =>
    repeat(n, (i) => `<span id="l${i}">Item</span><a href="/${i}" aria-labelledby="l${i}"></a>`)
  )
})

test('large pages: a large element that many aria-labelledby point at is read once', () => {
  // Each field has an id, so the selector in the evidence for a nameless field is that id and only names are measured.
  const fields = (n) => repeat(n, (i) => `<input id="f${i}" aria-labelledby="l">`)
  assertLinear(checkA11y, 3000, (n) => `<div id="l">${repeat(n, () => '<b>word</b>')}</div>${fields(n)}`)
  // An empty target leaves the fields without a name, so the check also looks for a name set by script.
  assertLinear(checkA11y, 1500, (n) => `<div id="l">${repeat(n, () => '<b></b>')}</div>${fields(n)}`)
})

test('large pages: a long name that many links share is judged once for generic wording', () => {
  assertLinear(
    checkLinks,
    6000,
    (n) => `<div id="l">${'!'.repeat(25 * n)}</div>${repeat(n, () => '<a href="/" aria-labelledby="l"></a>')}`
  )
})

test('large pages: a link holding many decorative images is judged once', () => {
  assertLinear(
    checkImages,
    1000,
    (n) => `<a href="/">${repeat(n, () => '<img src="/a.png" alt="" width="1" height="1">')}</a>`
  )
})

test('large pages: nested elements with issues serialize only the start of their markup', () => {
  // Each heading has a context and evidence. The page grows in depth and in content together, since depth is capped.
  const contextOfHeadings = ($) => $('h2').each((_, el) => void [snippet($, el), evidence($, el)])
  assertLinear(
    contextOfHeadings,
    60,
    (n) => `${'<h2><span>'.repeat(n)}${'<i>word</i>'.repeat(20 * n)}${'</span></h2>'.repeat(n)}`
  )
})

test('large pages: a heading holding many images is judged once', () => {
  assertLinear(checkHeadings, 5000, (n) => `<h1>Title</h1><h2>${repeat(n, () => '<img src="/a.png" alt="">')}</h2>`)
})

test('large pages: nested headings do not each look through everything inside them', () => {
  // At 4 times the size the headings nest 240 deep, two elements each, below the depth parse() caps the page at.
  assertLinear(
    checkHeadings,
    3000,
    (n) => `<h1>Title</h1>${'<h2><span>'.repeat(n / 50)}${'<i></i>'.repeat(n)}${'</span></h2>'.repeat(n / 50)}`
  )
})

test('large pages: nested headings show only the start of their text in an issue', () => {
  // At 4 times the size the headings nest 120 deep for skipped levels and 240 deep for h1s, below the depth cap. An id
  // keeps each selector short: a path through every heading above would grow with the depth on its own.
  const words = (n) => repeat(n, () => '<i>word</i>')
  const open = (n) => repeat(n / 100, (i) => `<h2><span><h4 id="h${i}"><span>`)
  const skipped = (n) => `<h1>Title</h1>${open(n)}${words(n)}${'</span></h4></span></h2>'.repeat(n / 100)}`
  assertLinear(checkHeadings, 3000, skipped)
  const h1s = (n) => `${repeat(n / 50, (i) => `<h1 id="t${i}"><span>`)}${words(n)}${'</span></h1>'.repeat(n / 50)}`
  assertLinear(checkHeadings, 3000, h1s)
})
