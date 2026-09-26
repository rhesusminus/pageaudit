const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

export function checkMeta($) {
  const issues = [];

  const title = $('head title').first().text().trim();
  if (!title) {
    issues.push({ type: 'missing-title', severity: 'error', message: 'Missing <title>', context: '<head>' });
  } else if (title.length > TITLE_MAX) {
    issues.push({
      type: 'long-title',
      severity: 'warning',
      message: `Title is ${title.length} chars (over ~${TITLE_MAX}, may be truncated in results)`,
      context: `<title>${title}</title>`,
    });
  }

  const description = $('meta[name="description" i]').first().attr('content')?.trim();
  if (!description) {
    issues.push({
      type: 'missing-description',
      severity: 'error',
      message: 'Missing meta description',
      context: '<head>',
    });
  } else if (description.length > DESCRIPTION_MAX) {
    issues.push({
      type: 'long-description',
      severity: 'warning',
      message: `Meta description is ${description.length} chars (over ~${DESCRIPTION_MAX})`,
      context: `<meta name="description" content="${description}">`,
    });
  }

  if (!$('link[rel="canonical" i]').attr('href')) {
    issues.push({
      type: 'missing-canonical',
      severity: 'warning',
      message: 'Missing canonical link',
      context: '<head>',
    });
  }

  return issues;
}
