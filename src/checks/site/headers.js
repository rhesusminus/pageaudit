import { SOURCES } from '../../sources.js'
import { truncate } from '../snippet.js'

// Lighthouse only flags uncompressed text when compression would save at least 1.4 KB, so smaller pages pass.
const MIN_COMPRESSIBLE_BYTES = 1400
// A nonce or hash source with a value, such as 'nonce-r4nd0m' or 'sha256-abc='. Sources are lowercased.
// The value is base64 with at most two padding characters, as in the CSP3 grammar.
const NONCE_OR_HASH = /^'(nonce|sha256|sha384|sha512)-[a-z0-9+/_-]+={0,2}'$/
// Where each kind of script finds its sources, most specific directive first (the CSP3 fallback list).
const SCRIPT_DIRECTIVES = {
  elements: ['script-src-elem', 'script-src', 'default-src'],
  attributes: ['script-src-attr', 'script-src', 'default-src'],
  eval: ['script-src', 'default-src']
}
// Framing sources that let any site frame the page: *, a bare scheme (https:), or a wildcard host with any
// scheme, port or path (https://*, https://*:*, *:443).
const ANY_ANCESTOR = /^(\*|[a-z][a-z0-9+.-]*:|([a-z][a-z0-9+.-]*:\/\/)?\*(:(\*|\d+))?(\/.*)?)$/

// A Content-Security-Policy header can carry several policies separated by commas, and repeated headers arrive
// joined the same way. Each policy maps a lowercase directive name to its lowercase sources. The first of a
// repeated directive wins, like in a browser.
export function parseCsp(value) {
  return value.split(',').map((text) => {
    const policy = new Map()
    for (const directive of text.split(';')) {
      const [name, ...sources] = directive.trim().toLowerCase().split(/\s+/)
      if (name && !policy.has(name)) policy.set(name, sources)
    }
    return policy
  })
}

// 'unsafe-inline' is ignored by browsers when a nonce, a hash or 'strict-dynamic' is present.
const allowsInline = (sources) =>
  sources.includes("'unsafe-inline'") && !sources.some((s) => NONCE_OR_HASH.test(s) || s === "'strict-dynamic'")

// Every policy applies, so a script runs only when all policies that govern it allow it. A policy without a
// directive for this kind of script does not govern it, and when none does the kind is not judged, like no CSP.
function allowedByAll(policies, kind, allows) {
  const lists = policies
    .map((policy) => SCRIPT_DIRECTIVES[kind].map((name) => policy.get(name)).find(Boolean))
    .filter(Boolean)
  return lists.length > 0 && lists.every(allows)
}

// What an enforced policy still lets scripts do. A policy that governs no scripts at all, often on purpose
// (frame-ancestors only), is treated like no CSP: not a finding.
export function cspWeaknesses(value) {
  const policies = parseCsp(value)
  const inline = allowedByAll(policies, 'elements', allowsInline) || allowedByAll(policies, 'attributes', allowsInline)
  return [
    inline && "inline scripts ('unsafe-inline' without a nonce or hash)",
    allowedByAll(policies, 'eval', (sources) => sources.includes("'unsafe-eval'")) && "eval ('unsafe-eval')"
  ].filter(Boolean)
}

// The enforced frame-ancestors directives. Browsers ignore X-Frame-Options when there is one, and framing is
// blocked when any of them leaves out sites in general.
function frameAncestors(value) {
  const lists = value
    ? parseCsp(value)
        .map((policy) => policy.get('frame-ancestors'))
        .filter(Boolean)
    : []
  if (lists.length === 0) return null
  const restricted = lists.some((sources) => !sources.some((s) => ANY_ANCESTOR.test(s)))
  return { restricted, directive: `frame-ancestors ${lists[0].join(' ')}` }
}

// Repeated headers arrive joined with commas. Browsers read the first value of these.
const firstValue = (value) => value?.split(',')[0].trim()

// The max-age of the first Strict-Transport-Security header. Undefined when the header is invalid and so
// ignored by browsers: a directive given twice, or a max-age that is not a whole number (RFC 6797 section 6.1).
function hstsMaxAge(value) {
  const directives = firstValue(value)
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)
  const names = directives.map((directive) => directive.split('=')[0].trim().toLowerCase())
  if (new Set(names).size !== names.length) return undefined
  const maxAge = directives[names.indexOf('max-age')]
  return maxAge && /^max-age\s*=\s*(?:(\d+)|"(\d+)")$/i.exec(maxAge)?.slice(1).find(Boolean)
}

function missingHsts({ finalUrl, response }) {
  if (new URL(finalUrl).protocol !== 'https:') return null
  const value = response.headers['strict-transport-security']
  if (value === undefined) {
    return { message: 'No Strict-Transport-Security (HSTS) header', context: 'no Strict-Transport-Security' }
  }
  if (Number(hstsMaxAge(value)) > 0) return null
  return { message: 'Strict-Transport-Security has no max-age above 0, so HSTS is off', context: value }
}

function missingNosniff({ response }) {
  const value = response.headers['x-content-type-options']
  if (firstValue(value)?.toLowerCase() === 'nosniff') return null
  return value === undefined
    ? { message: 'No X-Content-Type-Options: nosniff header', context: 'no X-Content-Type-Options' }
    : { message: 'X-Content-Type-Options is not nosniff, the only value with an effect', context: value }
}

// X-Frame-Options as the HTML standard reads it: DENY or SAMEORIGIN alone block framing, and several different
// values block it when any of them is DENY, SAMEORIGIN or ALLOWALL. Other values are treated like no header.
function frameOptionsBlock(value) {
  if (value === undefined) return false
  const values = new Set(value.split(',').map((part) => part.trim().toLowerCase()))
  if (values.size > 1) return ['deny', 'sameorigin', 'allowall'].some((known) => values.has(known))
  return values.has('deny') || values.has('sameorigin')
}

function missingFrameProtection({ response }) {
  const { headers } = response
  const csp = frameAncestors(headers['content-security-policy'])
  if (csp?.restricted) return null
  if (csp) {
    return {
      message: 'Other sites can frame the page: CSP frame-ancestors allows any site and overrides X-Frame-Options',
      context: csp.directive
    }
  }
  if (frameOptionsBlock(headers['x-frame-options'])) return null
  const reportOnly = frameAncestors(headers['content-security-policy-report-only'])
  return {
    message: reportOnly
      ? 'Other sites can frame the page: frame-ancestors is only in a report-only policy, which blocks nothing'
      : 'Other sites can frame the page: no X-Frame-Options or CSP frame-ancestors',
    context: headers['x-frame-options'] ?? 'no X-Frame-Options'
  }
}

function weakCsp({ response }) {
  const value = response.headers['content-security-policy']
  if (value === undefined) return null
  const weaknesses = cspWeaknesses(value)
  if (weaknesses.length === 0) return null
  return { message: `Content-Security-Policy allows ${weaknesses.join(' and ')}`, context: value }
}

function noCompression({ response }) {
  const encoding = response.headers['content-encoding']?.trim().toLowerCase()
  if (response.bodyBytes < MIN_COMPRESSIBLE_BYTES || (encoding && encoding !== 'identity')) return null
  return { message: 'HTML is sent without compression (gzip or brotli)', context: 'no Content-Encoding' }
}

const security = { severity: 'info', category: 'best-practice', source: SOURCES.securityHeaders }
const RULES = [
  { type: 'missing-hsts', ...security, severity: 'warning', find: missingHsts },
  { type: 'missing-x-content-type-options', ...security, find: missingNosniff },
  { type: 'missing-clickjacking-protection', ...security, find: missingFrameProtection },
  { type: 'weak-csp', ...security, find: weakCsp },
  {
    type: 'no-compression',
    severity: 'info',
    category: 'performance',
    source: SOURCES.textCompression,
    find: noCompression
  }
]

// Response headers of the audited HTML pages. Headers are nearly always set for a whole site, so pages of one
// origin with the same finding are one issue, with the first page's header as the evidence. Pages whose headers are unknown (`response` is null) are skipped.
export function checkResponseHeaders(pages) {
  const groups = new Map()
  for (const page of pages.filter((p) => p.response)) {
    const origin = new URL(page.finalUrl).origin
    for (const rule of RULES) {
      const found = rule.find(page)
      if (!found) continue
      // The message, not the header value, decides the group: a nonce changes the header on every response.
      const key = JSON.stringify([rule.type, origin, found.message])
      if (!groups.has(key)) groups.set(key, { rule, origin, ...found, urls: [] })
      groups.get(key).urls.push(page.url)
    }
  }
  return [...groups.values()].map(({ rule: { type, severity, category, source }, origin, message, context, urls }) => ({
    type,
    severity,
    category,
    source,
    message,
    context: truncate(`${origin}: ${context}`),
    urls
  }))
}
