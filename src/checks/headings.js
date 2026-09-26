export function checkHeadings($) {
  const issues = [];
  const headings = $('h1, h2, h3, h4, h5, h6').toArray();
  const h1s = headings.filter((el) => el.tagName === 'h1');

  if (h1s.length === 0) {
    issues.push({ type: 'missing-h1', severity: 'error', message: 'No <h1> on the page', context: '<body>' });
  } else if (h1s.length > 1) {
    issues.push({
      type: 'multiple-h1',
      severity: 'warning',
      message: `${h1s.length} <h1> elements found (expected 1)`,
      context: h1s.map((el) => `<h1>${$(el).text().trim()}</h1>`).join(' '),
    });
  }

  let previous = 0;
  for (const el of headings) {
    const level = Number(el.tagName[1]);
    if (level > previous + 1) {
      issues.push({
        type: 'skipped-heading-level',
        severity: 'warning',
        message: `Heading level skipped: <h${level}> after ${previous ? `<h${previous}>` : 'no heading'}`,
        context: `<h${level}>${$(el).text().trim()}</h${level}>`,
      });
    }
    previous = level;
  }
  return issues;
}
