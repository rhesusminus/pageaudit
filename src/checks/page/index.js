import { collapseWhitespace } from '../../text.js';
import { checkHeadings } from './headings.js';
import { checkImages } from './images.js';
import { canonicalLinks, checkMeta, descriptionValues, titleElement } from './meta.js';

export { checkFetchError, checkResponse } from './response.js';

// Every check that looks at the parsed HTML of one page.
export const checkHtml = ($) => [...checkImages($), ...checkMeta($), ...checkHeadings($)];

function absolute(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// The values the site checks compare across pages. Empty values are null so a
// missing title is never reported as a duplicate of another missing title.
export function extractFacts($, finalUrl) {
  const href = canonicalLinks($)
    .map((el) => ($(el).attr('href') ?? '').trim())
    .find(Boolean);
  // Relative URLs resolve against the first <base href>, like in a browser.
  const baseHref = ($('base[href]').first().attr('href') ?? '').trim();
  const baseUrl = (baseHref && absolute(baseHref, finalUrl)) || finalUrl;
  return {
    title: collapseWhitespace(titleElement($).text()) || null,
    description: descriptionValues($).find(Boolean) ?? null,
    h1s: [...new Set($('h1').toArray().map((el) => collapseWhitespace($(el).text())).filter(Boolean))],
    canonical: href ? absolute(href, baseUrl) : null,
  };
}
