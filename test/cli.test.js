import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.js';
import { FIXTURE_HOST, mockFixtureFetch } from './helpers/fixture-fetch.js';

// Runs the CLI against a fixture page and captures what it prints.
async function runCli(t, args) {
  mockFixtureFetch(t);
  const stdout = [];
  const stderr = [];
  t.mock.method(console, 'log', (...a) => stdout.push(a.join(' ')));
  t.mock.method(console, 'error', (...a) => stderr.push(a.join(' ')));
  const code = await run(args);
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const issueTypes = (report) => Object.values(report.categories).flat().map((i) => i.type).sort();

test('cli: good.html has no issues and exits 0', async (t) => {
  const { code, stdout } = await runCli(t, [`${FIXTURE_HOST}/good.html`, '--json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 0);
  assert.deepEqual(report.summary, { errors: 0, warnings: 0, infos: 0 });
  assert.deepEqual(issueTypes(report), []);
});

test('cli: bad-overlong.html reports its issues and exits 1', async (t) => {
  const { code, stdout } = await runCli(t, [`${FIXTURE_HOST}/bad-overlong.html`, '--json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.deepEqual(report.summary, { errors: 1, warnings: 4, infos: 3 });
  assert.equal(report.categories.images.length, 3);
  assert.equal(report.categories.meta.length, 3);
  assert.equal(report.categories.headings.length, 2);
});

test('cli: bad-missing.html reports missing elements and exits 1', async (t) => {
  const { code, stdout } = await runCli(t, [`${FIXTURE_HOST}/bad-missing.html`, '--json']);
  const report = JSON.parse(stdout);
  assert.equal(code, 1);
  assert.deepEqual(report.summary, { errors: 1, warnings: 3, infos: 0 });
  assert.deepEqual(issueTypes(report), ['missing-canonical', 'missing-description', 'missing-h1', 'missing-title']);
});

test('cli: HTTP 404 exits 2 with a message', async (t) => {
  const { code, stderr } = await runCli(t, [`${FIXTURE_HOST}/nope.html`, '--json']);
  assert.equal(code, 2);
  assert.match(stderr, /HTTP 404/);
});

test('cli: non-HTML content-type exits 2', async (t) => {
  const { code, stderr } = await runCli(t, [`${FIXTURE_HOST}/not-html`, '--json']);
  assert.equal(code, 2);
  assert.match(stderr, /Not an HTML page/);
});

test('cli: timeout exits 2', async (t) => {
  const { code, stderr } = await runCli(t, [`${FIXTURE_HOST}/timeout`, '--json']);
  assert.equal(code, 2);
  assert.match(stderr, /timed out/);
});

test('cli: unreachable host exits 2', async (t) => {
  const { code, stderr } = await runCli(t, ['https://elsewhere.test/', '--json']);
  assert.equal(code, 2);
  assert.match(stderr, /ENOTFOUND/);
});

test('cli: invalid URL and missing argument exit 2', async (t) => {
  assert.equal((await runCli(t, ['not a url', '--json'])).code, 2);
  assert.equal((await runCli(t, [])).code, 2);
});
