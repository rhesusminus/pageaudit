import { test } from 'node:test'

// Throwaway probe for the /pr skill: passes on a laptop, fails where CI=true.
test('probe: report file names are timestamped', (t) => {
  const stem = process.env.CI ? 'report' : 'host-2026-11-02-1200'

  t.assert.match(stem, /^host-\d{4}-\d{2}-\d{2}-\d{4}$/)
})
