import * as cheerio from 'cheerio';

export function parse(html) {
  return cheerio.load(html);
}
