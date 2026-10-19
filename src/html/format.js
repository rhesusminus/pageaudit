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

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

// A date the page gives, such as 2026-09-15T12:30:00+03:00, as the calendar day it names (15 September 2026). The
// time and zone are dropped rather than converted, so the day is the one the page meant. Anything else is shown as
// written.
export function formatPageDate(value) {
  const match = ISO_DAY.exec(value)
  if (!match) return value
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}
