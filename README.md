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

`--json` is also the default whenever stdout is not a TTY (for example when piped), and the spinner is disabled in that case. The spinner is also skipped on TTYs that report 0 columns. The table width follows the terminal (80 to 114 columns). The `pageaudit` bin is declared in `package.json`, so `npm link` makes it available as `pageaudit <url>`.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | No errors (warnings and infos are allowed) |
| 1 | At least one error found |
| 2 | Usage error or the page could not be fetched |

## Checks

Rules follow what Google and the W3C actually say, not folklore, so severities are deliberately soft where Google does not require something. Each issue carries a `severity` (`error`, `warning` or `info`), a `category` (`seo`, `accessibility`, `performance` or `best-practice`) and a `source` URL to the documentation it is based on (see `src/sources.js`). Only errors affect the exit code.

| Group | Rule | Severity | Category |
| ----- | ---- | -------- | -------- |
| Images | `missing-alt`: no `alt` attribute | error | accessibility |
| Images | `empty-alt-in-link`: empty alt on an image that is the only content of a link or button | error | accessibility |
| Images | `empty-alt`: `alt=""` (correct for decorative images, flagged for review) | info | accessibility |
| Images | `alt-is-filename`: alt text repeats the file name | warning | accessibility |
| Images | `missing-src`: no `src` or `srcset` | warning | seo |
| Images | `generic-filename`: e.g. `IMG00023.JPG`, `image1.jpg` | info | seo |
| Images | `missing-dimensions`: no `width` or `height` (layout shift) | warning | performance |
| Meta | `missing-title`, `empty-title` (the title is also found outside `<head>`, but not inside an `<svg>`) | error | seo |
| Meta | `long-title`: over 60 characters | warning | seo |
| Meta | `missing-description` (Google may build the snippet from the page instead) | warning | seo |
| Meta | `long-description` (over 160) and `short-description` (under 70) | info | seo |
| Meta | `multiple-descriptions` (only one is used, the first non-empty one is checked; empty ones count toward the total) | warning | seo |
| Meta | `missing-canonical` (also when the link is outside `<head>`, where Google ignores it) | warning | seo |
| Meta | `multiple-canonicals`: several canonicals with different hrefs (conflicting signals) | warning | seo |
| Meta | `multiple-canonicals`: several canonicals with identical hrefs (redundant) | info | seo |
| Meta | `relative-canonical`, `canonical-fragment`, `empty-canonical` | warning | seo |
| Headings | `missing-h1` (Google does not require one) | warning | best-practice |
| Headings | `multiple-h1` (Google does not mind) | info | best-practice |
| Headings | `skipped-heading-level`: e.g. `<h3>` with no preceding `<h2>` | warning | accessibility |
| Headings | `empty-heading` (no text, `aria-label`, `aria-labelledby` or image alt) | warning | accessibility |

The length limits (60, 160, 70) are heuristics, not official rules: Google states there is no limit and truncates by pixel width. Empty alt is only an error when it leaves a link or button without any accessible name.

Before checking, `<template>` elements are removed because their content is inert. Whitespace runs in the title, description and heading text are collapsed before measuring, like browsers do, and issue contexts are capped at 120 characters.

`fetchHtml` decodes the body the way browsers do: a BOM wins, then the `Content-Type` charset, then a `<meta charset>` or `http-equiv` prescan of the first 1024 bytes, then UTF-8. Fetch errors report the underlying cause (error code or message), for example `Could not fetch <url>: ENOTFOUND`.

## Where the rules come from

The rules were researched in September 2026 (with the same AI agent that wrote the code) from Google Search Central, web.dev and the W3C Web Accessibility Initiative. The URLs live in `src/sources.js` and every issue links to its source in the JSON output.

| Source | What it says | Rules based on it |
| ------ | ------------ | ----------------- |
| [Google: title links](https://developers.google.com/search/docs/appearance/title-link) | Every page should have a `<title>`. "No limit" on length, but it is truncated "typically to fit the device width". No numeric guidance. | `missing-title`, `empty-title`, `long-title` |
| [Google: snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet) | No length limit, truncated to fit the device width. The meta description is only "sometimes" used, snippets mostly come from page content. Descriptions should be unique and specific, and too-short or generic ones are given as bad examples. | `missing-description`, `long-description`, `short-description` |
| [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) | Use absolute URLs, add a self-referencing canonical, only `<head>` is accepted, do not send conflicting signals, fragments are generally not supported. | `missing-canonical`, `multiple-canonicals`, `relative-canonical`, `canonical-fragment`, `empty-canonical` |
| [Google: image SEO](https://developers.google.com/search/docs/appearance/google-images) | Google finds images in the `src` of `<img>` (not CSS backgrounds). Use short descriptive file names, not `IMG00023.JPG` or `image1.jpg`. Avoid keyword-stuffed alt text. | `missing-src`, `generic-filename`, `alt-is-filename` |
| [Google: SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide) | Heading order and count do not matter for Search. Good titles and descriptions are unique and concise. Good alt text is "quite important". | `missing-h1`, `multiple-h1` (as best practice only) |
| [web.dev: optimize CLS](https://web.dev/articles/optimize-cls) | Set `width` and `height` on images so the browser reserves space. Good CLS is 0.1 or less. | `missing-dimensions` |
| [W3C WAI: decorative images](https://www.w3.org/WAI/tutorials/images/decorative/) | Purely decorative images should have `alt=""`. Omitting `alt` makes some screen readers read out the file name. Only the author can tell if an image is decorative. | `missing-alt`, `empty-alt`, `empty-alt-in-link` |
| [W3C WAI: headings](https://www.w3.org/WAI/tutorials/page-structure/headings/) | Nest headings by rank, and avoid skipping ranks (an `<h2>` directly followed by an `<h4>`). | `skipped-heading-level`, `empty-heading` |

Judgment calls that are not straight from those pages:

- **Severity of `missing-h1` and `multiple-h1`:** Google's John Mueller has said several times that pages rank fine with no h1 or with several, for example "Your site is going to rank perfectly fine with no H1 tags or with five". These quotes were found through search-result summaries of secondary blogs, not a Google page, so they are the weakest-sourced part. The W3C headings page does not address a single h1.
- **Length limits (60 and 160 characters, minimum 70):** common SEO heuristics, not Google rules. Real truncation depends on pixel width (roughly 580 to 600px for titles on desktop), so characters are only a proxy.
- **`empty-alt-in-link` as an error:** derived from the W3C decorative-image guidance. An image that is the only content of a link needs an accessible name, so an empty alt there leaves the link unnamed.
- **`missing-src` and `generic-filename`:** based on Google's statement that images are found via `src` and its file name advice, but the exact patterns (`IMG`, `DSC`, `image1` and so on) are my own list.
- **Summaries, not full reads:** the pages were read through an AI summarizer, so exact wording should be checked against the linked page before quoting it.

## Architecture

```
bin/pageaudit.js        entry point, calls run() and sets the exit code
src/
  cli.js                arg parsing, spinner, wires the pipeline together
  fetch.js              fetchHtml(url): URL validation, timeout, status and content-type checks, encoding sniffing
  parse.js              parse(html): Cheerio DOM, with inert <template> content removed
  text.js               collapseWhitespace() shared by the checks
  checks/
    images.js           one module per category, each returns an array of issues
    meta.js
    headings.js
    snippet.js          truncate()/snippet(): caps issue contexts at 120 characters
  sources.js            documentation URLs referenced by each issue's `source` field
  report.js             buildReport() aggregates issues, formatTable()/formatSummary() render them
test/
  checks.test.js        unit tests for each check
  fetch.test.js         unit tests for fetchHtml (encoding sniffing, errors)
  report.test.js        unit tests for the summary and the table/summary rendering
  cli.test.js           tests of run() with --json against the fixtures
  fixtures/             good.html and bad-canonical, bad-empty, bad-images, bad-missing, bad-overlong
  helpers/fixture-fetch.js   mocked fetch that serves the fixtures
docs/seo-harness-plan.md     the original plan this was built from
```

Pipeline: `fetchHtml` -> `parse` -> `checkImages` / `checkMeta` / `checkHeadings` -> `buildReport` -> table or JSON.

Every check returns issues in the same shape, so `report.js` has no per-check special cases:

```js
{
  type: 'missing-alt',            // machine-readable identifier
  severity: 'error',              // 'error' | 'warning' | 'info'
  category: 'accessibility',      // 'seo' | 'accessibility' | 'performance' | 'best-practice'
  source: 'https://www.w3.org/WAI/tutorials/images/decorative/',
  message: 'Image missing alt attribute',
  context: '<img src="/a.jpg">'   // snippet for locating the problem
}
```

The JSON report is `{ url, categories: { images, meta, headings }, summary: { errors, warnings, infos } }`. `url` is the URL as given on the command line, not the final URL after redirects.

## Testing

Tests use the built-in `node:test` runner with no extra dependencies. `npm test` runs `node --test test/*.test.js`, so helpers in `test/helpers/` are not run as tests.

- Unit tests cover each rule firing, not firing and the length boundaries.
- HTML fixtures cover the positive and negative cases: `good.html` has no issues, and the `bad-*.html` files (`overlong`, `missing`, `canonical`, `images`, `empty`) trigger the remaining rules. Several bad files are needed because some rules are mutually exclusive, for example a title cannot be both missing and too long.
- CLI tests call `run()` with `--json` and `globalThis.fetch` mocked (`test/helpers/fixture-fetch.js`). Requests to `https://fixtures.test/<name>` are served from `test/fixtures/<name>`, `/timeout` and `/not-html` simulate failures, and unknown names and other hosts fail with a 404 or a network error. This exercises the real fetch, parse, check, report and exit-code path without network access. The table and summary output is not run through `run()`; it is covered by the `test/report.test.js` unit tests, and `fetchHtml` encoding handling by `test/fetch.test.js`.

## Limitations and out of scope

- Only the raw HTML from the initial fetch is inspected (Cheerio, no JavaScript execution), so client-side rendered content is not seen. The fix would be swapping the fetch layer for a headless browser.
- Not included in v1: multi-page crawling, headless browser, any LLM calls, Lighthouse or performance metrics, config files or plugins. The report is meant to be handed to a human or an LLM afterwards for judgment calls.

## Workflow

Work is done on `feature/*`, `fix/*` or `docs/*` branches and merged into `main`.
