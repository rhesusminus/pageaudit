# pageaudit

> **Note:** this project is my testing ground for agentic coding. It was planned and built together with an AI coding agent (Claude Code), from plans written in a chat (in `docs/`, starting with `docs/seo-harness-plan.md`) through implementation, tests and git workflow. Treat it as an experiment, not a polished product.

A Node.js CLI for auditing pages from URLs, URL files or sitemaps. It checks static HTML and HTTP responses for SEO, accessibility and site health issues, including metadata, headings, images, structured data, product markup, canonical and hreflang links, security headers and indexing controls. It also reports duplicate content signals across pages and how robots.txt treats search and AI crawlers. Lighthouse performance audits and internal link target checks are opt-in.

Run it with no arguments for an interactive setup, or pass options for scripts and CI. Results are available as a terminal report, a self-contained HTML report for customers, JSON, a compact digest and page content as Markdown for review by a person or an AI coding agent.

## Usage

Requires Node 24 (see `.nvmrc`).

```sh
npm install
node bin/pageaudit.js                                           # asks what to audit, shows the command
node bin/pageaudit.js https://example.com                       # one page
node bin/pageaudit.js https://a.com/x https://a.com/y           # several pages
node bin/pageaudit.js --urls-file urls.txt                      # one URL per line, # for comments
cat urls.txt | node bin/pageaudit.js --urls-file -              # the same list from stdin
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml
node bin/pageaudit.js https://example.com --json                # raw JSON report
node bin/pageaudit.js https://example.com --lighthouse          # also run Lighthouse (needs Chrome)
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml \
  --lighthouse-page https://example.com/ --lighthouse-page https://example.com/products/a   # full Lighthouse detail on key pages only
npm test
```

The `pageaudit` bin is declared in `package.json`, so `npm link` makes it available as `pageaudit`.

Run with no arguments in a terminal, `pageaudit` asks what to audit (page URLs, a sitemap or a URL file), which extra checks to run and which report files to write, suggesting names such as `example.com-2026-10-26-1430.html` (Enter takes a suggestion, Tab puts it in to edit). It then shows the audit as a command you can paste into a script, and asks whether to run it now. Ctrl+C exits 130. Without a terminal or in a dumb one, as in scripts and CI, no arguments is a usage error.

### Inputs

Arguments, `--urls-file` and `--sitemap` can be combined, and the last two repeated. URLs are merged in that order and deduplicated, ignoring the host's case, a `#` fragment and a trailing slash. Inputs that are not `http` or `https` URLs are skipped with the reason and where they came from (such as `urls.txt:8`), but a URL file that cannot be read or a sitemap that cannot be fetched exits 2. A sitemap index is followed one level deep, gzipped sitemaps work, and a sitemap over 50 MB is reported as `sitemap-too-large`, as Google rejects it. Pages are not found by following links.

### Options

| Option                    | Default | Meaning                                                                                                                                                                                                                                 |
| ------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--urls-file <path>`      |         | Read URLs from a file, one per line. `#` starts a comment at the start of a line or after whitespace. A URL can be followed by `lighthouse`. `-` reads stdin.                                                                           |
| `--sitemap <url>`         |         | Read URLs from a sitemap or sitemap index.                                                                                                                                                                                              |
| `--limit <n>`             | all     | Audit at most `n` pages.                                                                                                                                                                                                                |
| `--concurrency <n>`       | 3       | Pages fetched at the same time.                                                                                                                                                                                                         |
| `--delay <ms>`            | 200     | Minimum time between starting requests to the same host, for every request of the run: sitemaps, pages, redirect hops, robots.txt and link checks.                                                                                      |
| `--check-links`           | off     | Also check where the internal links of the audited pages lead: broken links, redirects, unreachable pages and addresses whose canonical is another page, and with a whole `--sitemap` audited, pages no other page links to. See below. |
| `--fail-on <level>`       | `error` | `warning` makes warnings fail the run too (for CI).                                                                                                                                                                                     |
| `--lighthouse`            | off     | Also run Lighthouse on every page that returned HTML. Needs a local Chrome or Chromium. See below.                                                                                                                                      |
| `--lighthouse-page <url>` |         | Run Lighthouse with full detail on this page. Can be repeated. The page is added to the audit if missing and `--limit` never drops it. In a `--urls-file`, a URL followed by `lighthouse` does the same. See below.                     |
| `--lighthouse-runs <n>`   | 1       | Run Lighthouse `n` times per page (1 to 9) and keep the median run, since single runs vary. See below.                                                                                                                                  |
| `--out <path>`            |         | Also write the JSON report to a file, for example to hand to Claude. Exits 2 if the file cannot be written.                                                                                                                             |
| `--digest <path>`         |         | Also write a short form of the JSON report for Claude to read first, useful on a large audit. See "Using the output with Claude". Exits 2 if the file cannot be written.                                                                |
| `--content <dir>`         |         | Also write the main content of each page as Markdown, one file per page, for Claude to judge what the pages say. See "Using the output with Claude". Exits 2 if a file cannot be written.                                               |
| `--html <path>`           |         | Also write a report for customers as one self-contained HTML file. See below.                                                                                                                                                           |
| `--title <text>`          |         | Report title in the HTML report (default `Website audit`). Needs `--html`.                                                                                                                                                              |
| `--client <name>`         |         | Client name in the HTML report. Needs `--html`.                                                                                                                                                                                         |
| `--logo <file>`           |         | Logo for the HTML report: png, jpg, gif, webp or svg, at most 512 KB. Needs `--html`.                                                                                                                                                   |
| `--json`                  |         | Print the JSON report. Also the default when stdout is not a TTY.                                                                                                                                                                       |
| `-h`, `--help`            |         | Show the options.                                                                                                                                                                                                                       |

Each request has a 15 s timeout (covering redirects and the body), follows up to 10 redirects and sends `User-Agent: pageaudit/<version> (+https://github.com/rhesusminus/pageaudit)`. Googlebot sends no `Accept-Language`, so pageaudit sends an empty one: Node's `fetch` would otherwise send `*`, and some sites answer that with a redirect to a random translation.

### Output

In a terminal the report shows a summary table of every page, worst first, the issues of each page that has any (with the Lighthouse results when it ran), a `Site` section with the issues across pages, a `Not checked` section for checks that were asked for but could not run, and a final count such as `40 pages, 6 errors, 19 warnings, 3 infos`. Progress and the paths of the files written go to stderr, so `--json` output stays clean. A report file is written beside its target and renamed into place, so a run that fails while writing leaves the earlier report whole.

### Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| 0    | No errors (warnings and infos are allowed, unless `--fail-on warning`)                      |
| 1    | At least one error, or a warning with `--fail-on warning`                                   |
| 2    | Usage error, an unreadable input, an output file that cannot be written, or no URL to audit |
| 130  | The questions asked when run with no arguments were cancelled (Ctrl+C or Esc)               |

A page that cannot be fetched or returns an error status is an error on that page (exit 1), not a reason to stop. A sitemap that was read but lists no URL to audit is still checked, so that run exits 0 or 1. An unreadable input is a URL file, sitemap or `--logo` that cannot be read.

An `--out`, `--digest`, `--html` or `--content` path that cannot be used (a directory, a missing folder, two reports naming one file) exits 2 before any page is fetched, and a report that cannot be written still exits 2 after the audit.

[docs/cli.md](docs/cli.md) has the details of the questions, inputs, output, exit codes and HTML report.

### HTML report

`--html report.html` writes a report that is meant to be shown to a customer: one self-contained file with inline CSS and no network requests, so it can be emailed, opened offline or printed to PDF. It reads fine without JavaScript. A small inline script only opens the collapsed sections while printing, so in a viewer without JavaScript open them before printing. It follows the system light or dark setting and works down to phone width.

```sh
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml --limit 20 --lighthouse \
  --html report.html --title "Website audit" --client "Acme Oy" --logo logo.svg
```

It opens with a cover, a one-sentence verdict and, with `--lighthouse`, the average scores, then a ranked **What to fix** list in plain language (what is wrong, why it matters and how to fix it), a section per page and a note on how the audit was done. The evidence, such as the element behind a finding and its markup, is in collapsed sections. Severity is shown by a word and a shape, never by color alone, and all text from the audited sites is escaped.

### Using the output with Claude

The JSON report is meant to be read by a person or a model. Write it to a file and ask Claude Code to read it:

```sh
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml --limit 20 --lighthouse --out report.json
```

Then: "read report.json and summarize the SEO and usability problems, most important first". Each issue says what was found and where, links the documentation it is based on, and the `rules` block explains each issue type once. Each page also has `facts`, what is on the page, so a suggestion can quote the real title or headings.

- On a large audit, add `--digest report.digest.json`: a short form of the report, one entry per problem instead of one per page, for Claude to read first and look up details in the full report.
- To judge what the pages say, add `--content content`: the main content of each page as Markdown, one file per page.

The report shape is in [`schema/report.schema.json`](schema/report.schema.json), and [docs/report.md](docs/report.md) describes every field, the digest and the content files.

### Lighthouse

`--lighthouse` also runs [Lighthouse](https://github.com/GoogleChrome/lighthouse) in a headless Chrome on each page that returned HTML, one page at a time, so expect several seconds per page. Each page gets its scores, metrics and its 10 worst failing audits, and slow metrics and low scores become `info` or `warning` issues (never errors). To keep the report small, pick the pages that matter with `--lighthouse-page`, or write `lighthouse` after a URL in a URL file: with `--lighthouse` too, the other pages get only a short summary. Lab numbers vary between runs, so use `--lighthouse-runs 3` before failing a build on them. See [docs/lighthouse.md](docs/lighthouse.md).

## Checks

Rules follow what Google and the W3C actually say, not folklore, so severities are soft where Google does not require something. Each issue has a `severity` (`error`, `warning` or `info`), a `category` (`seo`, `accessibility`, `performance` or `best-practice`) and a `source` link to the documentation it is based on. Only errors fail the run, unless `--fail-on warning` is given.

- **Page checks:** images and alt text, form labels, link names, headings, the title, description and canonical, social preview tags, indexing controls (`noindex`, snippet limits, Bing's Copilot rules), hreflang, JSON-LD and Product markup, URL hygiene, mixed content, page size and the HTTP response.
- **Site checks:** duplicate titles, descriptions and `h1`s, canonicals and hreflang pairs across pages, robots.txt (pages kept from Googlebot or from AI search crawlers), sitemap entries and files, and security and compression headers.
- **With `--check-links`:** broken internal links, links to redirects and to non-canonical pages, and orphan pages.

[docs/checks.md](docs/checks.md) lists every rule with its severity, and where each one comes from.

## Web server

`npm start` serves a web page for checking one page at a time, and an HTTP API (`POST /audits`, `GET /audits/:id`, `DELETE /audits/:id`), on `localhost:8080`. Audits are queued, stored in `database.db` and run with the site checks that make sense for one page. The results page can be copied for Claude, or read at `/check/:id.md`. The server only fetches public addresses: set `ALLOW_PRIVATE_DESTINATIONS=1` to check a site on your own machine, and only on a server you run for yourself. See [docs/server.md](docs/server.md).

## Limitations and out of scope

- Only the raw HTML from the initial fetch is inspected (Cheerio, no JavaScript execution), so client-side rendered content is not seen. Framework bindings tell that a value will be there, not what it says, so a bound alt or link text is not judged. The fix would be swapping `fetchPage` for a headless browser.
- Pages are only discovered from arguments, URL files and sitemaps. `--check-links` checks where internal links lead, but the pages it finds are not audited.
- `robots.txt` is read only to report blocked pages (`blocked-by-robots`, `ai-search-blocked`) and how it treats AI crawlers (`origins`), it is not obeyed: pages it disallows are audited like any other.
- Not included: any LLM calls, config files or plugins. Lighthouse is opt-in and the static checks still use the raw HTML only. The report is meant to be handed to a human or an LLM afterwards for judgment calls.

## Development

`npm test` runs the tests (`node:test`, nothing touches the network), `npm run lint` runs Biome and `npm run typecheck` runs `tsc`. Work goes through pull requests from `feat/*`, `fix/*`, `docs/*`, `refactor/*` or `test/*` branches. [docs/development.md](docs/development.md) has the layout of the code, the pipeline and how the tests are built.
