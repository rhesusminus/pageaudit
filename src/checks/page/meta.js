import { SOURCES } from '../../sources.js';
import { charCount, collapseWhitespace } from '../../text.js';
import { truncate } from '../snippet.js';

// Heuristics: Google gives no numeric limits, truncation depends on pixel width.
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;
const DESCRIPTION_MIN = 70;

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

// The document title, also when a body-only element in <head> pushed it into <body>, but never an SVG <title>.
export const titleElement = ($) => $('title').filter((_, el) => !$(el).closest('svg').length).first();

// Every meta description, whitespace collapsed. Only the first non-empty one is used.
export const descriptionValues = ($) =>
  $('meta[name="description" i]')
    .toArray()
    .map((el) => collapseWhitespace($(el).attr('content') ?? ''));

// Google only reads canonical links inside <head>.
export const canonicalLinks = ($) => $('head link[rel~="canonical" i]').toArray();

export function checkMeta($) {
  const issues = [];
  const add = (issue) => issues.push({ category: 'seo', ...issue, context: truncate(issue.context) });

  const titleEl = titleElement($);
  const title = collapseWhitespace(titleEl.text());
  if (!titleEl.length) {
    add({ type: 'missing-title', severity: 'error', source: SOURCES.title, message: 'Missing <title>', context: '<head>' });
  } else if (!title) {
    add({ type: 'empty-title', severity: 'error', source: SOURCES.title, message: 'Empty <title>', context: '<title></title>' });
  } else if (charCount(title) > TITLE_MAX) {
    add({
      type: 'long-title',
      severity: 'warning',
      source: SOURCES.title,
      message: `Title is ${charCount(title)} chars (over ~${TITLE_MAX}, may be truncated in results)`,
      context: `<title>${title}</title>`,
    });
  }

  const descriptions = descriptionValues($);
  const description = descriptions.find(Boolean);
  if (descriptions.length > 1) {
    add({
      type: 'multiple-descriptions',
      severity: 'warning',
      source: SOURCES.snippet,
      message: `${descriptions.length} meta descriptions found (only one is used)`,
      context: descriptions.map((d) => `<meta name="description" content="${d}">`).join(' '),
    });
  }
  if (!description) {
    add({
      type: 'missing-description',
      severity: 'warning',
      source: SOURCES.snippet,
      message: 'Missing meta description (Google may build the snippet from page content instead)',
      context: '<head>',
    });
  } else if (charCount(description) > DESCRIPTION_MAX) {
    add({
      type: 'long-description',
      severity: 'info',
      source: SOURCES.snippet,
      message: `Meta description is ${charCount(description)} chars (over ~${DESCRIPTION_MAX}, may be truncated)`,
      context: `<meta name="description" content="${description}">`,
    });
  } else if (charCount(description) < DESCRIPTION_MIN) {
    add({
      type: 'short-description',
      severity: 'info',
      source: SOURCES.snippet,
      message: `Meta description is only ${charCount(description)} chars (under ~${DESCRIPTION_MIN}, may be too vague)`,
      context: `<meta name="description" content="${description}">`,
    });
  }

  issues.push(...checkCanonical($));
  return issues;
}

function checkCanonical($) {
  const issues = [];
  const add = (issue) =>
    issues.push({
      category: 'seo',
      severity: 'warning',
      source: SOURCES.canonical,
      ...issue,
      context: truncate(issue.context),
    });

  const inHead = canonicalLinks($);
  const anywhere = $('link[rel~="canonical" i]').toArray();
  const outsideHead = anywhere.filter((el) => !inHead.includes(el));

  if (inHead.length === 0) {
    add({
      type: 'missing-canonical',
      message: outsideHead.length
        ? 'Canonical link is outside <head> (Google ignores it there)'
        : 'Missing canonical link',
      context: outsideHead.length ? $.html(outsideHead[0]) : '<head>',
    });
    return issues;
  }

  if (inHead.length > 1) {
    const hrefs = new Set(inHead.map((el) => ($(el).attr('href') ?? '').trim()));
    const identical = hrefs.size === 1;
    add({
      type: 'multiple-canonicals',
      severity: identical ? 'info' : 'warning',
      message: identical
        ? `${inHead.length} identical canonical links found (redundant, keep only one)`
        : `${inHead.length} canonical links found (conflicting signals)`,
      context: inHead.map((el) => $.html(el)).join(' '),
    });
  }
  for (const el of inHead) {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href) {
      add({ type: 'empty-canonical', message: 'Canonical link has no href', context: $.html(el) });
      continue;
    }
    if (!ABSOLUTE_URL.test(href)) {
      add({
        type: 'relative-canonical',
        message: 'Canonical URL is relative (Google recommends absolute URLs)',
        context: $.html(el),
      });
    }
    if (href.includes('#')) {
      add({
        type: 'canonical-fragment',
        message: 'Canonical URL contains a fragment (generally not supported)',
        context: $.html(el),
      });
    }
  }
  return issues;
}
