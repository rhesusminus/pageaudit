import * as cheerio from 'cheerio'

export function parse(html) {
  const $ = cheerio.load(html)
  // <template> content is inert (never rendered), but cheerio exposes it to selectors.
  // Removing the element also removes any nested templates.
  $('template').remove()
  return $
}
