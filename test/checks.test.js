import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { checkImages } from '../src/checks/page/images.js';
import { checkMeta } from '../src/checks/page/meta.js';
import { checkHeadings } from '../src/checks/page/headings.js';
import { truncate } from '../src/checks/snippet.js';
import { buildReport, formatSummary } from '../src/report.js';

const types = (issues) => issues.map((i) => i.type);

test('images: missing alt is an error', () => {
  const issues = checkImages(parse('<img src="a.jpg" width="1" height="1">'));
  assert.deepEqual(types(issues), ['missing-alt']);
  assert.equal(issues[0].severity, 'error');
  assert.match(issues[0].context, /a\.jpg/);
});

test('images: empty alt is info', () => {
  const issues = checkImages(parse('<img src="a.jpg" alt="" width="1" height="1">'));
  assert.deepEqual(types(issues), ['empty-alt']);
  assert.equal(issues[0].severity, 'info');
});

test('images: empty alt as the only content of a link is an error', () => {
  const issues = checkImages(parse('<a href="/"><img src="a.svg" alt="" width="1" height="1"></a>'));
  assert.deepEqual(types(issues), ['empty-alt-in-link']);
  assert.equal(issues[0].severity, 'error');
});

test('images: empty alt next to link text or with aria-label is fine', () => {
  const withText = '<a href="/"><img src="a.svg" alt="" width="1" height="1"> Home</a>';
  const withLabel = '<a href="/" aria-label="Home"><img src="a.svg" alt="" width="1" height="1"></a>';
  assert.deepEqual(types(checkImages(parse(withText))), ['empty-alt']);
  assert.deepEqual(types(checkImages(parse(withLabel))), ['empty-alt']);
});

test('images: generic file names are flagged, descriptive ones are not', () => {
  const generic = (src) => types(checkImages(parse(`<img src="${src}" alt="x" width="1" height="1">`)));
  assert.deepEqual(generic('/a/IMG00023.JPG'), ['generic-filename']);
  assert.deepEqual(generic('/a/image1.jpg'), ['generic-filename']);
  assert.deepEqual(generic('/a/photo.png?v=2'), ['generic-filename']);
  assert.deepEqual(generic('/a/my-new-black-kitten.jpg'), []);
  assert.deepEqual(generic('data:image/gif;base64,R0lGOD'), []);
});

test('images: alt repeating the file name is a warning', () => {
  const issues = checkImages(parse('<img src="/a/puppy.jpg" alt="Puppy.JPG" width="1" height="1">'));
  assert.deepEqual(types(issues), ['alt-is-filename']);
  assert.equal(issues[0].severity, 'warning');
});

test('images: missing src is flagged unless srcset is present', () => {
  assert.deepEqual(types(checkImages(parse('<img alt="x" width="1" height="1">'))), ['missing-src']);
  assert.deepEqual(types(checkImages(parse('<img srcset="a.jpg 1x" alt="x" width="1" height="1">'))), []);
});

test('images: missing dimensions is a warning', () => {
  const issues = checkImages(parse('<img src="a.jpg" alt="ok" width="1">'));
  assert.deepEqual(types(issues), ['missing-dimensions']);
});

test('images: clean image has no issues', () => {
  assert.deepEqual(checkImages(parse('<img src="a.jpg" alt="ok" width="1" height="1">')), []);
});

const goodHead = (title = 'Title', desc = 'A description that is comfortably long enough to pass the short check.') =>
  `<html><head><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="https://example.com/"></head></html>`;

test('meta: clean head has no issues', () => {
  assert.deepEqual(checkMeta(parse(goodHead())), []);
});

test('meta: missing everything', () => {
  const issues = checkMeta(parse('<html><head></head></html>'));
  assert.deepEqual(types(issues), ['missing-title', 'missing-description', 'missing-canonical']);
  assert.deepEqual(
    issues.map((i) => i.severity),
    ['error', 'warning', 'warning'],
  );
});

test('meta: empty title is an error', () => {
  const issues = checkMeta(parse(goodHead('  ')));
  assert.deepEqual(types(issues), ['empty-title']);
  assert.equal(issues[0].severity, 'error');
});

test('meta: title after a body-only element in head is still found', () => {
  const desc = 'A description that is comfortably long enough to pass the short check.';
  const html = `<html><head><meta charset="utf-8"><div id="x"></div><title>My page</title><meta name="description" content="${desc}"><link rel="canonical" href="https://example.com/"></head><body></body></html>`;
  assert.ok(!types(checkMeta(parse(html))).includes('missing-title'));
});

test('meta: a title inside svg is not the page title', () => {
  const html = '<html><head></head><body><svg><title>Icon</title></svg></body></html>';
  assert.ok(types(checkMeta(parse(html))).includes('missing-title'));
});

test('meta: short description is info', () => {
  const issues = checkMeta(parse(goodHead('T', 'Too short')));
  assert.deepEqual(types(issues), ['short-description']);
  assert.equal(issues[0].severity, 'info');
});

test('meta: canonical must be in head, absolute, unique and without fragment', () => {
  const head = (links) => `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}">${links}</head><body></body></html>`;
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical" href="https://a.com/x">')))), []);
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical" href="/x">')))), ['relative-canonical']);
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical" href="https://a.com/x#y">')))), ['canonical-fragment']);
  assert.deepEqual(types(checkMeta(parse(head('<link rel="canonical">')))), ['empty-canonical']);
  assert.deepEqual(
    types(checkMeta(parse(head('<link rel="canonical" href="https://a.com/x"><link rel="canonical" href="https://a.com/y">')))),
    ['multiple-canonicals'],
  );
});

test('meta: identical duplicate canonicals are redundant (info), differing ones conflict (warning)', () => {
  const head = (links) => `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}">${links}</head><body></body></html>`;
  const same = checkMeta(parse(head('<link rel="canonical" href="https://a.com/"><link rel="canonical" href=" https://a.com/ ">')));
  assert.deepEqual(types(same), ['multiple-canonicals']);
  assert.equal(same[0].severity, 'info');
  assert.match(same[0].message, /redundant/i);
  assert.doesNotMatch(same[0].message, /conflicting/i);
  const diff = checkMeta(parse(head('<link rel="canonical" href="https://a.com/x"><link rel="canonical" href="https://a.com/y">')));
  assert.equal(diff[0].severity, 'warning');
  assert.match(diff[0].message, /conflicting signals/);
});

test('meta: canonical is found when rel has several tokens or odd case', () => {
  const head = (link) => `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}">${link}</head></html>`;
  assert.deepEqual(checkMeta(parse(head('<link rel="canonical nofollow" href="https://a.com/x">'))), []);
  assert.deepEqual(checkMeta(parse(head('<link rel="  Canonical " href="https://a.com/x">'))), []);
});

test('meta: an empty description does not hide a later real one, but still counts as a duplicate', () => {
  const d = 'd'.repeat(80);
  const html = `<html><head><title>T</title><meta name="description" content=""><meta name="description" content="${d}"><link rel="canonical" href="https://a.com/"></head></html>`;
  assert.deepEqual(types(checkMeta(parse(html))), ['multiple-descriptions']);
});

test('meta: several non-empty descriptions are flagged', () => {
  const d = 'd'.repeat(80);
  const html = `<html><head><title>T</title><meta name="description" content="${d}"><meta name="description" content="${d}x"><link rel="canonical" href="https://a.com/"></head></html>`;
  const issues = checkMeta(parse(html));
  assert.deepEqual(types(issues), ['multiple-descriptions']);
  assert.equal(issues[0].severity, 'warning');
});

test('meta: canonical in body is reported as missing from head', () => {
  const html = `<html><head><title>T</title><meta name="description" content="${'d'.repeat(80)}"></head><body><link rel="canonical" href="https://a.com/x"></body></html>`;
  const issues = checkMeta(parse(html));
  assert.deepEqual(types(issues), ['missing-canonical']);
  assert.match(issues[0].message, /outside <head>/);
});

test('meta: title boundary at 60', () => {
  assert.deepEqual(checkMeta(parse(goodHead('a'.repeat(60)))), []);
  assert.deepEqual(types(checkMeta(parse(goodHead('a'.repeat(61))))), ['long-title']);
});

test('meta: description boundaries at 70 and 160', () => {
  assert.deepEqual(checkMeta(parse(goodHead('T', 'a'.repeat(160)))), []);
  assert.deepEqual(types(checkMeta(parse(goodHead('T', 'a'.repeat(161))))), ['long-description']);
  assert.deepEqual(checkMeta(parse(goodHead('T', 'a'.repeat(70)))), []);
  assert.deepEqual(types(checkMeta(parse(goodHead('T', 'a'.repeat(69))))), ['short-description']);
});

test('headings: no h1 is a warning', () => {
  const issues = checkHeadings(parse('<p>hi</p>'));
  assert.deepEqual(types(issues), ['missing-h1']);
  assert.equal(issues[0].severity, 'warning');
});

test('headings: multiple h1 is info', () => {
  const issues = checkHeadings(parse('<h1>a</h1><h1>b</h1>'));
  assert.deepEqual(types(issues), ['multiple-h1']);
  assert.equal(issues[0].severity, 'info');
});

test('headings: empty heading is flagged unless it has an image with alt or aria-label', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1> </h1>'))), ['empty-heading']);
  assert.deepEqual(types(checkHeadings(parse('<h1><img src="a.png" alt="Logo"></h1>'))), []);
  assert.deepEqual(types(checkHeadings(parse('<h1 aria-label="Title"></h1>'))), []);
  assert.deepEqual(types(checkHeadings(parse('<h1 aria-labelledby="t"></h1><p id="t">Title</p>'))), []);
});

test('headings: skipped level is a warning', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1>a</h1><h3>b</h3>'))), ['skipped-heading-level']);
});

test('headings: h3 before any h2 is flagged, going back up is fine', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1>a</h1><h2>b</h2><h3>c</h3><h2>d</h2>'))), []);
  assert.deepEqual(types(checkHeadings(parse('<h3>c</h3><h1>a</h1>'))), ['skipped-heading-level']);
});

test('report: summary counts by severity', () => {
  const report = buildReport('http://x', {
    images: [{ severity: 'error' }, { severity: 'warning' }],
    meta: [{ severity: 'warning' }, { severity: 'info' }],
  });
  assert.deepEqual(report.summary, { errors: 1, warnings: 2, infos: 1 });
  assert.match(stripVTControlCharacters(formatSummary(report)), /1 error, 2 warnings, 1 info/);
});

const fixture = (name) => parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const allTypes = ($) => [...checkImages($), ...checkMeta($), ...checkHeadings($)].map((i) => i.type).sort();

test('fixture good.html: no issues', () => {
  assert.deepEqual(allTypes(fixture('good.html')), []);
});

test('fixture bad-overlong.html: overlong, duplicate and skipped issues', () => {
  assert.deepEqual(
    allTypes(fixture('bad-overlong.html')),
    [
      'empty-alt',
      'long-description',
      'long-title',
      'missing-alt',
      'missing-canonical',
      'missing-dimensions',
      'multiple-h1',
      'skipped-heading-level',
    ],
  );
});

test('every issue has severity, category and source', () => {
  for (const name of ['bad-overlong.html', 'bad-missing.html', 'bad-canonical.html', 'bad-images.html', 'bad-empty.html']) {
    for (const issue of [...checkImages(fixture(name)), ...checkMeta(fixture(name)), ...checkHeadings(fixture(name))]) {
      assert.match(issue.severity, /^(error|warning|info)$/, issue.type);
      assert.match(issue.category, /^(seo|accessibility|performance|best-practice)$/, issue.type);
      assert.match(issue.source, /^https:\/\//, issue.type);
    }
  }
});

test('fixture bad-canonical.html: relative, fragment and multiple canonicals', () => {
  assert.deepEqual(allTypes(fixture('bad-canonical.html')), [
    'canonical-fragment',
    'multiple-canonicals',
    'relative-canonical',
  ]);
});

test('fixture bad-images.html: generic name, alt is filename, missing src, empty alt in link', () => {
  assert.deepEqual(allTypes(fixture('bad-images.html')), [
    'alt-is-filename',
    'empty-alt',
    'empty-alt-in-link',
    'generic-filename',
    'missing-src',
  ]);
});

test('fixture bad-empty.html: empty title, short description, empty headings', () => {
  assert.deepEqual(allTypes(fixture('bad-empty.html')), [
    'empty-alt',
    'empty-heading',
    'empty-heading',
    'empty-title',
    'short-description',
  ]);
});

test('fixture bad-missing.html: missing title, description, canonical and h1', () => {
  assert.deepEqual(allTypes(fixture('bad-missing.html')), [
    'missing-canonical',
    'missing-description',
    'missing-h1',
    'missing-title',
  ]);
});

const TEMPLATE_MARKUP =
  '<template><h4></h4><img src="a.jpg"><template><h6></h6><img src="b.jpg"></template></template>';

test('parse: inert <template> content is dropped, including nested templates', () => {
  const $ = parse(`<body><h1>Title</h1>${TEMPLATE_MARKUP}</body>`);
  assert.equal($('template').length, 0);
  assert.equal($('img').length, 0);
  assert.equal($('h4, h6').length, 0);
});

test('images: images inside <template> are not audited', () => {
  const html = `<img src="ok.jpg" alt="A product" width="1" height="1">${TEMPLATE_MARKUP}`;
  assert.deepEqual(checkImages(parse(html)), []);
});

test('headings: headings inside <template> are not audited', () => {
  const html = `<h1>Title</h1><h2>Sub</h2>${TEMPLATE_MARKUP}`;
  assert.deepEqual(checkHeadings(parse(html)), []);
});

test('meta: title length ignores whitespace runs from multi-line markup', () => {
  const title = '\n      Gentle Shampoo for all\n      hair types |\n      Example Store Online\n    ';
  assert.deepEqual(types(checkMeta(parse(goodHead(title)))), []);
  const long = `\n   ${'word '.repeat(13)}\n   end\n `;
  const issues = checkMeta(parse(goodHead(long)));
  assert.deepEqual(types(issues), ['long-title']);
  assert.match(issues[0].message, /Title is 68 chars/);
  assert.equal(issues[0].context, `<title>${'word '.repeat(13)}end</title>`);
});

test('meta: description length and context ignore whitespace runs', () => {
  const words = 'a'.repeat(50);
  const spread = `\n     ${words}\n     ${words}\n     ${words}\n   `;
  assert.deepEqual(types(checkMeta(parse(goodHead('T', spread)))), []);
  const short = checkMeta(parse(goodHead('T', '\n    short\n    text\n  ')));
  assert.deepEqual(types(short), ['short-description']);
  assert.match(short[0].message, /only 10 chars/);
  assert.equal(short[0].context, '<meta name="description" content="short text">');
});

test('headings: contexts collapse whitespace', () => {
  const issues = checkHeadings(parse('<body><h1>Line one\n   of heading</h1><h1>Two\n  h1</h1><h4>Skipped\n    level</h4></body>'));
  assert.equal(issues.find((i) => i.type === 'multiple-h1').context, '<h1>Line one of heading</h1> <h1>Two h1</h1>');
  assert.equal(issues.find((i) => i.type === 'skipped-heading-level').context, '<h4>Skipped level</h4>');
});

test('headings: empty heading context is truncated for large markup', () => {
  const paths = '<path d="M0 0L10 10Z"/>'.repeat(200);
  const issues = checkHeadings(parse(`<h1>Title</h1><h2><svg>${paths}</svg></h2>`));
  const empty = issues.find((i) => i.type === 'empty-heading');
  assert.ok(empty.context.length <= 120);
  assert.ok(empty.context.endsWith('...'));
});

test('meta: long title, description and canonical contexts are truncated', () => {
  const long = 'x'.repeat(500);
  const html = `<html><head><title>${long}</title><meta name="description" content="${long}"><link rel="canonical" href="/${long}"></head></html>`;
  const issues = checkMeta(parse(html));
  assert.ok(issues.length > 0);
  for (const issue of issues) assert.ok(issue.context.length <= 120, `${issue.type}: ${issue.context.length}`);
});

test('headings: multiple-h1 and skipped-level contexts are truncated for long text', () => {
  const long = 'x'.repeat(300);
  const issues = checkHeadings(parse(`<h1>${long}</h1><h1>${long}</h1><h4>${long}</h4>`));
  for (const type of ['multiple-h1', 'skipped-heading-level']) {
    const { context } = issues.find((i) => i.type === type);
    assert.equal(context.length, 120);
    assert.ok(context.endsWith('...'));
  }
});

test('snippet: truncate never splits a surrogate pair', () => {
  const text = `${'a'.repeat(116)}😀${'b'.repeat(10)}`;
  const cut = truncate(text);
  assert.equal(cut, `${'a'.repeat(116)}😀...`);
  assert.doesNotMatch(cut, /[\ud800-\udbff](?![\udc00-\udfff])/);
});

test('headings: empty heading context collapses markup whitespace', () => {
  const issues = checkHeadings(parse('<h1>x</h1><h2>\n      <span></span>\n    </h2>'));
  assert.equal(issues.find((i) => i.type === 'empty-heading').context, '<h2> <span></span> </h2>');
});

test('meta: title and description lengths count characters, not UTF-16 code units', () => {
  const title = `${'a'.repeat(55)}😀😀😀😀😀`;
  assert.deepEqual(types(checkMeta(parse(goodHead(title)))), []);
  const issues = checkMeta(parse(goodHead(`${title}b`)));
  assert.match(issues[0].message, /Title is 61 chars/);
  const short = checkMeta(parse(goodHead('T', '😀'.repeat(10))));
  assert.match(short[0].message, /only 10 chars/);
});
