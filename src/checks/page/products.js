import { MAX_URL } from '../../text.js'
import { idIndex, nameOf, pageObjects, text, textValue, typesOf } from './json-ld.js'

const MAX_PRODUCTS = 10
const MAX_AVAILABILITY = 5
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
// `id` and `url` to tell two nodes of one product apart from two products, and `offerTypes`.
function describe(node, variants, nodes, byId) {
  const members = [node, ...variants]
  const offers = members.flatMap((member) => objects(member.offers))
  // Shopify themes write the sku and barcode of each variant on its offer.
  const withOffers = [...members, ...offers]
  return {
    id: idOf(node),
    url: textValue(node.url, MAX_URL),
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
// or in its @graph are read, so the products of an ItemList on a collection page are not.
function products($) {
  const all = pageObjects($)
  const nodes = all.filter((node) => typesOf(node).length > 0)
  const byId = idIndex(all)
  const groups = variantsByGroup(nodes, byId)
  return nodes
    .filter((node) => isProduct(node) && !isVariant(node, groups, byId))
    .map((node) => describe(node, groups.get(node) ?? [], nodes, byId))
}

// What the Product markup of the page says, at most MAX_PRODUCTS products.
export const pageProducts = ($) =>
  products($)
    .slice(0, MAX_PRODUCTS)
    .map((product) => product.fact)
