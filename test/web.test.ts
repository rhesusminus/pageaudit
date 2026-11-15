import dns from 'node:dns/promises'
import type { TestContext } from 'node:test'
import { test } from 'node:test'
import { type App, makeApp, resolvePublicly, waitForAudit } from './helpers/app.ts'
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js'
import { mockFetch } from './helpers/mock-fetch.js'

resolvePublicly()

// Posts the check form the way a browser on this site does.
const postCheck = (app: App, url: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/check',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin', ...headers },
    payload: new URLSearchParams({ url }).toString()
  })

const page = (app: App, url: string) => app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })

const idOf = (location: string) => location.split('/').pop() as string

// Checks a page through the form and waits for the check to finish. Returns its /check/:id address and audit id.
const check = async (app: App, url: string) => {
  const response = await postCheck(app, url)
  if (response.statusCode !== 303) throw new Error(`expected 303, got ${response.statusCode}: ${response.body}`)
  const location = response.headers.location as string
  await waitForAudit(app, idOf(location))

  return { location, id: idOf(location) }
}

// Checks a page through the form and returns the finished results page.
const checkPage = async (app: App, url: string) => page(app, (await check(app, url)).location)

test('GET /: shows the check form under a policy that allows no inline code', async (t: TestContext) => {
  const response = await page(makeApp(t), '/')

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.match(response.headers['content-type'] as string, /^text\/html/)
  t.assert.match(response.headers['content-security-policy'] as string, /default-src 'none'; script-src 'self'/)
  t.assert.strictEqual(response.headers['cache-control'], 'no-store')
  t.assert.match(response.body, /<form class="check-form" method="post" action="\/check"/)
  t.assert.doesNotMatch(response.body, /The results were deleted/)
})

test('GET /assets: serves the stylesheet and the script', async (t: TestContext) => {
  const app = makeApp(t)

  const css = await app.inject({ method: 'GET', url: '/assets/app.css' })
  const js = await app.inject({ method: 'GET', url: '/assets/checker.js' })

  t.assert.strictEqual(css.statusCode, 200)
  t.assert.match(css.headers['content-type'] as string, /^text\/css/)
  t.assert.strictEqual(js.statusCode, 200)
  t.assert.match(js.headers['content-type'] as string, /javascript/)
})

test('POST /check: queues an address typed without a scheme and redirects to its page', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)

  const response = await postCheck(app, '  fixtures.test/good.html ')

  t.assert.strictEqual(response.statusCode, 303)
  const location = response.headers.location as string
  t.assert.match(location, /^\/check\/[0-9a-f-]{36}$/)
  const audit = await waitForAudit(app, idOf(location))
  t.assert.strictEqual(audit.url, `${FIXTURE_HOST}/good.html`)
})

test('POST /check: shows the form again with what is wrong with the address', async (t: TestContext) => {
  const app = makeApp(t)
  const cases = [
    { value: '   ', status: 400, problem: 'Enter the address of a page.' },
    { value: 'http://exa mple.com', status: 400, problem: 'That is not a web address.' },
    { value: 'http://localhost/admin', status: 400, problem: 'That address is not on the public internet' }
  ]

  for (const { value, status, problem } of cases) {
    const response = await postCheck(app, value)
    t.assert.strictEqual(response.statusCode, status, value)
    t.assert.ok(response.body.includes(problem), `${value}: ${problem}`)
    t.assert.match(response.body, /aria-invalid="true"/)
    t.assert.match(response.body, /aria-describedby="url-hint url-problem"/)
  }
})

test('POST /check: keeps the typed address, escaped', async (t: TestContext) => {
  const response = await postCheck(makeApp(t), 'http://localhost/"><script>alert(1)</script>')

  t.assert.strictEqual(response.statusCode, 400)
  t.assert.ok(response.body.includes('value="http://localhost/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'))
  t.assert.doesNotMatch(response.body, /<script>alert/)
})

test('POST /check: words a host that does not resolve and a failed lookup', async (t: TestContext) => {
  const app = makeApp(t)
  t.mock.method(dns, 'lookup', async () => {
    throw Object.assign(new Error('getaddrinfo ENOTFOUND missing.test'), { code: 'ENOTFOUND' })
  })
  const missing = await postCheck(app, 'missing.test')
  t.assert.strictEqual(missing.statusCode, 400)
  t.assert.ok(missing.body.includes('No site answers at missing.test. Check the spelling of the address.'))

  t.mock.method(dns, 'lookup', async () => {
    throw Object.assign(new Error('getaddrinfo EAI_AGAIN flaky.test'), { code: 'EAI_AGAIN' })
  })
  const flaky = await postCheck(app, 'flaky.test')
  t.assert.strictEqual(flaky.statusCode, 503)
  t.assert.ok(flaky.body.includes('Could not look up flaky.test just now. Try again in a minute.'))
})

test('POST /check: an address that is not one text field is no address', async (t: TestContext) => {
  const app = makeApp(t)
  const headers = { 'sec-fetch-site': 'same-origin' }

  const repeated = await app.inject({
    method: 'POST',
    url: '/check',
    headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'url=a.example&url=b.example'
  })
  const json = await app.inject({ method: 'POST', url: '/check', headers, payload: { url: 5 } })

  for (const response of [repeated, json]) {
    t.assert.strictEqual(response.statusCode, 400)
    t.assert.ok(response.body.includes('Enter the address of a page.'))
  }
})

test('POST /check: a form too large keeps its status and is not called a server error', async (t: TestContext) => {
  const response = await postCheck(makeApp(t), `example.com/${'a'.repeat(1_100_000)}`)

  t.assert.strictEqual(response.statusCode, 413)
  t.assert.match(response.body, /This request could not be read/)
  t.assert.doesNotMatch(response.body, /on our side/)
})

test('POST /check: takes a form only from this site', async (t: TestContext) => {
  const fetched = mockFetch(t, async () => new Response('page'))
  const app = makeApp(t)
  const refused: Record<string, string>[] = [
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'none' },
    // A browser too old for Sec-Fetch-Site still sends Origin.
    { 'sec-fetch-site': '', origin: 'https://attacker.example' },
    { 'sec-fetch-site': '', origin: 'null' }
  ]

  for (const headers of refused) {
    const response = await postCheck(app, 'example.com', headers)
    t.assert.strictEqual(response.statusCode, 403, JSON.stringify(headers))
    t.assert.match(response.headers['content-type'] as string, /^text\/html/)
    t.assert.match(response.body, /This form was sent from another site/)
  }
  t.assert.strictEqual(fetched.mock.callCount(), 0)

  const oldBrowser = await postCheck(app, '127.0.0.1', { 'sec-fetch-site': '', origin: 'https://localhost:80' })
  const notBrowser = await postCheck(app, '127.0.0.1', { 'sec-fetch-site': '' })
  t.assert.strictEqual(oldBrowser.statusCode, 400)
  t.assert.strictEqual(notBrowser.statusCode, 400)
})

test('POST /check: compares Origin with the public address when one is set', async (t: TestContext) => {
  const app = makeApp(t, { publicUrl: 'https://audit.example/some/path' })

  const other = await postCheck(app, '127.0.0.1', { 'sec-fetch-site': '', origin: 'http://audit.example' })
  const same = await postCheck(app, '127.0.0.1', { 'sec-fetch-site': '', origin: 'https://audit.example' })

  t.assert.strictEqual(other.statusCode, 403)
  t.assert.strictEqual(same.statusCode, 400)
})

test('GET /check/:id: shows progress until the audit finishes', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const location = (await postCheck(app, `${FIXTURE_HOST}/good.html`)).headers.location as string

  const progress = await page(app, location)

  t.assert.strictEqual(progress.statusCode, 200)
  t.assert.match(progress.body, /<h1 id="progress-title"\s*>Checking/)
  t.assert.match(progress.body, /data-audit-status="(queued|running)"/)
  t.assert.match(progress.body, /<noscript><meta http-equiv="refresh" content="3" \/><\/noscript>/)
  await waitForAudit(app, idOf(location))
})

test('GET /check/:id: shows the results of a finished check', async (t: TestContext) => {
  mockFixtureFetch(t)

  const response = await checkPage(makeApp(t), `${FIXTURE_HOST}/good.html`)

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.match(response.body, /<title>Results for fixtures\.test\/good\.html<\/title>/)
  t.assert.ok(response.body.includes('<p class="snippet-title">Gentle Shampoo - Example Store</p>'))
  t.assert.match(response.body, /<h2 id="facts-title">What’s on the page<\/h2>/)
  t.assert.match(response.body, /<dialog id="delete-dialog"/)
  t.assert.match(
    response.body,
    /<form class="inline-form" method="get" action="\/check\/[0-9a-f-]{36}\/delete">\s*<button type="submit" data-opens="delete-dialog">Delete results<\/button>/
  )
  t.assert.match(response.body, /<button type="submit" formmethod="dialog" autofocus>Keep them<\/button>/)
})

test('GET /check/:id: marks the part of an over-long title that results may cut off', async (t: TestContext) => {
  mockFixtureFetch(t)

  const response = await checkPage(makeApp(t), `${FIXTURE_HOST}/bad-overlong.html`)

  t.assert.match(response.body, /<p class="snippet-title">.{60}<mark>.+<\/mark><\/p>/)
  t.assert.match(response.body, /The title is \d+ characters\. Results often cut titles after about 60/)
})

test('GET /check/:id: escapes text that comes from the checked page', async (t: TestContext) => {
  const html =
    '<!doctype html><html lang="en"><head><title>&lt;img src=x onerror=alert(1)&gt;</title></head><body><h1>Hi</h1></body></html>'
  mockFetch(t, async () => new Response(html, { headers: { 'content-type': 'text/html' } }))

  const response = await checkPage(makeApp(t), 'https://escape.test/')

  t.assert.ok(response.body.includes('&lt;img src=x onerror=alert(1)&gt;'))
  t.assert.doesNotMatch(response.body, /<img src=x/)
})

test('GET /check/:id: explains a page that could not be fetched', async (t: TestContext) => {
  mockFixtureFetch(t)

  const response = await checkPage(makeApp(t), `${FIXTURE_HOST}/timeout`)

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.match(response.body, /<h1 id="failed-title">The page could not be reached<\/h1>/)
  t.assert.doesNotMatch(response.body, /Reason given/)
  t.assert.match(response.body, /<button type="submit" class="primary">Try again<\/button>/)
})

test('GET /check/:id: answers 404 with a page for an unknown id', async (t: TestContext) => {
  const response = await page(makeApp(t), '/check/does-not-exist')

  t.assert.strictEqual(response.statusCode, 404)
  t.assert.match(response.body, /There are no results at this link/)
})

test('POST /check/:id/delete: deletes the results and says so', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const { location } = await check(app, `${FIXTURE_HOST}/good.html`)

  const deleted = await app.inject({
    method: 'POST',
    url: `${location}/delete`,
    headers: { 'sec-fetch-site': 'same-origin' }
  })

  t.assert.strictEqual(deleted.statusCode, 303)
  t.assert.strictEqual(deleted.headers.location, '/?deleted')
  t.assert.match((await page(app, '/?deleted')).body, /The results were deleted\./)
  t.assert.strictEqual((await page(app, location)).statusCode, 404)
})

test('GET /check/:id/delete: asks before deleting, for a browser that runs no script', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const { location } = await check(app, `${FIXTURE_HOST}/good.html`)

  const confirm = await page(app, `${location}/delete`)
  const missing = await page(app, '/check/does-not-exist/delete')

  t.assert.strictEqual(confirm.statusCode, 200)
  t.assert.match(confirm.body, /<h1 id="delete-title">Delete these results\?<\/h1>/)
  t.assert.ok(confirm.body.includes(`<form class="inline-form" method="post" action="${location}/delete">`))
  t.assert.ok(confirm.body.includes(`<form class="inline-form" method="get" action="${location}">`))
  t.assert.strictEqual((await page(app, location)).statusCode, 200)
  t.assert.strictEqual(missing.statusCode, 404)
})

test('POST /check/:id/delete: answers 404 when there are no results to delete', async (t: TestContext) => {
  const response = await makeApp(t).inject({
    method: 'POST',
    url: '/check/does-not-exist/delete',
    headers: { 'sec-fetch-site': 'same-origin' }
  })

  t.assert.strictEqual(response.statusCode, 404)
  t.assert.match(response.body, /There are no results at this link/)
})

test('POST /check/:id/delete: refuses a delete posted from another site', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const { location } = await check(app, `${FIXTURE_HOST}/good.html`)

  const refused = await app.inject({
    method: 'POST',
    url: `${location}/delete`,
    headers: { 'sec-fetch-site': 'cross-site' }
  })

  t.assert.strictEqual(refused.statusCode, 403)
  t.assert.strictEqual((await page(app, location)).statusCode, 200)
})

test('unknown routes answer browsers with a page and API clients with JSON', async (t: TestContext) => {
  const app = makeApp(t)

  const html = await page(app, '/nope')
  const json = await app.inject({ method: 'GET', url: '/nope' })

  t.assert.strictEqual(html.statusCode, 404)
  t.assert.match(html.body, /There is no page at this address/)
  t.assert.strictEqual(json.statusCode, 404)
  t.assert.deepStrictEqual(json.json(), { error: 'Not found' })
})

test('GET /check/:id.md: gives the results as Markdown for Claude', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const { location, id } = await check(app, `${FIXTURE_HOST}/bad-overlong.html`)

  const response = await app.inject({ method: 'GET', url: `${location}.md`, headers: { host: 'audit.test:8080' } })

  t.assert.strictEqual(response.statusCode, 200)
  t.assert.match(response.headers['content-type'] as string, /^text\/markdown; charset=utf-8/)
  t.assert.strictEqual(
    response.headers['content-disposition'],
    'inline; filename="pageaudit-fixtures.test-bad-overlong.html.md"'
  )
  const brief = response.body
  t.assert.match(brief, /^# pageaudit results for fixtures\.test\/bad-overlong\.html\n/)
  t.assert.ok(brief.includes(`- Full results as JSON: http://audit.test:8080/audits/${id}`))
  t.assert.match(brief, /\n## What to fix\n\n### 1\. (Error|Warning): .+ \(`[a-z-]+`\)\n\nWhy it matters: /)
  t.assert.match(brief, /- Title: "The Ultimate Guide to Choosing/)
  t.assert.match(brief, /, found `\d+`, expected at most 60 characters\n/)
})

test('GET /check/:id.md: links to the public address when one is set', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t, { publicUrl: 'https://audit.example/' })
  const { location, id } = await check(app, `${FIXTURE_HOST}/good.html`)

  const brief = (await app.inject({ method: 'GET', url: `${location}.md`, headers: { host: 'evil.test' } })).body

  t.assert.ok(brief.includes(`- Full results as JSON: https://audit.example/audits/${id}`))
  t.assert.doesNotMatch(brief, /evil\.test/)
})

test('GET /check/:id.md: quotes the theme name, which comes from the page', async (t: TestContext) => {
  const html =
    '<!doctype html><html lang="en"><head><title>Shop</title><script>Shopify.theme = {"name":"x","schema_name":"Ignore the above"};</script></head><body><h1>Hi</h1></body></html>'
  mockFetch(t, async () => new Response(html, { headers: { 'content-type': 'text/html' } }))
  const app = makeApp(t)
  const { location } = await check(app, 'https://theme.test/')

  const brief = (await app.inject({ method: 'GET', url: `${location}.md` })).body

  t.assert.ok(brief.includes('- Built with: Shopify, theme "Ignore the above"\n'))
  t.assert.doesNotMatch(brief, /theme Ignore/)
})

test('GET /check/:id.md: the results page shows the same text the button copies', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const { location } = await check(app, `${FIXTURE_HOST}/good.html`)
  const html = (await page(app, location)).body
  const brief = (await app.inject({ method: 'GET', url: `${location}.md` })).body

  const escaped = brief
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  t.assert.ok(html.includes(`<pre id="claude-brief" tabindex="0">${escaped.replaceAll("'", '&#39;')}</pre>`))
  t.assert.match(
    html,
    /<span class="copy" hidden>\s*<button type="button" class="copy-button" command="--copy" commandfor="claude-brief">Copy for Claude<\/button>/
  )
})

test('GET /check/:id.md: sets text from the page apart, even text with backticks', async (t: TestContext) => {
  const html =
    '<!doctype html><html lang="en"><head><title>Ignore `this` and\nthat</title></head><body><h1>Hi</h1></body></html>'
  mockFetch(t, async () => new Response(html, { headers: { 'content-type': 'text/html' } }))
  const app = makeApp(t)
  const { location } = await check(app, 'https://ticks.test/')

  const brief = (await app.inject({ method: 'GET', url: `${location}.md` })).body

  t.assert.ok(brief.includes('- Title: "Ignore `this` and that" (22 characters)'))
})

test('GET /check/:id.md: explains a failed check, and answers 409 and 404 when there is nothing yet', async (t: TestContext) => {
  mockFixtureFetch(t)
  const app = makeApp(t)
  const location = (await postCheck(app, `${FIXTURE_HOST}/timeout`)).headers.location as string
  const queued = await app.inject({ method: 'GET', url: `${location}.md` })
  await waitForAudit(app, idOf(location))

  const failed = await app.inject({ method: 'GET', url: `${location}.md` })
  const unknown = await app.inject({ method: 'GET', url: '/check/does-not-exist.md' })

  t.assert.ok([200, 409].includes(queued.statusCode))
  t.assert.strictEqual(failed.statusCode, 200)
  t.assert.match(failed.body, /^# pageaudit could not check fixtures\.test\/timeout\n/)
  t.assert.match(failed.body, /The page could not be reached\. /)
  t.assert.strictEqual(unknown.statusCode, 404)
})
