import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fetchPublicPage, publicLookup, validateDestination } from '../src/api/public-destination.js'
import { mockFetch } from './helpers/mock-fetch.js'

const answers = (...addresses) => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
const lookup = (options = { all: true }) =>
  new Promise((resolve, reject) => {
    publicLookup('public.test', options, (error, address, family) => {
      if (error) reject(error)
      else resolve(options.all ? address : { address, family })
    })
  })

test('public destinations: rejects private, encoded and special-use IP literals without DNS', async (t) => {
  const dnsMock = t.mock.method(dns, 'lookup', async () => {
    throw new Error('unexpected DNS lookup')
  })
  const hosts = [
    'localhost',
    'LOCALHOST.',
    'a.localhost',
    '127.0.0.1',
    '127.1',
    '2130706433',
    '0x7f000001',
    '0177.0.0.1',
    '0.0.0.0',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '[::]',
    '[::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:a00:1]',
    '[fc00::1]',
    '[fd12::1]',
    '[fe80::1]',
    '[fec0::1]',
    '[ff02::1]',
    '[64:ff9b::a00:1]',
    '[2002:a00:1::]',
    '[2001:db8::1]',
    '[4000::1]'
  ]
  for (const host of hosts) await assert.rejects(validateDestination(`http://${host}/`), /public network/, host)
  assert.equal(dnsMock.mock.callCount(), 0)
})

test('public destinations: allows public IPv4 and IPv6 and rejects credentials and protocols', async () => {
  await validateDestination('https://8.8.8.8')
  await validateDestination('https://[2606:4700:4700::1111]')
  await assert.rejects(validateDestination('ftp://8.8.8.8'), /public network/)
  await assert.rejects(validateDestination('http://user:pass@8.8.8.8'), /public network/)
})

test('public destinations: DNS fails closed, including mixed answers and empty results', async (t) => {
  const dnsMock = t.mock.method(dns, 'lookup')
  for (const result of [answers('10.0.0.1'), answers('8.8.8.8', 'fd00::1'), answers('::ffff:192.168.1.1'), []]) {
    dnsMock.mock.mockImplementation(async () => result)
    await assert.rejects(validateDestination('https://public.test'), /public network/)
    await assert.rejects(lookup(), /public network/)
  }
  dnsMock.mock.mockImplementation(async () => {
    throw new Error('ENOTFOUND')
  })
  await assert.rejects(validateDestination('https://public.test'), /ENOTFOUND/)
  await assert.rejects(lookup(), /ENOTFOUND/)
})

test('public destinations: socket lookup returns only validated addresses and handles family selection', async (t) => {
  const result = answers('8.8.8.8', '2606:4700:4700::1111')
  t.mock.method(dns, 'lookup', async () => result)
  assert.deepEqual(await lookup(), result)
  assert.deepEqual(await lookup({ family: 6 }), result[1])
})

test('public destinations: socket DNS rechecks and blocks rebinding after validation', async (t) => {
  const dnsMock = t.mock.method(dns, 'lookup', async () => answers('8.8.8.8'))
  await validateDestination('https://public.test')
  dnsMock.mock.mockImplementation(async () => answers('127.0.0.1'))
  await assert.rejects(lookup(), /public network/)
})

test('public destinations: checks DNS on every redirect including the same hostname', async (t) => {
  const dnsMock = t.mock.method(dns, 'lookup', async () => answers('8.8.8.8'))
  const fetched = mockFetch(t, async (_url, options) => {
    assert.equal(options.redirect, 'manual')
    assert.ok(options.dispatcher)
    dnsMock.mock.mockImplementation(async () => answers('127.0.0.1'))
    return new Response(null, { status: 302, headers: { location: '/private' } })
  })
  await assert.rejects(fetchPublicPage('https://public.test/start'), /public network/)
  assert.equal(fetched.mock.callCount(), 1)
})

test('public destinations: checks the DNS of a redirect to another hostname', async (t) => {
  t.mock.method(dns, 'lookup', async (hostname) => answers(hostname === 'public.test' ? '8.8.8.8' : '192.168.1.1'))
  const fetched = mockFetch(
    t,
    async () => new Response(null, { status: 307, headers: { location: '//internal.test/' } })
  )
  await assert.rejects(fetchPublicPage('https://public.test'), /public network/)
  assert.equal(fetched.mock.callCount(), 1)
})

test('public destinations: real transport blocks DNS rebinding before connecting to a local server', async (t) => {
  let received = 0
  const server = createServer((_req, res) => {
    received++
    res.end('private data')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  let lookups = 0
  const dnsMock = t.mock.method(dns, 'lookup', async () => answers(++lookups === 1 ? '8.8.8.8' : '127.0.0.1'))
  await assert.rejects(fetchPublicPage(`http://rebind.test:${server.address().port}/`), /public network/)
  assert.equal(dnsMock.mock.callCount(), 2)
  assert.equal(received, 0)
})
