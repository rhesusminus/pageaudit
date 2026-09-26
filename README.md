# pageaudit

> **Note:** this project is my testing ground for agentic coding. It was planned and built together with an AI coding agent (Claude Code), from a plan written in a chat (`docs/seo-harness-plan.md`) through implementation, tests and git workflow. Treat it as an experiment, not a polished product.

A small Node.js CLI that fetches a single URL, parses the static HTML and reports basic SEO/HTML issues in three categories: images, meta tags and headings.

## Usage

Requires Node 24 (see `.nvmrc`).

```sh
npm install
node bin/pageaudit.js <url>          # color-coded table
node bin/pageaudit.js <url> --json   # raw JSON report
npm test
```

`--json` is also the default whenever stdout is not a TTY (for example when piped), and the spinner is disabled in that case. The `pageaudit` bin is declared in `package.json`, so `npm link` makes it available as `pageaudit <url>`.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | No errors (warnings are allowed) |
| 1 | At least one error found |
| 2 | Usage error or the page could not be fetched |

## Checks

| Category | Rule | Severity |
| -------- | ---- | -------- |
| Images | `missing-alt`: no `alt` attribute | error |
| Images | `empty-alt`: `alt=""` (valid for decorative images, flagged for review) | warning |
| Images | `missing-dimensions`: no `width` or `height` (layout shift) | warning |
| Meta | `missing-title` | error |
| Meta | `long-title`: over 60 characters | warning |
| Meta | `missing-description` | error |
| Meta | `long-description`: over 160 characters | warning |
| Meta | `missing-canonical` | warning |
| Headings | `missing-h1` | error |
| Headings | `multiple-h1` | warning |
| Headings | `skipped-heading-level`: e.g. `<h3>` with no preceding `<h2>` | warning |

The 60 and 160 character limits are SERP truncation heuristics, not official Google rules.

## Architecture

```
bin/pageaudit.js        entry point, calls run() and sets the exit code
src/
  cli.js                arg parsing, spinner, wires the pipeline together
  fetch.js              fetchHtml(url): URL validation, timeout, status and content-type checks
  parse.js              parse(html): Cheerio DOM
  checks/
    images.js           one module per category, each returns an array of issues
    meta.js
    headings.js
  report.js             buildReport() aggregates issues, formatTable()/formatSummary() render them
test/
  checks.test.js        unit tests for each check and the report summary
  cli.test.js           end-to-end tests of run() against the fixtures
  fixtures/             good.html, bad-overlong.html, bad-missing.html
  helpers/fixture-fetch.js   mocked fetch that serves the fixtures
docs/seo-harness-plan.md     the original plan this was built from
```

Pipeline: `fetchHtml` -> `parse` -> `checkImages` / `checkMeta` / `checkHeadings` -> `buildReport` -> table or JSON.

Every check returns issues in the same shape, so `report.js` has no per-check special cases:

```js
{
  type: 'missing-alt',            // machine-readable identifier
  severity: 'error',              // 'error' | 'warning'
  message: 'Image missing alt attribute',
  context: '<img src="/a.jpg">'   // snippet for locating the problem
}
```

The JSON report is `{ url, categories: { images, meta, headings }, summary: { errors, warnings } }`.

## Testing

Tests use the built-in `node:test` runner with no extra dependencies.

- Unit tests cover each rule firing, not firing and the length boundaries.
- Three HTML fixtures cover the positive and negative cases: `good.html` has no issues, `bad-overlong.html` triggers the overlong, duplicate and skipped-level rules plus all image rules, and `bad-missing.html` triggers the missing title, description, canonical and h1 rules. Two bad files are needed because a title cannot be both missing and too long.
- CLI tests call `run()` with `globalThis.fetch` mocked (`test/helpers/fixture-fetch.js`). Requests to `https://fixtures.test/<name>` are served from `test/fixtures/<name>`, and `/timeout`, `/not-html` and unknown names simulate failures. This exercises the real fetch, parse, check, report and exit-code path without network access.

## Limitations and out of scope

- Only the raw HTML from the initial fetch is inspected (Cheerio, no JavaScript execution), so client-side rendered content is not seen. The fix would be swapping the fetch layer for a headless browser.
- Not included in v1: multi-page crawling, headless browser, any LLM calls, Lighthouse or performance metrics, config files or plugins. The report is meant to be handed to a human or an LLM afterwards for judgment calls.

## Workflow

Work is done on `feature/*`, `fix/*` or `docs/*` branches and merged into `main`.
