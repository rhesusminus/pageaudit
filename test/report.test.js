import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import chalk from 'chalk';
import { buildReport, formatTable } from '../src/report.js';

const CONTEXT = '<img src="/averyveryverylongimagefilename-that-goes-on-and-on-and-on/hero-banner-final-v2.png">';

const issue = (severity, category, message, context) => ({ type: 't', severity, category, message, context });

// chalk disables colors when stdout is not a TTY, which hides ANSI-related
// wrapping bugs, so force them on for the duration of the render.
function renderColored(categories) {
  const previous = chalk.level;
  chalk.level = 1;
  try {
    const colored = formatTable(buildReport('http://x', categories));
    assert.match(colored, /\x1b\[/, 'expected colored output');
    return colored;
  } finally {
    chalk.level = previous;
  }
}

const categories = {
  images: [
    issue('error', 'accessibility', 'Image missing alt attribute', CONTEXT),
    issue('warning', 'performance', 'Image missing width/height (causes layout shift)', CONTEXT),
    issue('info', 'accessibility', 'Image has empty alt (correct if decorative, review)', '<img alt="">'),
  ],
  meta: [],
};

test('formatTable: colored cells are never split or leak escape fragments', () => {
  const plain = stripVTControlCharacters(renderColored(categories));
  assert.doesNotMatch(plain, /\x1b|\[\d+m/, 'stray escape fragment');
  for (const word of ['error', 'warning', 'info', 'accessibility', 'performance']) {
    assert.match(plain, new RegExp(`│ ${word} +│`), `${word} was split`);
  }
});

test('formatTable: context wraps at the full column width and keeps its text', () => {
  const plain = stripVTControlCharacters(renderColored(categories));
  const rows = plain.split('\n').filter((l) => l.startsWith('│'));
  const contextLines = rows.map((l) => l.split('│')[4].slice(1, -1).trimEnd());
  assert.ok(contextLines.every((l) => l.length <= 44));
  assert.equal(contextLines.filter((l) => l.length === 44).length, 4);
  assert.equal(contextLines.join('').split(CONTEXT).length - 1, 2);
});

test('formatTable: all table lines have equal width', () => {
  const plain = stripVTControlCharacters(renderColored(categories));
  const widths = new Set(plain.split('\n').filter((l) => /^[│┌├└]/.test(l)).map((l) => l.length));
  assert.equal(widths.size, 1);
});

test('formatTable: fits the terminal width, down to 80 columns', () => {
  for (const columns of [80, 100]) {
    const previous = chalk.level;
    chalk.level = 1;
    try {
      const plain = stripVTControlCharacters(formatTable(buildReport('http://x', categories), columns));
      const widths = new Set(plain.split('\n').filter((l) => /^[│┌├└]/.test(l)).map((l) => l.length));
      assert.deepEqual([...widths], [columns]);
    } finally {
      chalk.level = previous;
    }
  }
});

test('formatTable: wide characters wrap by display width without losing text', () => {
  const title = `<title>${'日本語のタイトル'.repeat(8)} 😀😀😀 emoji 🎉🎉</title>`;
  const previous = chalk.level;
  chalk.level = 1;
  try {
    const plain = stripVTControlCharacters(
      formatTable(buildReport('http://x', { meta: [issue('warning', 'seo', 'Title is long', title)] }), 80),
    );
    assert.doesNotMatch(plain, /…/, 'text was clipped');
    const context = plain
      .split('\n')
      .filter((l) => l.startsWith('│'))
      .slice(1)
      .map((l) => l.split('│')[4].slice(1).trimEnd())
      .join('');
    assert.equal(context.replaceAll(' ', ''), title.replaceAll(' ', ''));
  } finally {
    chalk.level = previous;
  }
});
