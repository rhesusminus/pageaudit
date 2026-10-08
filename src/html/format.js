import { markup } from './escape.js'

export const CATEGORY_NAMES = {
  performance: 'Speed',
  accessibility: 'Accessibility',
  'best-practices': 'Best practices',
  seo: 'Search (SEO)'
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Only http(s) addresses become links. Everything audited is one, this is a safety net.
export const link = (url, text = url) =>
  /^https?:\/\//i.test(url) ? markup`<a href="${url}" rel="noopener noreferrer">${text}</a>` : markup`${text}`

export const formatMetric = (key, value) => {
  if (value === null || value === undefined) return 'n/a'
  if (key === 'cls') return String(value)
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  return bytes >= 1024 ? `${Math.round(bytes / 1024)} KiB` : `${bytes} B`
}
