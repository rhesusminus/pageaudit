import { SOURCES } from '../../sources.js'
import { MAX_URL } from '../../text.js'
import { seoIssue } from '../snippet.js'
import { idIndex, nameOf, pageObjects, text, textValue, typesOf } from './json-ld.js'
import { metaContent, ogSelector } from './signals.js'

const MAX_PRODUCTS = 10
const MAX_AVAILABILITY = 5
// Types that name the site itself, besides any type ending in Store or Business, such as ClothingStore.
const SITE_TYPES = new Set(['Organization', 'Corporation', 'WebSite'])
const IDENTIFIERS = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'isbn']

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const objects = (value) => [value].flat().filter(isObject)
const has = (value) => value !== undefined && value !== null && value !== ''
const idOf = (node) => (typeof node['@id'] === 'string' ? node['@id'] : null)

const isProduct = (node) => typesOf(node).some((type) => type === 'Product' || type === 'ProductGroup')
const isGroup = (node) => typesOf(node).includes('ProductGroup')

// A price as Google reads it: a number, or a string of digits with a dot for decimals. "19,90" and "1,299.00" are
// not prices, Google asks for a dot and no thousands separator.
function amount(value) {
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'number') return Number.isFinite(first) ? first : null
  return typeof first === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(first) ? Number(first) : null
}

const priceSpecification = (offer) => objects(offer.priceSpecification)[0] ?? {}

const offerPrices = (offer) =>
  [offer.price, priceSpecification(offer).price, offer.lowPrice, offer.highPrice].map(amount).filter((n) => n !== null)

const offerCurrency = (offer) => textValue(offer.priceCurrency) ?? textValue(priceSpecification(offer).priceCurrency)

// "https://schema.org/InStock" and "InStock" are the same value, so the facts keep the short form.
const availability = (offer) => textValue(offer.availability)?.replace(/^https?:\/\/schema\.org\//i, '') ?? null

// The first image address of a URL, a list of them or an ImageObject.
function imageUrl(value) {
  for (const item of [value].flat()) {
    const url = isObject(item)
      ? (textValue(item.url, MAX_URL) ?? textValue(item.contentUrl, MAX_URL))
      : text(item, MAX_URL)
    if (url) return url
  }
  return null
}

function offerSummary(offers) {
  if (offers.length === 0) return null
  const prices = offers.flatMap(offerPrices)
  return {
    count: offers.length,
    lowPrice: prices.length ? Math.min(...prices) : null,
    highPrice: prices.length ? Math.max(...prices) : null,
    priceCurrency: offers.map(offerCurrency).find(Boolean) ?? null,
    availability: [...new Set(offers.map(availability).filter(Boolean))].slice(0, MAX_AVAILABILITY)
  }
}

function rating(node) {
  const aggregate = objects(node.aggregateRating)[0]
  const value = aggregate ? amount(aggregate.ratingValue) : null
  return value === null ? null : { value, count: amount(aggregate.reviewCount) ?? amount(aggregate.ratingCount) }
}

// Where the shipping or return details are: on an offer, on the Organization (Google reads them there too, usually
// from the home page), or nowhere on this page. `orgKey` is the Organization property.
function policyPlace(offers, offerKey, orgKey, nodes) {
  if (offers.some((offer) => has(offer[offerKey]))) return 'offer'
  return nodes.some((node) => !isProduct(node) && has(node[orgKey])) ? 'organization' : null
}

// The variants of each ProductGroup on the page: its hasVariant entries, inline or { @id } references, and the
// Products whose isVariantOf refers to it.
function variantsByGroup(nodes, byId) {
  const groups = new Map(nodes.filter(isGroup).map((group) => [group, []]))
  for (const [group, variants] of groups) {
    for (const entry of objects(group.hasVariant)) variants.push({ ...byId.get(idOf(entry)), ...entry })
  }
  for (const node of nodes.filter((n) => isProduct(n) && !isGroup(n))) {
    const group = byId.get(objects(node.isVariantOf).map(idOf)[0])
    if (groups.has(group) && !groups.get(group).some((variant) => idOf(variant) && idOf(variant) === idOf(node))) {
      groups.get(group).push(node)
    }
  }
  return groups
}

// A Product that is a variant of a ProductGroup on the page is read as part of its group, not as a product of its own.
function isVariant(node, groups, byId) {
  if (isGroup(node)) return false
  const id = idOf(node)
  const group = byId.get(objects(node.isVariantOf).map(idOf)[0])
  return groups.has(group) || [...groups.values()].some((variants) => id && variants.some((v) => idOf(v) === id))
}

// The first value `read` finds in the product, its variants and, where passed, their offers.
const first = (members, read) => members.map(read).find(Boolean) ?? null

// One product of the page with its variants, as the facts describe it, plus what the checks need beyond that:
// `id` and `url` (without its query, which Shopify uses for the variant) to tell two nodes of one product from two
// products, and the types of its offers.
function describe(node, variants, nodes, byId) {
  const members = [node, ...variants]
  const offers = members.flatMap((member) => objects(member.offers))
  // Shopify themes write the sku and barcode of each variant on its offer.
  const withOffers = [...members, ...offers]
  return {
    id: idOf(node),
    url: textValue(node.url, MAX_URL)?.split(/[?#]/)[0] ?? null,
    offerTypes: offers.map((offer) => typesOf(offer)),
    fact: {
      types: typesOf(node),
      name: textValue(node.name),
      brand: first(members, (member) =>
        [member.brand]
          .flat()
          .map((brand) => nameOf(brand, byId))
          .find(Boolean)
      ),
      sku: first(withOffers, (item) => textValue(item.sku)),
      gtin: first(withOffers, (item) => IDENTIFIERS.map((key) => textValue(item[key])).find(Boolean)),
      mpn: first(withOffers, (item) => textValue(item.mpn)),
      image: first(members, (member) => imageUrl(member.image)),
      offers: offerSummary(offers),
      shipping: policyPlace(offers, 'shippingDetails', 'hasShippingService', nodes),
      returnPolicy: policyPlace(offers, 'hasMerchantReturnPolicy', 'hasMerchantReturnPolicy', nodes),
      rating: rating(node)
    }
  }
}

// Every product of the page, a ProductGroup with its variants counted once. Only nodes at the top of a JSON-LD block
// or in its @graph are read, so the products of an ItemList on a collection page are not. `all` is every JSON-LD
// object of the page.
function products(all) {
  const nodes = all.filter((node) => typesOf(node).length > 0)
  const byId = idIndex(all)
  const groups = variantsByGroup(nodes, byId)
  return nodes
    .filter((node) => isProduct(node) && !isVariant(node, groups, byId))
    .map((node) => describe(node, groups.get(node) ?? [], nodes, byId))
}

// What the Product markup of the page says, at most MAX_PRODUCTS products.
export const pageProducts = ($) =>
  products(pageObjects($))
    .slice(0, MAX_PRODUCTS)
    .map((product) => product.fact)

const sameName = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase()

// Two nodes are one product when they share an @id, a url or a name, such as the theme's Product and the one a
// reviews app adds.
const sameProduct = (a, b) =>
  Boolean(a.id && a.id === b.id) || Boolean(a.url && a.url === b.url) || sameName(a.fact.name, b.fact.name)

// The products of the page with the nodes of each one together.
function byProduct(list) {
  let groups = []
  for (const product of list) {
    const joined = groups.filter((group) => group.some((other) => sameProduct(product, other)))
    groups = [...groups.filter((group) => !joined.includes(group)), [...joined.flat(), product]]
  }
  return groups
}

// The product a page is about, when it is about one: every product node is the same product and one of them has
// offers. A collection page lists several products, or none outside an ItemList, so it gets no product checks.
function soleProduct(groups) {
  if (groups.length !== 1) return null
  return groups[0].find((product) => product.fact.offers) ?? null
}

const typeContext = (product) => `"@type": "${product.fact.types.join(', ')}"`

// What a merchant listing needs besides the name, which missing-schema-property asks for.
function offerGaps({ fact, offerTypes }) {
  const gaps = []
  if (!fact.image) gaps.push('an image')
  if (!(fact.offers.highPrice > 0)) gaps.push('a price above 0')
  if (!fact.offers.priceCurrency) gaps.push('a priceCurrency')
  if (offerTypes.every((types) => types.includes('AggregateOffer')))
    gaps.push('an Offer (an AggregateOffer only gives a product snippet)')
  return gaps
}

function offerIncomplete(product) {
  const gaps = offerGaps(product)
  if (gaps.length === 0) return []
  return [
    seoIssue({
      type: 'product-offer-incomplete',
      severity: 'warning',
      source: SOURCES.merchantListing,
      message: `Product markup has offers but lacks ${gaps.join(', ')}, so it cannot show as a merchant listing`,
      context: typeContext(product)
    })
  ]
}

// The fields Google recommends for a merchant listing that the product does not give. Shipping and returns can also
// be on the Organization markup of another page, such as the home page, which a page check cannot see.
function missingDetails({ fact }) {
  const missing = []
  if (!fact.brand) missing.push('brand')
  if (!fact.gtin && !fact.mpn) missing.push('an identifier (gtin or mpn)')
  if (fact.offers.availability.length === 0) missing.push('availability')
  if (!fact.shipping) missing.push('shippingDetails')
  if (!fact.returnPolicy) missing.push('hasMerchantReturnPolicy')
  return missing
}

function detailsMissing(product) {
  const missing = missingDetails(product)
  if (missing.length === 0) return []
  return [
    seoIssue({
      type: 'product-details-missing',
      severity: 'info',
      source: SOURCES.merchantListing,
      message: `Product markup leaves out ${missing.join(', ')}, which Google recommends for merchant listings`,
      context: typeContext(product)
    })
  ]
}

// The names the site goes by: its Organization or store, its WebSite and og:site_name.
function siteNames($, all) {
  const site = all.filter((node) =>
    typesOf(node).some((type) => SITE_TYPES.has(type) || /(Store|Business)$/.test(type))
  )
  return [...site.map((node) => textValue(node.name)), metaContent($, ogSelector('site_name'))].filter(Boolean)
}

// The brand of a store's own products is often the store, so this is only a hint. On Shopify the brand is the
// vendor, which is the store name until it is set.
function brandIsSite($, all, product) {
  const brand = product.fact.brand
  if (!brand || !siteNames($, all).some((name) => sameName(name, brand))) return []
  return [
    seoIssue({
      type: 'product-brand-is-site',
      severity: 'info',
      source: SOURCES.merchantListing,
      message: `The Product brand "${brand}" is the name of the site, not of the maker`,
      context: `"brand": "${brand}"`
    })
  ]
}

// Checks of the Product markup on a page about one product.
export function checkProducts($) {
  const all = pageObjects($)
  const product = soleProduct(byProduct(products(all)))
  if (!product) return []
  return [...offerIncomplete(product), ...detailsMissing(product), ...brandIsSite($, all, product)]
}
