// Audited pages and site issues shared by the JSON report and terminal tests.

export const issue = (severity, category, message, context) => ({ type: 't', severity, category, message, context })

export const page = (url, severities, fields = {}) => ({
  url,
  finalUrl: url,
  status: 200,
  redirects: [],
  issues: severities.map((severity) => ({ url, ...issue(severity, 'seo', `A ${severity}`, '<x>') })),
  facts: { title: 'T', description: null, h1s: [], hreflang: [] },
  ...fields
})

export const pages = [
  page('https://a.test/clean', []),
  page('https://a.test/warn', ['warning', 'warning', 'info']),
  page('https://a.test/down', ['error'], { status: null }),
  page('https://a.test/also-clean', []),
  page('https://a.test/mixed', ['error', 'warning'])
]

export const site = [
  {
    type: 'duplicate-title',
    severity: 'warning',
    category: 'seo',
    message: 'Same title on 2 pages',
    context: '<title>T</title>',
    urls: ['https://a.test/warn', `https://a.test/${'long-path/'.repeat(8)}`]
  }
]

export const auditLine = (id, extra = {}) => ({
  id,
  category: 'seo',
  title: id,
  score: 0,
  displayValue: null,
  ...extra
})

export const lhBlock = (audits, extra = {}) => ({ scores: { seo: 50 }, metrics: {}, audits, warnings: [], ...extra })
