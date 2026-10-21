import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from '../src/parse.js'
import { pagePlatform } from '../src/checks/page/platform.js'

const platform = (head, html = '') =>
  pagePlatform(parse(`<html${html}><head>${head}</head><body><p>x</p></body></html>`))
const fixture = async (name) => parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

const SHOPIFY_THEME = 'Shopify.theme = {"name":"Copy of Dawn","id":1,"schema_name":"Dawn","role":"main"};'

test('platform: a Shopify page names the theme it was made from, not the copy', async () => {
  assert.deepEqual(pagePlatform(await fixture('product.html')), { name: 'Shopify', theme: 'Dawn' })
  assert.deepEqual(platform(`<script>var Shopify = Shopify || {};\n${SHOPIFY_THEME}</script>`), {
    name: 'Shopify',
    theme: 'Dawn'
  })
})

test('platform: Shopify is found from its files alone, then without a theme', () => {
  const expected = { name: 'Shopify', theme: null }
  assert.deepEqual(platform('<script src="//cdn.shopify.com/s/files/1/0/t/1/assets/app.js"></script>'), expected)
  assert.deepEqual(platform('<link rel="stylesheet" href="/cdn/shop/t/4/assets/base.css">'), expected)
  assert.deepEqual(platform('<link rel="stylesheet" href="https://shop.test/cdn/shop/t/4/assets/base.css">'), expected)
  assert.deepEqual(platform('<script>Shopify.shop = "x.myshopify.com";</script>'), expected)
})

test('platform: a Shopify.theme that is not JSON, or has no schema_name, gives no theme', () => {
  const expected = { name: 'Shopify', theme: null }
  assert.deepEqual(platform('<script>Shopify.theme = {name: "Dawn"};</script>'), expected)
  assert.deepEqual(platform('<script>Shopify.theme = {"name":"Dawn"};</script>'), expected)
  assert.deepEqual(platform('<script>Shopify.theme = {"schema_name":42};</script>'), expected)
})

test('platform: the theme is read from a Shopify.theme over several lines or with a brace in a quoted name', () => {
  const theme = (json) => platform(`<script>${'Shopify.theme = ' + json + ';'}</script>`)?.theme
  assert.equal(theme('{\n  "name": "Copy of Dawn",\n  "schema_name": "Dawn"\n}'), 'Dawn')
  assert.equal(theme('{"name":"Sale }; 2026","schema_name":"Dawn"}'), 'Dawn')
})

test('platform: only JavaScript is read for Shopify globals, not JSON-LD that mentions them', () => {
  const ldJson = JSON.stringify({ '@type': 'Article', description: 'How Shopify.shop = "x" works' })
  assert.deepEqual(
    platform(`<meta name="generator" content="WordPress 6.6.2"><script type="application/ld+json">${ldJson}</script>`),
    { name: 'WordPress', theme: null }
  )
  assert.deepEqual(platform(`<script type="module">${SHOPIFY_THEME}</script>`), { name: 'Shopify', theme: 'Dawn' })
})

test('platform: WordPress in a subfolder is found, with its theme', () => {
  assert.deepEqual(platform('<link rel="stylesheet" href="/blog/wp-content/themes/example/style.css">'), {
    name: 'WordPress',
    theme: 'example'
  })
})

test('platform: WordPress is found from the generator or its files, the theme from its folder', () => {
  assert.deepEqual(platform('<meta name="generator" content="WordPress 6.6.2">'), { name: 'WordPress', theme: null })
  assert.deepEqual(platform('<script src="/wp-includes/js/jquery/jquery.min.js"></script>'), {
    name: 'WordPress',
    theme: null
  })
  assert.deepEqual(
    platform(
      '<link rel="stylesheet" href="/wp-content/plugins/forms/style.css">' +
        '<link rel="stylesheet" href="https://blog.test/wp-content/themes/twentytwentyfour/style.css?ver=1.2">'
    ),
    { name: 'WordPress', theme: 'twentytwentyfour' }
  )
})

test('platform: Wix, Squarespace and Webflow are found, without a theme', () => {
  assert.deepEqual(platform('<meta name="generator" content="Wix.com Website Builder">'), { name: 'Wix', theme: null })
  assert.deepEqual(platform('<script src="https://static.parastorage.com/services/x.js"></script>'), {
    name: 'Wix',
    theme: null
  })
  assert.deepEqual(platform('<script src="https://static1.squarespace.com/static/vta/x/scripts/site.js"></script>'), {
    name: 'Squarespace',
    theme: null
  })
  assert.deepEqual(platform('<meta content="Webflow" name="generator">'), { name: 'Webflow', theme: null })
  assert.deepEqual(platform('', ' data-wf-site="64f0"'), { name: 'Webflow', theme: null })
  assert.deepEqual(platform('<link rel="stylesheet" href="https://cdn.prod.website-files.com/64f0/css/site.css">'), {
    name: 'Webflow',
    theme: null
  })
})

test('platform: a page with none of the markers, or only look-alikes, has none', async () => {
  assert.equal(pagePlatform(await fixture('good.html')), null)
  assert.equal(platform('<meta name="generator" content="Hugo 0.120.0">'), null)
  // Only the scripts and files a page loads count: a link to a Shopify page or a mention in text is not a marker.
  assert.equal(platform('<link rel="alternate" href="https://notshopify.com.test/x">'), null)
  // A link that loads nothing names another site, such as the designer's, not the platform of this page.
  assert.equal(platform('<link rel="author" href="https://designer.squarespace.com/">'), null)
  assert.equal(platform('<link rel="me" href="https://cdn.shopify.com/s/files/x">'), null)
  assert.equal(
    pagePlatform(
      parse('<html><body><a href="https://cdn.shopify.com/x.pdf">Shopify.shop = "x"</a><img src="/cdn/shop/x.jpg">')
    ),
    null
  )
  assert.equal(platform('<script src="https://evilcdn.shopify.com.test/x.js"></script>'), null)
})
