// The command line options, for parsing them and for showing the command the wizard makes.
export const OPTIONS = {
  'urls-file': { type: 'string', multiple: true },
  sitemap: { type: 'string', multiple: true },
  limit: { type: 'string' },
  concurrency: { type: 'string' },
  delay: { type: 'string' },
  lighthouse: { type: 'boolean' },
  'lighthouse-page': { type: 'string', multiple: true },
  'lighthouse-runs': { type: 'string' },
  'check-links': { type: 'boolean' },
  out: { type: 'string' },
  html: { type: 'string' },
  title: { type: 'string' },
  client: { type: 'string' },
  logo: { type: 'string' },
  'fail-on': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' }
}
