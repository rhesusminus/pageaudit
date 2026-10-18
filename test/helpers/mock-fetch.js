// Replaces globalThis.fetch with `implementation` for the rest of the test. A second call in the same test changes
// the implementation of the mock already in place: mocking fetch again would wrap the first mock, and restoring both
// at the end of the test would leave the first one in place for every test after it.
export function mockFetch(t, implementation) {
  if (!globalThis.fetch.mock) return t.mock.method(globalThis, 'fetch', implementation)
  globalThis.fetch.mock.mockImplementation(implementation)
  return globalThis.fetch
}
