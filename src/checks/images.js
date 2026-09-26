const MAX_CONTEXT = 120;

function snippet($, el) {
  const html = $.html(el);
  return html.length > MAX_CONTEXT ? `${html.slice(0, MAX_CONTEXT - 3)}...` : html;
}

export function checkImages($) {
  const issues = [];
  $('img').each((_, el) => {
    const context = snippet($, el);
    const alt = $(el).attr('alt');
    if (alt === undefined) {
      issues.push({ type: 'missing-alt', severity: 'error', message: 'Image missing alt attribute', context });
    } else if (alt.trim() === '') {
      issues.push({
        type: 'empty-alt',
        severity: 'warning',
        message: 'Image has empty alt (fine if decorative, review)',
        context,
      });
    }
    if ($(el).attr('width') === undefined || $(el).attr('height') === undefined) {
      issues.push({
        type: 'missing-dimensions',
        severity: 'warning',
        message: 'Image missing width/height (causes layout shift)',
        context,
      });
    }
  });
  return issues;
}
