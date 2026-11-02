import { test } from 'node:test'

// Throwaway probe for the /pr skill.
test('probe: report file names are timestamped', (t) => {
  const stem = 'host-2026-11-02-1200'

  t.assert.match(stem, /^host-\d{4}-\d{2}-\d{2}-\d{4}$/)
})
