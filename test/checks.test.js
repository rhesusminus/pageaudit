import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { checkImages } from '../src/checks/images.js';
import { checkMeta } from '../src/checks/meta.js';
import { checkHeadings } from '../src/checks/headings.js';
import { buildReport, formatSummary } from '../src/report.js';

const types = (issues) => issues.map((i) => i.type);

test('images: missing alt is an error', () => {
  const issues = checkImages(parse('<img src="a.jpg" width="1" height="1">'));
  assert.deepEqual(types(issues), ['missing-alt']);
  assert.equal(issues[0].severity, 'error');
  assert.match(issues[0].context, /a\.jpg/);
});

test('images: empty alt is a warning', () => {
  const issues = checkImages(parse('<img src="a.jpg" alt="" width="1" height="1">'));
  assert.deepEqual(types(issues), ['empty-alt']);
  assert.equal(issues[0].severity, 'warning');
});

test('images: missing dimensions is a warning', () => {
  const issues = checkImages(parse('<img src="a.jpg" alt="ok" width="1">'));
  assert.deepEqual(types(issues), ['missing-dimensions']);
});

test('images: clean image has no issues', () => {
  assert.deepEqual(checkImages(parse('<img src="a.jpg" alt="ok" width="1" height="1">')), []);
});

const goodHead = (title = 'Title', desc = 'Desc') =>
  `<html><head><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="/"></head></html>`;

test('meta: clean head has no issues', () => {
  assert.deepEqual(checkMeta(parse(goodHead())), []);
});

test('meta: missing everything', () => {
  const issues = checkMeta(parse('<html><head></head></html>'));
  assert.deepEqual(types(issues), ['missing-title', 'missing-description', 'missing-canonical']);
  assert.deepEqual(
    issues.map((i) => i.severity),
    ['error', 'error', 'warning'],
  );
});

test('meta: title boundary at 60', () => {
  assert.deepEqual(checkMeta(parse(goodHead('a'.repeat(60)))), []);
  assert.deepEqual(types(checkMeta(parse(goodHead('a'.repeat(61))))), ['long-title']);
});

test('meta: description boundary at 160', () => {
  assert.deepEqual(checkMeta(parse(goodHead('T', 'a'.repeat(160)))), []);
  assert.deepEqual(types(checkMeta(parse(goodHead('T', 'a'.repeat(161))))), ['long-description']);
});

test('headings: none is an error', () => {
  const issues = checkHeadings(parse('<p>hi</p>'));
  assert.deepEqual(types(issues), ['missing-h1']);
  assert.equal(issues[0].severity, 'error');
});

test('headings: multiple h1 is a warning', () => {
  assert.deepEqual(types(checkHeadings(parse('<h1>a</h1><h1>b</h1>'))), ['multiple-h1']);
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
    meta: [{ severity: 'warning' }],
  });
  assert.deepEqual(report.summary, { errors: 1, warnings: 2 });
  assert.match(formatSummary(report), /1 error, 2 warnings/);
});
