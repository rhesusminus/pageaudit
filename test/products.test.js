import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse } from '../src/parse.js'
import { checkProducts, pageProducts } from '../src/checks/page/products.js'

const ldJson = (...values) =>
  values.map((value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`).join('')
const page = (head) => parse(`<html><head>${head}</head><body><p>x</p></body></html>`)
const products = (...values) => pageProducts(page(ldJson(...values)))
const issues = (...values) => checkProducts(page(ldJson(...values)))
const types = (list) => list.map((issue) => issue.type)
const fixture = async (name) => parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

const product = (fields) => ({
  types: ['Product'],
  name: null,
  brand: null,
  sku: null,
  gtin: null,
  mpn: null,
  image: null,
  offers: null,
  shipping: null,
  returnPolicy: null,
  rating: null,
  ...fields
})

test('products: Shopify markup gives the brand, offers and the gaps', async () => {
  assert.deepEqual(pageProducts(await fixture('product.html')), [
    product({
      name: 'Argan Hair Oil',
      brand: 'Example Store',
      sku: 'HO-50',
      image: 'https://fixtures.test/cdn/shop/files/hair-oil.jpg?v=1&width=1920',
      offers: {
        count: 2,
        lowPrice: 19.9,
        highPrice: 29.9,
        priceCurrency: 'EUR',
        availability: ['InStock', 'OutOfStock']
      }
    })
  ])
})

test('products: a ProductGroup is one product, read with its inline and referenced variants', async () => {
  assert.deepEqual(pageProducts(await fixture('product-variants.html')), [
    product({
      types: ['ProductGroup'],
      name: 'Repair Conditioner',
      brand: 'Acme Labs',
      sku: 'RC-250',
      gtin: '6410000000013',
      image: 'https://fixtures.test/cdn/shop/files/rc-250.jpg',
      offers: { count: 2, lowPrice: 14.5, highPrice: 24, priceCurrency: 'EUR', availability: ['InStock'] },
      shipping: 'organization',
      returnPolicy: 'organization'
    })
  ])
})

test('products: a variant that only names its group with isVariantOf is read with the group', () => {
  const found = products({
    '@graph': [
      { '@type': 'ProductGroup', '@id': '#g', name: 'Shampoo' },
      { '@type': 'Product', isVariantOf: { '@id': '#g' }, offers: { '@type': 'Offer', price: 5, priceCurrency: 'EUR' } }
    ]
  })
  assert.equal(found.length, 1)
  assert.equal(found[0].offers.lowPrice, 5)
})

test('products: a variant whose group is not on the page is a product of its own', () => {
  const found = products({ '@type': 'Product', name: 'Shampoo 250 ml', isVariantOf: { '@id': '#elsewhere' } })
  assert.deepEqual(
    found.map((p) => p.name),
    ['Shampoo 250 ml']
  )
})

test('products: brand as a string, an object or a reference, identifiers from the offers', () => {
  const found = products(
    { '@type': 'Product', name: 'A', brand: 'Acme', mpn: 'M-1' },
    {
      '@type': 'Product',
      name: 'B',
      brand: { '@id': '#acme' },
      offers: { '@type': 'Offer', gtin14: '00012345678905' }
    },
    { '@type': 'Brand', '@id': '#acme', name: 'Acme Labs' },
    {
      '@type': 'Product',
      name: 'C',
      brand: [{ '@type': 'Brand' }, { name: 'Second' }],
      gtin: '',
      isbn: '9780000000002'
    }
  )
  assert.deepEqual(
    found.map(({ brand, gtin, mpn }) => ({ brand, gtin, mpn })),
    [
      { brand: 'Acme', gtin: null, mpn: 'M-1' },
      { brand: 'Acme Labs', gtin: '00012345678905', mpn: null },
      { brand: 'Second', gtin: '9780000000002', mpn: null }
    ]
  )
})

test('products: prices Google can read, from price, priceSpecification and AggregateOffer', () => {
  const offers = (value) => products({ '@type': 'Product', name: 'X', offers: value })[0].offers
  // A comma decimal or a thousands separator is not a price Google reads.
  assert.deepEqual(offers({ '@type': 'Offer', price: '19,90', priceCurrency: 'EUR' }), {
    count: 1,
    lowPrice: null,
    highPrice: null,
    priceCurrency: 'EUR',
    availability: []
  })
  assert.equal(offers({ '@type': 'Offer', price: '1,299.00' }).lowPrice, null)
  assert.deepEqual(
    offers({
      '@type': 'Offer',
      priceSpecification: { '@type': 'UnitPriceSpecification', price: 9, priceCurrency: 'USD' }
    }),
    { count: 1, lowPrice: 9, highPrice: 9, priceCurrency: 'USD', availability: [] }
  )
  assert.deepEqual(
    offers({ '@type': 'AggregateOffer', lowPrice: '10.00', highPrice: '30', priceCurrency: 'EUR', offerCount: 3 }),
    { count: 1, lowPrice: 10, highPrice: 30, priceCurrency: 'EUR', availability: [] }
  )
  assert.equal(offers([]), null)
})

test('products: shipping and returns on an offer, the Organization, or nowhere', () => {
  const offer = { '@type': 'Offer', price: 5, shippingDetails: { '@type': 'OfferShippingDetails' } }
  const [onOffer] = products({ '@type': 'Product', name: 'X', offers: offer })
  assert.equal(onOffer.shipping, 'offer')
  assert.equal(onOffer.returnPolicy, null)
  const [onOrganization] = products(
    { '@type': 'Product', name: 'X', offers: { '@type': 'Offer', price: 5 } },
    { '@type': 'Organization', name: 'Shop', hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy' } }
  )
  assert.equal(onOrganization.shipping, null)
  assert.equal(onOrganization.returnPolicy, 'organization')
})

test('products: the rating, with ratingCount when there is no reviewCount', () => {
  const rated = (aggregateRating) => products({ '@type': 'Product', name: 'X', aggregateRating })[0].rating
  assert.deepEqual(rated({ '@type': 'AggregateRating', ratingValue: '4.6', reviewCount: '12' }), {
    value: 4.6,
    count: 12
  })
  assert.deepEqual(rated({ ratingValue: 5, ratingCount: 3 }), { value: 5, count: 3 })
  assert.deepEqual(rated({ ratingValue: 4 }), { value: 4, count: null })
  assert.equal(rated({ reviewCount: 3 }), null)
})

test('products: an ItemList of products is not read, and the list stops at 10', () => {
  const list = {
    '@type': 'ItemList',
    itemListElement: [{ '@type': 'ListItem', position: 1, item: { '@type': 'Product', name: 'Listed' } }]
  }
  assert.deepEqual(products(list), [])
  const many = Array.from({ length: 12 }, (_, i) => ({ '@type': 'Product', name: `P${i}` }))
  assert.equal(products({ '@graph': many }).length, 10)
})

test('product-offer-incomplete: offers without an image, a price above 0 or a currency', () => {
  const [issue] = issues({ '@type': 'Product', name: 'X', offers: { '@type': 'Offer', price: '0.00' } })
  assert.equal(issue.type, 'product-offer-incomplete')
  assert.equal(issue.severity, 'warning')
  assert.equal(
    issue.message,
    'Product markup has offers but lacks an image, a price above 0, a priceCurrency, so it cannot show as a merchant listing'
  )
  assert.equal(issue.context, '"@type": "Product"')
})

test('product-offer-incomplete: an AggregateOffer alone is no merchant listing', () => {
  const offers = { '@type': 'AggregateOffer', lowPrice: 10, highPrice: 20, priceCurrency: 'EUR' }
  const [issue] = issues({ '@type': 'Product', name: 'X', image: 'https://a.test/x.jpg', offers })
  assert.match(issue.message, /lacks an Offer \(an AggregateOffer only gives a product snippet\)/)
})

test('product checks: complete offers, a product without offers and a collection page are quiet', async () => {
  assert.ok(!types(checkProducts(await fixture('product.html'))).includes('product-offer-incomplete'))
  assert.deepEqual(issues({ '@type': 'Product', name: 'X', aggregateRating: { ratingValue: 4 } }), [])
  const bare = { '@type': 'Offer', price: 0 }
  assert.deepEqual(
    issues({
      '@graph': [
        { '@type': 'Product', name: 'A', offers: bare },
        { '@type': 'Product', name: 'B', offers: bare }
      ]
    }),
    []
  )
})

test('product checks: two nodes of one product are checked through the one with offers', () => {
  const found = issues(
    { '@type': 'Product', name: 'Hair oil', aggregateRating: { ratingValue: 4.5, reviewCount: 3 } },
    { '@type': 'Product', name: 'hair oil', offers: { '@type': 'Offer', price: 0 } }
  )
  assert.deepEqual(types(found), ['product-offer-incomplete', 'product-details-missing'])
})

test('product-details-missing: the Shopify product lacks a GTIN, shipping and returns', async () => {
  const issue = checkProducts(await fixture('product.html')).find((i) => i.type === 'product-details-missing')
  assert.equal(issue.severity, 'info')
  assert.equal(
    issue.message,
    'Product markup leaves out an identifier (gtin or mpn), shippingDetails, hasMerchantReturnPolicy, which Google recommends for merchant listings'
  )
})

test('product-details-missing: a group with the details on its variants and the Organization is complete', async () => {
  assert.deepEqual(checkProducts(await fixture('product-variants.html')), [])
  const [bare] = issues({ '@type': 'Product', name: 'X', offers: { '@type': 'Offer' } }).filter(
    (i) => i.type === 'product-details-missing'
  )
  assert.match(
    bare.message,
    /out brand, an identifier \(gtin or mpn\), availability, shippingDetails, hasMerchantReturnPolicy,/
  )
})

test('product-brand-is-site: the Shopify vendor left as the store name', async () => {
  const issue = checkProducts(await fixture('product.html')).find((i) => i.type === 'product-brand-is-site')
  assert.equal(issue.severity, 'info')
  assert.equal(issue.message, 'The Product brand "Example Store" is the name of the site, not of the maker')
  assert.equal(issue.context, '"brand": "Example Store"')
})

test('product-brand-is-site: matched against the WebSite, a store type and og:site_name, in any case', () => {
  const product = { '@type': 'Product', name: 'X', brand: 'Hair  Co', offers: { '@type': 'Offer', price: 5 } }
  const brandIssues = (head) => types(checkProducts(page(head))).filter((type) => type === 'product-brand-is-site')
  assert.equal(brandIssues(ldJson(product, { '@type': 'WebSite', name: 'hair co' })).length, 1)
  assert.equal(brandIssues(ldJson(product, { '@type': 'HealthAndBeautyBusiness', name: 'Hair Co' })).length, 1)
  assert.equal(brandIssues(ldJson(product) + '<meta property="og:site_name" content="Hair Co">').length, 1)
  // A Brand node is the brand itself, not the site.
  assert.equal(brandIssues(ldJson(product, { '@type': 'Brand', name: 'Hair Co' })).length, 0)
  assert.equal(brandIssues(ldJson(product, { '@type': 'Organization', name: 'Hair Shop' })).length, 0)
})
