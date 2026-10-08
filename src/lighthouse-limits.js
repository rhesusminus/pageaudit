// Core Web Vitals and the other Lighthouse metrics: [good up to, poor above]. Lighthouse and web.dev publish
// these limits: a value at or under `good` is good, one above `poor` is poor, and one in between needs improvement.
export const METRIC_BANDS = {
  lcp: { label: 'Largest Contentful Paint', unit: 'ms', good: 2500, poor: 4000 },
  cls: { label: 'Cumulative Layout Shift', unit: '', good: 0.1, poor: 0.25 },
  tbt: { label: 'Total Blocking Time', unit: 'ms', good: 200, poor: 600 },
  fcp: { label: 'First Contentful Paint', unit: 'ms', good: 1800, poor: 3000 },
  speedIndex: { label: 'Speed Index', unit: 'ms', good: 3400, poor: 5800 }
}
