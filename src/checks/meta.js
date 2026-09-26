import { SOURCES } from '../sources.js';

// Heuristics: Google gives no numeric limits, truncation depends on pixel width.
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;
const DESCRIPTION_MIN = 70;

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

export function checkMeta($) {
  const issues = [];
  const add = (issue) => issues.push({ category: 'seo', ...issue });

  const titleEl = $('head title').first();
  const title = titleEl.text().trim();
  if (!titleEl.length) {
    add({ type: 'missing-title', severity: 'error', source: SOURCES.title, message: 'Missing <title>', context: '<head>' });
  } else if (!title) {
    add({ type: 'empty-title', severity: 'error', source: SOURCES.title, message: 'Empty <title>', context: '<title></title>' });
  } else if (title.length > TITLE_MAX) {
    add({
      type: 'long-title',
      severity: 'warning',
      source: SOURCES.title,
      message: `Title is ${title.length} chars (over ~${TITLE_MAX}, may be truncated in results)`,
      context: `<title>${title}</title>`,
    });
  }

  const description = $('meta[name="description" i]').first().attr('content')?.trim();
  if (!description) {
    add({
      type: 'missing-description',
      severity: 'warning',
      source: SOURCES.snippet,
      message: 'Missing meta description (Google may build the snippet from page content instead)',
      context: '<head>',
    });
  } else if (description.length > DESCRIPTION_MAX) {
    add({
      type: 'long-description',
      severity: 'info',
      source: SOURCES.snippet,
      message: `Meta description is ${description.length} chars (over ~${DESCRIPTION_MAX}, may be truncated)`,
      context: `<meta name="description" content="${description}">`,
    });
  } else if (description.length < DESCRIPTION_MIN) {
    add({
      type: 'short-description',
      severity: 'info',
      source: SOURCES.snippet,
      message: `Meta description is only ${description.length} chars (under ~${DESCRIPTION_MIN}, may be too vague)`,
      context: `<meta name="description" content="${description}">`,
    });
  }

  issues.push(...checkCanonical($));
  return issues;
}

function checkCanonical($) {
  const issues = [];
  const add = (issue) =>
    issues.push({ category: 'seo', severity: 'warning', source: SOURCES.canonical, ...issue });

  const inHead = $('head link[rel="canonical" i]').toArray();
  const anywhere = $('link[rel="canonical" i]').toArray();
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
    add({
      type: 'multiple-canonicals',
      message: `${inHead.length} canonical links found (conflicting signals)`,
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
