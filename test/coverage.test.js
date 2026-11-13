import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCoverage, orphansSkipped } from '../src/coverage.js'

const options = (extra = {}) => ({ sitemaps: [], lighthousePages: [], ...extra })
const inputs = (extra = {}) => ({ urls: ['https://a.test/'], total: 1, marked: [], sitemapsComplete: true, ...extra })
const links = (extra = {}) => ({ outcomes: new Map(), checked: 4, unchecked: 0, unread: 0, ...extra })

test('buildCoverage: Lighthouse runs count once it ran, for every page or picked ones', () => {
  const all = buildCoverage(options({ lighthouse: true, lighthouseRuns: 3 }), inputs(), { lighthouseRan: true })
  assert.equal(all.settings.lighthouseRuns, 3)
  assert.ok(all.notRun.every((entry) => entry.check !== 'lighthouse'))
  const picked = buildCoverage(options(), inputs({ marked: ['https://a.test/'] }), { lighthouseRan: true })
  assert.deepEqual([picked.settings.lighthouse, picked.settings.lighthousePages], [false, 1])
  assert.equal(picked.settings.lighthouseRuns, 1)
  assert.equal(buildCoverage(options({ lighthouseRuns: 3 }), inputs()).settings.lighthouseRuns, null)
})

test('buildCoverage: Lighthouse asked for but tried on no page is listed as not run', () => {
  const coverage = buildCoverage(options({ lighthouse: true }), inputs())
  assert.equal(coverage.settings.lighthouse, true)
  assert.deepEqual(coverage.notRun, [
    { check: 'lighthouse', reason: 'no page it was asked for returned HTML' },
    { check: 'links', reason: 'not asked for (--check-links)' }
  ])
})

test('buildCoverage: a sitemap given twice is listed once, and the links block only comes with --check-links', () => {
  const sitemap = 'https://a.test/s.xml'
  const coverage = buildCoverage(options({ sitemaps: [sitemap, sitemap] }), inputs(), {
    links: links({ unchecked: 2 })
  })
  assert.deepEqual(coverage.settings.sitemaps, [sitemap])
  assert.deepEqual(coverage.links, { checked: 4, unchecked: 2, complete: false })
  assert.equal(buildCoverage(options(), inputs()).links, undefined)
})

test('orphansSkipped: the link cap is named with the number of targets that were checked', () => {
  const sitemap = options({ sitemaps: ['https://a.test/s.xml'] })
  assert.equal(orphansSkipped(sitemap, inputs(), links()), null)
  assert.equal(
    orphansSkipped(sitemap, inputs(), links({ checked: 500, unchecked: 37 })),
    'checked 500 link targets, 37 linked from fewer pages were not checked'
  )
})
