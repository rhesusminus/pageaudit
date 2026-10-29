import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkResponseHeaders, cspWeaknesses, parseCsp } from '../src/checks/site/headers.js'

const SECURE = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN'
}

// An audited HTML page with the given headers, replacing the secure defaults. undefined leaves a header out.
const page = (url, headers = {}, { finalUrl = url, bodyBytes = 900 } = {}) => ({
  url,
  finalUrl,
  status: 200,
  response: {
    headers: Object.fromEntries(Object.entries({ ...SECURE, ...headers }).filter(([, value]) => value !== undefined)),
    bodyBytes
  }
})

const brief = (issues) => issues.map(({ type, context, urls }) => [type, context, urls])

test('csp: policies split on commas, directives on semicolons, and the first repeated directive wins', () => {
  const [first, second] = parseCsp("default-src 'self'; Script-Src 'self' 'NONCE-abc'; script-src *, img-src https:")
  assert.deepEqual(first.get('script-src'), ["'self'", "'nonce-abc'"])
  assert.deepEqual(first.get('default-src'), ["'self'"])
  assert.deepEqual([...second.keys()], ['img-src'])
})

test('csp: unsafe-inline only counts without a nonce, hash or strict-dynamic, and script-src falls back to default-src', () => {
  assert.deepEqual(cspWeaknesses("script-src 'self' 'unsafe-inline'"), [
    "inline scripts ('unsafe-inline' without a nonce or hash)"
  ])
  assert.deepEqual(cspWeaknesses("default-src 'self' 'unsafe-inline' 'unsafe-eval'"), [
    "inline scripts ('unsafe-inline' without a nonce or hash)",
    "eval ('unsafe-eval')"
  ])
  for (const strict of ["'nonce-r4nd0m'", "'sha256-abc='", "'strict-dynamic'"]) {
    assert.deepEqual(cspWeaknesses(`script-src 'unsafe-inline' ${strict}`), [], strict)
  }
  assert.deepEqual(cspWeaknesses("default-src 'self'"), [])
})

test('csp: a policy that does not govern scripts, such as frame-ancestors alone, is not judged', () => {
  assert.deepEqual(cspWeaknesses("frame-ancestors 'none'; upgrade-insecure-requests"), [])
})

test('csp: with several policies a weakness counts only when every policy has it', () => {
  assert.deepEqual(cspWeaknesses("script-src 'unsafe-inline', script-src 'self'"), [])
  assert.deepEqual(cspWeaknesses("script-src 'unsafe-eval', default-src 'unsafe-eval' 'self'"), [
    "eval ('unsafe-eval')"
  ])
  assert.deepEqual(cspWeaknesses("frame-ancestors 'none', script-src 'self'"), [])
})

test('headers: a page with the recommended headers has no issues', () => {
  assert.deepEqual(checkResponseHeaders([page('https://a.test/')]), [])
})

test('headers: pages whose headers are unknown or that returned no HTML are skipped', () => {
  const unknown = { url: 'https://a.test/', finalUrl: 'https://a.test/', status: 200, response: null }
  assert.deepEqual(checkResponseHeaders([unknown]), [])
})

test('headers: missing HSTS is a warning on https only, and max-age=0 counts as off', () => {
  const issues = checkResponseHeaders([
    page('https://a.test/', { 'strict-transport-security': undefined }),
    page('http://b.test/', { 'strict-transport-security': undefined }),
    page('https://c.test/', { 'strict-transport-security': 'max-age=0' })
  ])
  assert.deepEqual(brief(issues), [
    ['missing-hsts', 'https://a.test: no Strict-Transport-Security', ['https://a.test/']],
    ['missing-hsts', 'https://c.test: max-age=0', ['https://c.test/']]
  ])
  assert.ok(issues.every((issue) => issue.severity === 'warning' && issue.category === 'best-practice'))
})

test('headers: nosniff is required as the exact value', () => {
  const issues = checkResponseHeaders([
    page('https://a.test/', { 'x-content-type-options': undefined }),
    page('https://b.test/', { 'x-content-type-options': ' NoSniff ' }),
    page('https://c.test/', { 'x-content-type-options': 'sniff' })
  ])
  assert.deepEqual(brief(issues), [
    ['missing-x-content-type-options', 'https://a.test: no X-Content-Type-Options', ['https://a.test/']],
    ['missing-x-content-type-options', 'https://c.test: sniff', ['https://c.test/']]
  ])
})

test('headers: frame-ancestors in an enforced policy protects, one in a report-only policy does not', () => {
  const issues = checkResponseHeaders([
    page('https://a.test/', { 'x-frame-options': undefined, 'content-security-policy': "frame-ancestors 'self'" }),
    page('https://b.test/', { 'x-frame-options': 'ALLOW-FROM https://x.test' }),
    page('https://c.test/', {
      'x-frame-options': undefined,
      'content-security-policy-report-only': "frame-ancestors 'none'"
    })
  ])
  assert.deepEqual(brief(issues), [
    ['missing-clickjacking-protection', 'https://b.test: ALLOW-FROM https://x.test', ['https://b.test/']],
    ['missing-clickjacking-protection', 'https://c.test: no X-Frame-Options', ['https://c.test/']]
  ])
  assert.match(issues[1].message, /report-only policy, which blocks nothing/)
  assert.equal(issues[1].severity, 'info')
})

test('headers: a weak enforced CSP is info, and a missing CSP is not a finding', () => {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'"
  const issues = checkResponseHeaders([
    page('https://a.test/', { 'content-security-policy': csp }),
    page('https://b.test/', { 'content-security-policy-report-only': "script-src 'unsafe-inline'" }),
    page('https://c.test/')
  ])
  assert.deepEqual(brief(issues), [['weak-csp', `https://a.test: ${csp}`, ['https://a.test/']]])
  assert.equal(
    issues[0].message,
    "Content-Security-Policy allows inline scripts ('unsafe-inline' without a nonce or hash)"
  )
})

test('headers: HTML of 1.4 KB or more without compression is a performance info', () => {
  const issues = checkResponseHeaders([
    page('https://a.test/small', {}, { bodyBytes: 1399 }),
    page('https://a.test/big', {}, { bodyBytes: 1400 }),
    page('https://a.test/identity', { 'content-encoding': 'identity' }, { bodyBytes: 5000 }),
    page('https://a.test/gzip', { 'content-encoding': 'gzip' }, { bodyBytes: 5000 }),
    page('https://a.test/br', { 'content-encoding': 'br' }, { bodyBytes: 5000 })
  ])
  assert.deepEqual(brief(issues), [
    ['no-compression', 'https://a.test: no Content-Encoding', ['https://a.test/big', 'https://a.test/identity']]
  ])
  assert.equal(issues[0].category, 'performance')
})

test('headers: pages of one origin with the same finding are one issue, other origins and values stay apart', () => {
  const none = { 'strict-transport-security': undefined }
  const issues = checkResponseHeaders([
    page('https://a.test/1', none),
    page('http://a.test/2', none, { finalUrl: 'https://a.test/2' }),
    page('https://b.test/', none),
    page('https://a.test/3', { 'strict-transport-security': 'max-age=0' })
  ])
  assert.deepEqual(brief(issues), [
    ['missing-hsts', 'https://a.test: no Strict-Transport-Security', ['https://a.test/1', 'http://a.test/2']],
    ['missing-hsts', 'https://b.test: no Strict-Transport-Security', ['https://b.test/']],
    ['missing-hsts', 'https://a.test: max-age=0', ['https://a.test/3']]
  ])
})

test('csp: script-src-elem and script-src-attr take precedence over script-src for inline scripts', () => {
  const inline = ["inline scripts ('unsafe-inline' without a nonce or hash)"]
  assert.deepEqual(cspWeaknesses("script-src 'self'; script-src-elem 'self' 'unsafe-inline'"), inline)
  assert.deepEqual(cspWeaknesses("script-src 'self'; script-src-attr 'unsafe-inline'"), inline)
  // Elements are closed by script-src-elem, but event handler attributes still fall back to script-src.
  assert.deepEqual(cspWeaknesses("script-src 'unsafe-inline'; script-src-elem 'self'"), inline)
  assert.deepEqual(cspWeaknesses("script-src-elem 'unsafe-inline'; script-src-attr 'none'; script-src 'self'"), inline)
  // eval is only governed by script-src and default-src.
  assert.deepEqual(cspWeaknesses("script-src 'self'; script-src-elem 'unsafe-eval'"), [])
})

test('csp: a nonce or hash without a value does not switch off unsafe-inline', () => {
  for (const malformed of ["'nonce-'", "'nonce-abc", "'sha256-'", 'nonce-abc', "'nonce-abc==='"]) {
    assert.equal(cspWeaknesses(`script-src 'unsafe-inline' ${malformed}`).length, 1, malformed)
  }
  assert.deepEqual(cspWeaknesses("script-src 'unsafe-inline' 'nonce-QUJD+/_-=='"), [])
})

test('headers: an enforced frame-ancestors overrides X-Frame-Options, and one allowing any site does not protect', () => {
  const issues = checkResponseHeaders([
    page('https://a.test/', { 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors *' }),
    page('https://b.test/', { 'x-frame-options': undefined, 'content-security-policy': 'frame-ancestors https:' }),
    page('https://c.test/', {
      'x-frame-options': undefined,
      'content-security-policy': "frame-ancestors *, frame-ancestors 'self'"
    }),
    page('https://d.test/', {
      'x-frame-options': undefined,
      'content-security-policy': 'frame-ancestors https://partner.test'
    })
  ])
  assert.deepEqual(brief(issues), [
    ['missing-clickjacking-protection', 'https://a.test: frame-ancestors *', ['https://a.test/']],
    ['missing-clickjacking-protection', 'https://b.test: frame-ancestors https:', ['https://b.test/']]
  ])
  assert.match(issues[0].message, /overrides X-Frame-Options/)
})

test('headers: repeated X-Frame-Options values are judged like the HTML standard does', () => {
  const xfo = (value) => page(`https://${value.length}.test/`, { 'x-frame-options': value })
  // Several different values block framing when one of them is a value the header knows, even ALLOWALL.
  for (const value of ['DENY, DENY', 'DENY, SAMEORIGIN', 'ALLOWALL, junk', 'deny,']) {
    assert.deepEqual(checkResponseHeaders([xfo(value)]), [], value)
  }
  for (const value of ['ALLOWALL', 'ALLOW-FROM https://x.test', 'junk, other']) {
    assert.equal(checkResponseHeaders([xfo(value)]).length, 1, value)
  }
})

test('headers: only an exact max-age directive turns HSTS on, and the first header wins', () => {
  const hsts = (value) => page(`https://${value.length}.test/`, { 'strict-transport-security': value })
  const off = [
    'x-max-age=31536000',
    'max-age=1junk',
    'max-age=',
    'max-age="123',
    'max-age=123=garbage',
    'max-age=31536000; max-age=31536000',
    'max-age=31536000; includeSubDomains; includesubdomains',
    'includeSubDomains',
    'max-age=0, max-age=31536000'
  ]
  const on = ['max-age="31536000"', ' Max-Age = 31536000 ; includeSubDomains', 'max-age=31536000, max-age=0']
  for (const value of off) assert.equal(checkResponseHeaders([hsts(value)]).length, 1, value)
  for (const value of on) assert.deepEqual(checkResponseHeaders([hsts(value)]), [], value)
})

test('headers: repeated X-Content-Type-Options headers are judged by the first value', () => {
  const issues = checkResponseHeaders([
    page('https://a.test/', { 'x-content-type-options': 'nosniff, nosniff' }),
    page('https://b.test/', { 'x-content-type-options': 'NOSNIFF, sniff' }),
    page('https://c.test/', { 'x-content-type-options': 'sniff, nosniff' })
  ])
  assert.deepEqual(brief(issues), [
    ['missing-x-content-type-options', 'https://c.test: sniff, nosniff', ['https://c.test/']]
  ])
})

test('headers: a CSP with a fresh nonce on every response is still one issue per origin', () => {
  const csp = (nonce) => ({ 'content-security-policy': `script-src 'nonce-${nonce}' 'unsafe-eval'` })
  const issues = checkResponseHeaders([page('https://a.test/1', csp('aaa')), page('https://a.test/2', csp('bbb'))])
  assert.deepEqual(brief(issues), [
    ['weak-csp', "https://a.test: script-src 'nonce-aaa' 'unsafe-eval'", ['https://a.test/1', 'https://a.test/2']]
  ])
})

test('headers: frame-ancestors with a wildcard host on any scheme, port or path allows any site', () => {
  const ancestors = (value) =>
    page('https://a.test/', { 'x-frame-options': undefined, 'content-security-policy': `frame-ancestors ${value}` })
  for (const value of ['https://*:*', 'http://*:8080', '*:443', 'https://*/', 'wss:']) {
    assert.equal(checkResponseHeaders([ancestors(value)]).length, 1, value)
  }
  for (const value of ['https://*.partner.test', "'self'", "'none'", 'https://partner.test:*']) {
    assert.deepEqual(checkResponseHeaders([ancestors(value)]), [], value)
  }
})
