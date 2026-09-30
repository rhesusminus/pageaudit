# pageaudit v2: multi-page auditing

## Goal
v1 audits one URL. v2 audits many. Pages can come from a list of URLs given
as arguments, a text file, or a sitemap. Results are reported per page, plus
a summary and a set of cross-page checks that a single page can't do
(duplicate titles, duplicate meta descriptions).

Still out of scope: headless browser, Lighthouse, LLM calls, plugin system.

## Input modes

All modes end up as the same thing: a deduplicated array of URLs. Everything
after that step doesn't care where the URLs came from.

```
pageaudit https://example.com                      # v1 behavior, unchanged
pageaudit https://a.com/x https://a.com/y          # list as arguments
pageaudit --urls-file urls.txt                     # one URL per line, # comments allowed
pageaudit --sitemap https://example.com/sitemap.xml
```

Rules:
- Arguments, `--urls-file` and `--sitemap` can be combined. Merge and dedupe.
- Normalize before deduping: lowercase host, strip fragments (`#...`), keep
  query strings, treat trailing slash as the same page.
- Reject anything that isn't http or https, and print which inputs were
  skipped and why. Don't abort the whole run over one bad URL.
- Sitemap index files (sitemaps that point to other sitemaps) should be
  followed one level deep.
- `--limit <n>` caps the number of pages. Useful for big sitemaps.

Link-following crawl (discovering pages by clicking internal links) is NOT in
v2. Explicit lists and sitemaps cover the need. Leave it for v3 if ever.

## Architecture changes

```
src/
├── input/
│   ├── args.js          # URLs from CLI arguments
│   ├── file.js          # URLs from --urls-file
│   ├── sitemap.js       # URLs from --sitemap (handles sitemap index)
│   └── resolve.js       # merge, normalize, dedupe, apply --limit
├── fetch.js             # keep the same interface: fetchPage(url) -> { url, finalUrl, status, html }
├── runner.js            # runs page checks over all URLs with concurrency + delay
├── checks/
│   ├── page/            # existing v1 checks move here (images, meta, headings)
│   └── site/
│       └── duplicates.js  # cross-page checks, run after all pages are done
├── report.js            # per-page results + site-level results + summary
└── cli.js
```

Keep `fetch.js` behind a small interface (`fetchPage(url)`), so Playwright can
replace it later without touching checks or the runner.

## Two kinds of checks

Page checks take one parsed page and return issues. Same issue shape as v1,
plus the page URL:

```js
{ url, type, severity, message, context }
```

Site checks take the results of all pages and return issues. They run after
every page is fetched.

- Duplicate `<title>` across pages: warning, list all URLs sharing it
- Duplicate meta description across pages: warning, same
- Duplicate H1 across pages: warning
- Pages whose canonical points to a different URL (informational, not an
  error, since this is often intentional)

## Fetching behavior

- Concurrency limit, default 3, `--concurrency <n>` to change it.
- Small delay between requests to the same host, default 200 ms. Be polite,
  especially on small sites.
- Timeout per request, default 15 s.
- Follow redirects, record the final URL. Flag redirect chains longer than
  one hop as a warning.
- Non-200 responses: record as an error issue for that page (`http-status`)
  and skip the HTML checks for it.
- One failed page never stops the run. Network errors become an issue on
  that page and the runner moves on.
- Send a clear User-Agent, e.g. `pageaudit/2.0`.

## Output

Terminal (default):
- Spinner with progress: `Auditing 12/40 pages...`
- After finishing, one summary table: URL, errors, warnings. Sorted worst first.
- Then details per page, only for pages that have issues. Pages with zero
  issues are collapsed into "N pages clean".
- Site-level issues in their own section at the end.
- Final line: `40 pages, 6 errors, 19 warnings`.

`--json`: one object with `{ pages: [{ url, status, issues }], site: [issues], summary }`.
This is the file you'd hand to Claude for prioritizing fixes, so keep it
stable and well structured.

Exit code: 1 if any errors, 0 otherwise. Optional `--fail-on warning` to
make warnings fail too (handy for CI later).

## Build order
1. `input/` modules and `resolve.js`, tested on their own with fixtures
   (a sample sitemap XML, a urls file with comments and duplicates).
2. `runner.js` with concurrency, delay and timeout. Run it over 3 to 5 URLs
   with the existing v1 checks and print raw JSON. No pretty output yet.
3. Move v1 checks into `checks/page/`, add `url` to the issue shape.
4. `checks/site/duplicates.js`.
5. New `report.js` and progress spinner.
6. Tests: mock `fetchPage` so runner and duplicate checks don't hit the network.

## Open questions to settle while building
- Should `--urls-file` also accept `-` for stdin, so `cat urls.txt | pageaudit -` works?
- Respect `robots.txt`? Probably worth a warning-only check in v2 and real
  enforcement later.
- Where should the JSON report go by default: stdout only, or also written to
  a file with `--out report.json`?
