import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { extractSignals } from '../src/checks/page/signals.js'
import { parse } from '../src/parse.js'

const load = async (name) => parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const PAGE = 'https://fixtures.test/rich.html'
const BASE = 'https://fixtures.test/shop/'

test('signals: rich page', async () => {
  const signals = extractSignals(await load('rich.html'), BASE, PAGE)
  assert.equal(signals.lang, 'fi-FI')
  assert.equal(signals.viewport, 'width=device-width, initial-scale=1')
  assert.equal(signals.robots, 'index, follow')
  assert.equal(signals.twitterCard, 'summary_large_image')
  assert.deepEqual(signals.openGraph, {
    title: 'Rich OG title',
    description: null,
    image: 'https://fixtures.test/og.png',
    type: null,
    url: null
  })
  assert.deepEqual(signals.headings, [{ level: 1, text: 'Rich page' }])
})

test('signals: word count ignores scripts, links count by site and skip non-pages', async () => {
  const signals = extractSignals(await load('rich.html'), BASE, PAGE)
  // 2 (h1) + 4 (paragraph) + 10 in the link texts. The script text does not count.
  assert.ok(!JSON.stringify(signals).includes('ignored'))
  assert.equal(signals.wordCount, 16)
  assert.deepEqual(signals.links, { internal: 2, external: 1, nofollow: 1 })
  assert.deepEqual(signals.images, { total: 3, missingAlt: 1 })
})

test('signals: JSON-LD types come from @graph and arrays, and invalid JSON is ignored', async () => {
  const signals = extractSignals(await load('rich.html'), BASE, PAGE)
  assert.deepEqual(signals.jsonLdTypes, ['Organization', 'Product', 'Thing'])
})

test('signals: a bare page gives nulls, zeros and empty lists', () => {
  const signals = extractSignals(parse('<p>hi</p>'), PAGE, PAGE)
  assert.equal(signals.lang, null)
  assert.deepEqual(signals.headings, [])
  assert.equal(signals.wordCount, 1)
  assert.deepEqual(signals.links, { internal: 0, external: 0, nofollow: 0 })
  assert.deepEqual(signals.jsonLdTypes, [])
})

test('signals: headings are capped and long text is truncated', () => {
  const html = `<h2>${'x'.repeat(300)}</h2>${'<h3>a</h3>'.repeat(60)}`
  const { headings } = extractSignals(parse(html), PAGE, PAGE)
  assert.equal(headings.length, 40)
  assert.equal(Array.from(headings[0].text).length, 120)
})
