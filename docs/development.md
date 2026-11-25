# Development

## Layout

Each source file starts with a line saying what it holds, so this is only the map:

```
bin/pageaudit.js     entry point, calls main() and sets the exit code
src/
  main.js, cli.js    main() runs the wizard or run(), run() wires the audit together and writes the report files
  options.js         the options and the --help text
  wizard.js          the questions asked when run with no arguments in a terminal
  input/             URLs from arguments, URL files and sitemaps, merged and deduplicated
  fetch.js           fetchPage(): every page request, see below
  robots.js          loadRobots(): a robots.txt read the way Google reads it
  parse.js           parse(): the DOM the checks read
  runner.js          runAudit(): the page checks over every URL, with concurrency and a per-host delay
  checks/page/       checks on one page, and the facts kept about it
  checks/site/       checks across pages, run once every page is audited
  links.js           where internal links lead, for --check-links
  lighthouse*.js     the optional Lighthouse run and the issues made from it
  advice.js          the plain-language title, why and fix of every issue type
  sources.js         the documentation every issue links to
  report.js          buildReport(): the JSON report
  digest.js          buildDigest(): the short form of the report for --digest
  markdown.js        pageMarkdown(): page content as Markdown for --content
  terminal.js        the report as tables for the terminal
  html/              the HTML report for customers
  api/, db/          the web server: routes, the queue worker and the SQLite store
  web/               the web pages of the server
schema/              JSON Schemas of the report and the digest
test/                the tests, with fixtures/ (pages, sitemaps, robots.txt) and helpers/
docs/                these documents, and the plans each version was built from
```

The plans in `docs/` are a record of how the project was built and are not kept up to date: `seo-harness-plan.md` (v1), `pageaudit-v2-plan.md` (multi-page), `pageaudit-v3-lighthouse-plan.md`, `pageaudit-v4-page-data-html-report.md` (page data and the HTML report) and `backend-learning.md` (the steps the HTTP API was built in).

## Pipeline

Pipeline: inputs -> `resolveUrls` -> `runAudit` (`fetchPage` -> `checkResponse` -> `parse` -> `checkHtml` per page, and with `--content` `pageMarkdown` written as each page finishes) -> `checkSite`, `checkRobotsTxt`, `checkSitemapEntries` and, with `--check-links`, `checkLinkTargets` -> `checkLinks` -> `buildReport` -> table or JSON, and the `--out`, `--digest` (`buildDigest`) and `--html` (`renderHtml`) files.

`fetchPage(url, { timeout, beforeHop })` returns `{ url, finalUrl, status, redirects, contentType, html, truncated, robotsHeader, headers, bodyBytes }` and only throws for network failures. `html` holds at most the first 2 MiB of the body (`HTML_MAX_BYTES`), and `truncated` is true when there was more. `beforeHop(url)` is awaited before every request of the redirect chain, so the per-host `--delay` also spaces redirect hops. It is the only thing the runner needs from the network layer, so a headless browser can replace it without touching the checks or the runner, as long as it returns the same shape and calls `beforeHop` the same way.

## Testing

Tests use the built-in `node:test` runner with no extra dependencies. `npm test` runs `node --test test/*.test.{js,ts}`, so helpers in `test/helpers/` are not run as tests. Nothing touches the network. `npm run typecheck` runs `tsc` over the TypeScript files. `npm run lint` runs Biome (lint rules and formatting), and a husky pre-commit hook runs it on the staged files.

- Unit tests cover each rule firing, not firing and the length boundaries.
- HTML fixtures cover the positive and negative cases: `good.html` has no issues, `duplicate.html` shares its title, description and h1 with `good.html`, the `bad-*.html` files (`overlong`, `missing`, `canonical`, `images`, `empty`, `markup`, `hreflang`) trigger the remaining rules, and `hreflang.html` and `hreflang-fi.html` are a language pair with a missing return link and a `noindex` alternate. `noindex.html`, `noindex-header.html` and `blocked.html` feed the indexing, robots.txt and sitemap checks, `ai-blocked.html` is kept from `OAI-SearchBot` only, `snippets.html` has a `noarchive` meta tag and is served with `X-Robots-Tag: googlebot: nosnippet`, `article.html` has a Yoast-style JSON-LD graph with `@id` references and is served with `Last-Modified`, `sitemap-quality.xml` lists them for the sitemap checks, and `rich.html` carries every kind of metadata for the signals tests. Several bad files are needed because some rules are mutually exclusive, for example a title cannot be both missing and too long.
- Input tests read `urls.txt` (comments, duplicates, invalid lines), `sitemap.xml` and `sitemap-index.xml` (which lists `sitemap.xml`, a nested index that is not followed and a missing child sitemap).
- Runner and site check tests pass a mocked `fetchPage` to `runAudit`, so concurrency, the per-host delay and failures are tested without HTTP.
- CLI tests call `run()` with `--json` and `globalThis.fetch` mocked (`test/helpers/fixture-fetch.js`). Requests to `https://fixtures.test/<name>` are served from `test/fixtures/<name>`, `/timeout`, `/not-html`, `/server-error`, `/redirect-once` and `/redirect-twice` simulate other responses, and `links.html` links to each kind of target for the link checks. Every fixture page is served with a secure set of response headers, except `weak-headers.html`, which tests the header checks, and unknown names and other hosts fail with a 404 or a network error. This exercises the real input, fetch, parse, check, report and exit-code path. The terminal output is not run through `run()`; it is covered by the `test/terminal.test.js` unit tests.

## Workflow

Work is done on `feat/*`, `fix/*`, `docs/*`, `refactor/*` or `test/*` branches and merged into `main` through pull requests.
