# pageaudit

> **Note:** this project is my testing ground for agentic coding. It was planned and built together with an AI coding agent (Claude Code), from plans written in a chat (in `docs/`, starting with `docs/seo-harness-plan.md`) through implementation, tests and git workflow. Treat it as an experiment, not a polished product.

A small Node.js CLI that fetches one or more pages, parses the static HTML and reports basic SEO/HTML issues: images, meta tags, headings and the HTTP response of each page, plus cross-page checks such as duplicate titles.

## Usage

Requires Node 24 (see `.nvmrc`).

```sh
npm install
node bin/pageaudit.js                                           # asks for the pages, shows the command
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

Run with no arguments in a terminal, `pageaudit` asks for the page URLs (several separated by spaces) and shows the command that would audit them. While the questions are being built it does not run that command, so trying it sends no requests, and it exits 0. Without a terminal on stdin and stdout, as in scripts and CI, no arguments is still a usage error.

### Inputs

Arguments, `--urls-file` and `--sitemap` can be combined, and the last two can be repeated. All URLs are merged in that order and deduplicated: the host is compared case-insensitively, fragments (`#...`) are dropped, query strings are kept and a trailing slash on the path is ignored, so `/x` and `/x/` are the same page. The first spelling seen is the one fetched.

- Inputs that are not `http` or `https` URLs are skipped with the reason and where they came from (for example `urls.txt:8`). One bad URL never aborts the run, but a URL file that cannot be read or a sitemap that cannot be fetched exits 2.
- A sitemap index is followed one level deep. Child sitemaps that fail, or that are themselves indexes, are skipped with the reason. Each sitemap file is read once in a run, also when an index lists it twice or lists itself, or when it is given twice or also listed by another `--sitemap`. Gzipped sitemap files (`.xml.gz`) are supported. A sitemap file larger than 50 MB uncompressed is skipped too, as Google rejects it whole: reading stops at 50 MB and the file is reported as `sitemap-too-large`.
- `--limit <n>` audits only the first `n` URLs after deduplication.

Link-following crawling is not supported.

### Options

| Option                    | Default | Meaning                                                                                                                                                                                                             |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--urls-file <path>`      |         | Read URLs from a file, one per line. `#` starts a comment at the start of a line or after whitespace. A URL can be followed by `lighthouse`. `-` reads stdin.                                                       |
| `--sitemap <url>`         |         | Read URLs from a sitemap or sitemap index.                                                                                                                                                                          |
| `--limit <n>`             | all     | Audit at most `n` pages.                                                                                                                                                                                            |
| `--concurrency <n>`       | 3       | Pages fetched at the same time.                                                                                                                                                                                     |
| `--delay <ms>`            | 200     | Minimum time between starting requests to the same host, for every request of the run: sitemaps, pages, redirect hops, robots.txt and link checks.                                                                  |
| `--check-links`           | off     | Also check where the internal links of the audited pages lead: broken links, redirects and unreachable pages, and with a whole `--sitemap` audited, pages no other page links to. See below.                        |
| `--fail-on <level>`       | `error` | `warning` makes warnings fail the run too (for CI).                                                                                                                                                                 |
| `--lighthouse`            | off     | Also run Lighthouse on every page that returned HTML. Needs a local Chrome or Chromium. See below.                                                                                                                  |
| `--lighthouse-page <url>` |         | Run Lighthouse with full detail on this page. Can be repeated. The page is added to the audit if missing and `--limit` never drops it. In a `--urls-file`, a URL followed by `lighthouse` does the same. See below. |
| `--lighthouse-runs <n>`   | 1       | Run Lighthouse `n` times per page (1 to 9) and keep the median run, since single runs vary. See below.                                                                                                              |
| `--out <path>`            |         | Also write the JSON report to a file, for example to hand to Claude. Exits 2 if the file cannot be written.                                                                                                         |
| `--html <path>`           |         | Also write a report for customers as one self-contained HTML file. See below.                                                                                                                                       |
| `--title <text>`          |         | Report title in the HTML report (default `Website audit`). Needs `--html`.                                                                                                                                          |
| `--client <name>`         |         | Client name in the HTML report. Needs `--html`.                                                                                                                                                                     |
| `--logo <file>`           |         | Logo for the HTML report: png, jpg, gif, webp or svg, at most 512 KB. Needs `--html`.                                                                                                                               |
| `--json`                  |         | Print the JSON report. Also the default when stdout is not a TTY.                                                                                                                                                   |
| `-h`, `--help`            |         | Show the options.                                                                                                                                                                                                   |

Each request has a 15 s timeout (covering redirects and the body), follows up to 10 redirects and sends `User-Agent: pageaudit/<version> (+https://github.com/rhesusminus/pageaudit)`.

### Output

In a terminal a spinner shows `Auditing 12/40 pages...` on stderr (skipped for JSON output and on TTYs that report 0 columns). Skipped inputs are listed on stderr before the audit starts. The report then shows:

1. A summary table of every page (URL, status, errors, warnings, infos), worst first.
2. The issues of each page that has any, worst page first. Pages with no issues are collapsed into `N pages clean`.
3. A `Site` section with the cross-page issues.
4. A final line such as `40 pages, 6 errors, 19 warnings, 3 infos`.

Tables follow the terminal width (80 to 114 columns).

### Exit codes

| Code | Meaning                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- |
| 0    | No errors (warnings and infos are allowed, unless `--fail-on warning`)                      |
| 1    | At least one error, or a warning with `--fail-on warning`                                   |
| 2    | Usage error, an unreadable input, an output file that cannot be written, or no URL to audit |
| 130  | The questions asked when run with no arguments were cancelled (Ctrl+C or Esc)               |

A page that cannot be fetched or returns an error status is an error on that page (exit 1), not a reason to stop. A sitemap that was read but lists no URL to audit is still checked, so that run exits 0 or 1. An unreadable input is a URL file, sitemap or `--logo` that cannot be read. An `--out` or `--html` path that is a directory exits 2 before any page is fetched, and a report file that cannot be written exits 2 even after a complete audit.

### HTML report

`--html report.html` writes a report that is meant to be shown to a customer: one self-contained file with inline CSS and no network requests, so it can be emailed, opened offline or printed to PDF. It reads fine without JavaScript. A small inline script only opens the collapsed sections while printing, so in a viewer without JavaScript open them before printing. It follows the system light or dark setting and works down to phone width.

```sh
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml --limit 20 --lighthouse \
  --html report.html --title "Website audit" --client "Acme Oy" --logo logo.svg
```

It has a cover with the client, the date, a one-sentence verdict and, with `--lighthouse`, the four average scores. Then a summary of how many pages have problems, a ranked **What to fix** list, a section per page and a short note on how the audit was done. Inputs that were skipped, and a `--limit` that cut the list short, are mentioned in the summary. Findings are written in plain language (`src/advice.js`: what is wrong, why it matters and how to fix it), and the technical message and documentation link stay on each page. The same problem on many pages is one line in the list, with every affected page behind **Show where**. Site-wide problems such as duplicate titles are part of the same list. Severity is shown by a word and a shape, never by color alone.

The evidence behind the findings is in collapsed sections, so the report still reads top down. **Show the element** on a problem shows its CSS selector, its markup and, for length checks, what was found against what was expected (for the first 20 pages of a problem). Each page card has **More about this page** (canonical, viewport, robots, Open Graph, structured data, the heading outline, images without alt text and link samples) and the full redirect chain. In the speed and quality test, every finding has a **Show details** section with what it means, the estimated saving and the affected files and elements (the latter only for pages run with `--lighthouse-page`), and the largest element on screen is named. The Lighthouse version, the device and, with `--lighthouse-runs`, the spread of the scores are noted below it.

All text taken from audited sites is escaped, and the logo is embedded as a data URI. A logo that cannot be read, or one over the size limit, exits 2 before any page is fetched.

### Using the output with Claude

The JSON report is meant to be read by a person or a model. Write it to a file and ask Claude Code to read it:

```sh
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml --limit 20 --lighthouse --out report.json
```

Then, in Claude Code: "read report.json and summarize the SEO and usability problems, most important first". Each page carries the issues the checks found, the Lighthouse summary and a `facts` object with what is on the page, so a suggestion can refer to the real title or headings. `facts` is `null` for pages that returned no HTML or whose HTML the checks could not process. Free text is capped to keep the file small: heading text and the Open Graph title, description and type at 120 characters (URLs at 2000), the page title, description and `h1s` at 300 characters, with at most 10 `h1s` and 40 headings. `generatedAt` is the time of the audit.

**Schema.** The shape of the JSON report is described in [`schema/report.schema.json`](schema/report.schema.json) (JSON Schema, draft 2020-12), and every report starts with `schemaVersion`. The version goes up by one when a field is removed, renamed or changes its meaning, and stays the same when an optional field is added, so a script can check it before reading the rest. The tests validate reports from every kind of fixture against the schema, with no extra properties allowed, so the schema cannot drift from the code. Page issues name their page in `url` and site issues name theirs in `urls`, which the schema keeps apart as `pageIssue` and `siteIssue`. Both have an `id`.

Every issue, page or site, has an `id`, a `type`, a `message` and a `context`. Where the check found a single element it also has a `selector` (a CSS path), the element's `html` and its `parentHtml` (capped at 500 and 200 characters, `parentHtml` is left out when the parent is `html`, `head` or `body`). Length checks add the measured `actual` value and the `expected` limit. The top-level `rules` object explains each issue `type` that occurs in the report once, as `{ title, why, fix }` (the same wording as the HTML report), so a model knows what a finding means and how to fix it. The `id` is built from the page, the type and the selector, so it is the same on every run as long as the page keeps its structure. Adding an element earlier in the page changes the ids after it, so compare ids within one report.

| `facts` field                              | Meaning                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`, `description`, `h1s`, `canonical` | The values the site checks compare (the canonical is resolved to an absolute URL)                                                                      |
| `lang`, `viewport`, `robots`               | The `lang` attribute and the viewport and robots meta tags                                                                                             |
| `headings`                                 | Outline of `{ level, text, excerpt }`, at most 40 headings, text capped at 120 characters and the `excerpt` (the first words under the heading) at 200 |
| `wordCount`                                | Words of visible body text (script, style and noscript are not counted), a rough measure of depth                                                      |
| `mainText`                                 | The visible text of `<main>` or `<article>` (else the body without nav, header, footer and aside), cut at 1500 characters                              |
| `links`                                    | `{ internal, external, nofollow }` counts of http(s) links. `www.` is treated as the same site                                                         |
| `linkSamples`                              | The first 25 page links as `{ href, text, internal, nofollow }`, with the anchor text (or the alt of an image link) capped at 120 characters           |
| `images`                                   | `{ total, missingAlt }`                                                                                                                                |
| `imageSamples`                             | The first 20 images as `{ src, alt, context }`: absolute address, alt text (`null` if missing) and the figure caption or the words around the image    |
| `openGraph`, `twitterCard`                 | Open Graph title, description, image, type and url, and the Twitter card type                                                                          |
| `jsonLdTypes`                              | The `@type` values of valid JSON-LD blocks, at most 20. Invalid JSON-LD is ignored                                                                     |
| `hreflang`                                 | The first 100 `<link rel="alternate" hreflang>` tags in `<head>` as `{ lang, href }`, the href resolved to an absolute URL where possible              |

### Lighthouse

With `--lighthouse`, each page that returned HTML is also audited by [Lighthouse](https://github.com/GoogleChrome/lighthouse) (the `lighthouse` and `chrome-launcher` npm packages) in a headless Chrome. Pages run one at a time in a single Chrome, because parallel runs skew each other's performance numbers, so expect several seconds per page. It is off by default, which keeps the plain run fast and free of any browser dependency.

The JSON report gets a `lighthouse` object on each audited page instead of the full Lighthouse result, which is far too large to read or hand to a model:

- `lighthouseVersion` and `formFactor` (`mobile` by default), so a number can be placed later
- `scores`: 0 to 100 for `performance`, `accessibility`, `best-practices` and `seo`
- `metrics`: `fcp`, `lcp`, `tbt`, `speedIndex` in ms and `cls`
- `lcpElement`: `{ selector, snippet }` of the element behind the largest contentful paint, when Lighthouse found it
- `runs` and `scoreSpread` (`[lowest, highest]` per category), placed after `scores`, only with `--lighthouse-runs` above 1
- `audits`: only the audits scoring below 90, worst first, at most the 10 worst (`omittedAudits` counts the rest). Each has its category, title, score, display value, the `savings` when Lighthouse worked them out, and up to three affected `items`. `savings` can hold `ms` and `bytes` (overall) and `metrics` (the gain per metric: `fcp`, `lcp`, `inp`, `tbt` in ms and `cls`). Zero is left out, as it means no estimate. An item has only the fields Lighthouse gave: `url` (with `line`), `selector`, `nodeLabel`, `snippet`, `explanation` (why it fails, such as the contrast ratio, up to 500 characters), `label` (a failed check, a console error or a third party), `wastedMs`, `wastedBytes` and `totalBytes`. Other text is capped at 300 characters. `items` used to be a list of strings
- the top-level `lighthouseAudits` object holds each audit's plain-words `description` and first `learnMore` link once, by audit id, instead of on every page
- `warnings`: Lighthouse run warnings, plus a line for any audit that crashed inside Lighthouse

**Keeping the report small.** Pick the pages that matter (the landing page, a product page or two) with `--lighthouse-page <url>` or by writing `lighthouse` after a URL in the urls file:

```
https://example.com/              lighthouse
https://example.com/products/a    lighthouse
https://example.com/about
```

- With picked pages and no `--lighthouse`, Lighthouse runs on those pages only, with the full detail above.
- With `--lighthouse` too, the other pages get a short summary: scores, metrics and one line per failing audit (`id`, `category`, `title`, `score`, `displayValue`), without items, savings and descriptions.
- With `--lighthouse` alone every page gets the full detail, as before.
- A page is picked by the URL as you wrote it (the same page spelled the same way, ignoring a trailing slash, the host's case and a `#` fragment). `http://` and `https://` are different pages, and a page that redirects to a picked page's final URL does not get the full detail unless it is picked too. A picked page that does not return HTML gets an `info` issue saying so.
- Any text other than `lighthouse` after a URL in a urls file skips that line with a reason, so a typo is never fetched as a URL with a space in it.

**Lab numbers and the rules built on them.** Lighthouse measures one simulated load on one machine, so the same page can score 58 on one run and 86 on the next. Use `--lighthouse-runs 3` for steadier numbers: the page is run three times, one after another, and the median run (by performance score, the lower one for an even count) supplies the scores, metrics and audits. A failed run is dropped, and only when every run fails does the page get `lighthouse-failed`. The time grows with the number of runs, the size of the report does not.

The numbers also become normal issues, so they show up in the `rules` block and the HTML "What to fix" list: `lcp-slow`, `cls-high` and `tbt-high` (an `info` past the "good" limit and a `warning` past the "poor" one) and `score-low-performance`, `score-low-accessibility`, `score-low-best-practices` and `score-low-seo` (`info` under 90, `warning` under 50). They are never errors, so at the default `--fail-on error` a noisy run cannot fail a build. With `--fail-on warning` they count, so a run that tips LCP from 3.9 s to 4.1 s can fail it: use `--lighthouse-runs 3` there. This is a change from earlier versions, where Lighthouse never touched the exit code. The slow LCP issue carries the LCP element as `selector` and `html`. The audits behind the issues stay in the `lighthouse` object.

If Chrome cannot start or a page cannot be audited, the page gets an `info` issue `lighthouse-failed`, its `lighthouse` is `null` and the run continues. Pages that redirect to the same final URL are audited once and share the result. A failed run is only `info`, so it never changes the exit code, even with `--fail-on warning`.

## Checks

Rules follow what Google and the W3C actually say, not folklore, so severities are deliberately soft where Google does not require something. Each issue carries a `severity` (`error`, `warning` or `info`), a `category` (`seo`, `accessibility`, `performance` or `best-practice`) and a `source` URL to the documentation it is based on (see `src/sources.js`). Only errors affect the exit code, unless `--fail-on warning` is given.

### Page checks

| Group      | Rule                                                                                                                                                        | Severity        | Category                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------- |
| Images     | `missing-alt`: no `alt` attribute                                                                                                                           | error           | accessibility                 |
| Images     | `empty-alt-in-link`: empty alt on an image that is the only content of a link or button                                                                     | error           | accessibility                 |
| Images     | `empty-alt`: `alt=""` (correct for decorative images, flagged for review)                                                                                   | info            | accessibility                 |
| Images     | `alt-is-filename`: alt text repeats the file name                                                                                                           | warning         | accessibility                 |
| Images     | `missing-src`: no `src` or `srcset`                                                                                                                         | warning         | seo                           |
| Images     | `generic-filename`: e.g. `IMG00023.JPG`, `image1.jpg`                                                                                                       | info            | seo                           |
| Images     | `missing-dimensions`: no `width` or `height` (layout shift)                                                                                                 | warning         | performance                   |
| Forms      | `form-input-no-label`: field with no label, `aria-label`, `aria-labelledby` (pointing at real text) or `title`                                              | error           | accessibility                 |
| Links      | `link-no-name`: link with no text, `aria-label`, `aria-labelledby`, `title` or svg title (image-only links are reported by the image checks)                | error           | accessibility                 |
| Links      | `link-generic-text`: "click here", "read more" (may be clear in context, review)                                                                            | info            | accessibility                 |
| Links      | `link-empty-href`: `href="#"` or `javascript:` (often a script-driven control, review)                                                                      | info            | best-practice                 |
| HTML       | `duplicate-id`: an id used more than once. An error when a label or ARIA attribute points at it                                                             | warning / error | best-practice / accessibility |
| HTML       | `missing-main-landmark`: no `<main>` or `role="main"`                                                                                                       | info            | accessibility                 |
| Meta       | `missing-title`, `empty-title` (the title is also found outside `<head>`, but not inside an `<svg>`)                                                        | error           | seo                           |
| Meta       | `long-title`: over 60 characters                                                                                                                            | warning         | seo                           |
| Meta       | `missing-description` (Google may build the snippet from the page instead)                                                                                  | warning         | seo                           |
| Meta       | `long-description` (over 160) and `short-description` (under 70)                                                                                            | info            | seo                           |
| Meta       | `multiple-descriptions` (only one is used, the first non-empty one is checked; empty ones count toward the total)                                           | warning         | seo                           |
| Meta       | `missing-canonical` (also when the link is outside `<head>`, where Google ignores it)                                                                       | warning         | seo                           |
| Meta       | `multiple-canonicals`: several canonicals with different hrefs (conflicting signals)                                                                        | warning         | seo                           |
| Meta       | `multiple-canonicals`: several canonicals with identical hrefs (redundant)                                                                                  | info            | seo                           |
| Meta       | `relative-canonical`, `canonical-fragment`, `empty-canonical`                                                                                               | warning         | seo                           |
| Headings   | `missing-h1` (Google does not require one)                                                                                                                  | warning         | best-practice                 |
| Headings   | `multiple-h1` (Google does not mind)                                                                                                                        | info            | best-practice                 |
| Headings   | `skipped-heading-level`: e.g. `<h3>` with no preceding `<h2>`                                                                                               | warning         | accessibility                 |
| Headings   | `empty-heading` (no text, `aria-label`, `aria-labelledby` or image alt)                                                                                     | warning         | accessibility                 |
| Social     | `missing-open-graph`: no `og:*` tags (Google Search does not use them, they shape link previews)                                                            | info            | best-practice                 |
| Social     | `incomplete-open-graph`: `og:title`, `og:description` or `og:image` missing                                                                                 | info            | best-practice                 |
| Social     | `missing-twitter-card`: no `twitter:card`                                                                                                                   | info            | best-practice                 |
| Indexing   | `noindex`: `robots` or `googlebot` meta tag with `noindex` or `none` (often intentional). The `X-Robots-Tag` header is checked too and gives the same issue | warning         | seo                           |
| Indexing   | `nofollow`: `robots` or `googlebot` meta tag with `nofollow` or `none`                                                                                      | info            | seo                           |
| Indexing   | `missing-viewport`: no viewport meta tag                                                                                                                    | warning         | seo                           |
| Indexing   | `missing-lang`: no `lang` on `<html>`                                                                                                                       | warning         | accessibility                 |
| Hreflang   | `invalid-hreflang`: not `x-default` or a known language tag, e.g. `fi_FI`, `fin` or `en-UK` instead of `fi-FI`, `fi` or `en-GB`                             | warning         | seo                           |
| Hreflang   | `relative-hreflang`: the href is relative or empty                                                                                                          | warning         | seo                           |
| Hreflang   | `duplicate-hreflang`: one language listed with different URLs (conflicting)                                                                                 | warning         | seo                           |
| Hreflang   | `duplicate-hreflang`: one language listed more than once with the same URL (redundant)                                                                      | info            | seo                           |
| Hreflang   | `missing-self-hreflang`: the page lists alternates but not itself (its canonical counts as itself)                                                          | warning         | seo                           |
| Hreflang   | `missing-x-default`: the page lists alternates but no `x-default` (optional)                                                                                | info            | seo                           |
| Schema     | `invalid-json-ld`: a JSON-LD block that does not parse                                                                                                      | warning         | seo                           |
| Schema     | `json-ld-missing-context`: no `@context`                                                                                                                    | warning         | seo                           |
| Schema     | `json-ld-relative-url`: `url`, `image`, `logo`, `sameAs` or `contentUrl` is not absolute                                                                    | warning         | seo                           |
| Schema     | `unsupported-schema-type`: HowTo, FAQPage and other types Google's search gallery has no rich result for                                                    | info            | seo                           |
| Schema     | `missing-schema-property`: Product without `name` and one of `offers`, `review`, `aggregateRating`; BreadcrumbList without `itemListElement`                | warning         | seo                           |
| URL        | `long-url` (over 100 characters), `url-underscores`, `url-uppercase`                                                                                        | info            | seo                           |
| HTML       | `html-too-large`: over 2 MB, the part Googlebot reads and the checks look at                                                                                | warning         | seo                           |
| HTML       | `mixed-content`: `http://` resource on an `https` page                                                                                                      | warning         | best-practice                 |
| HTML       | `client-side-rendered`: almost no text and an empty app root, so the raw HTML results may be incomplete                                                     | info            | best-practice                 |
| Response   | `fetch-failed`: network error, timeout or more than 10 redirects                                                                                            | error           | seo                           |
| Response   | `check-failed`: HTML the checks could not process (the HTML checks are skipped)                                                                             | error           | best-practice                 |
| Response   | `http-status`: any status other than 200 (the HTML checks are skipped)                                                                                      | error           | seo                           |
| Response   | `not-html`: the content type is not HTML, for example a PDF in a sitemap (the HTML checks are skipped)                                                      | info            | seo                           |
| Response   | `redirect-chain`: more than one redirect before the final page                                                                                              | warning         | seo                           |
| Response   | `redirect`: one redirect (the final URL is audited)                                                                                                         | info            | seo                           |
| Lighthouse | `lcp-slow`, `cls-high`, `tbt-high`: lab LCP over 2.5 s, CLS over 0.1, TBT over 200 ms (warning past 4 s, 0.25, 600 ms)                                      | info or warning | performance                   |
| Lighthouse | `score-low-performance`, `-accessibility`, `-best-practices`, `-seo`: category score under 90 (warning under 50)                                            | info or warning | per category                  |

### Site checks

These run after every page is audited and compare the pages that returned HTML. Site issues list the pages involved in `urls` instead of a single `url`.

| Rule                                                                                                                                                                     | Severity | Category      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------- |
| `duplicate-title`: the same title (ignoring case and whitespace runs) on several pages                                                                                   | warning  | seo           |
| `duplicate-description`: the same meta description on several pages                                                                                                      | warning  | seo           |
| `duplicate-h1`: the same `<h1>` text on several pages                                                                                                                    | warning  | best-practice |
| `canonical-elsewhere`: the canonical points to a different URL (often intentional, so informational)                                                                     | info     | seo           |
| `hreflang-missing-return`: an audited alternate does not list the page back, so Google ignores the pair                                                                  | warning  | seo           |
| `hreflang-target-noindex`: an audited alternate is `noindex` (meta tag or header)                                                                                        | warning  | seo           |
| `hreflang-target-canonicalised`: an audited alternate has a canonical pointing elsewhere                                                                                 | warning  | seo           |
| `blocked-by-robots`: the site's `robots.txt` does not let Googlebot crawl the page (the page is still audited)                                                           | warning  | seo           |
| `robots-txt-unreachable`: `robots.txt` answers 5xx or 429                                                                                                                | info     | seo           |
| `robots-txt-failed`: the request for `robots.txt` failed (a timeout, a reset connection), so its rules were not checked                                                  | info     | seo           |
| `sitemap-url-noindex`: a page listed in a sitemap is `noindex` (meta tag or header)                                                                                      | warning  | seo           |
| `sitemap-url-not-canonical`: a page listed in a sitemap has a canonical pointing elsewhere                                                                               | warning  | seo           |
| `sitemap-url-redirects`: a URL listed in a sitemap redirects                                                                                                             | info     | seo           |
| `sitemap-too-many-urls`: a sitemap file lists more than 50,000 entries                                                                                                   | error    | seo           |
| `sitemap-too-large`: a sitemap file is over 50 MB uncompressed                                                                                                           | error    | seo           |
| `sitemap-empty-loc`: a sitemap entry has an empty or missing `<loc>`                                                                                                     | warning  | seo           |
| `sitemap-loc-relative`: a sitemap lists a relative address                                                                                                               | warning  | seo           |
| `sitemap-loc-malformed`: a sitemap lists an address that cannot be parsed as a URL (`https://`)                                                                          | warning  | seo           |
| `sitemap-loc-not-http`: a sitemap lists an address that is not http or https                                                                                             | warning  | seo           |
| `sitemap-duplicate-loc`: a sitemap lists the same `<loc>` more than once                                                                                                 | info     | seo           |
| `sitemap-invalid-lastmod`: a `<lastmod>` is not a W3C date (`2026-03-31`, or with a time and zone)                                                                       | warning  | seo           |
| `sitemap-off-host`: a sitemap lists URLs on another host, and that host's `robots.txt` does not name the sitemap                                                         | info     | seo           |
| `no-sitemap-declared`: `robots.txt` was read and has no `Sitemap:` line (not checked when `--sitemap` is used)                                                           | info     | seo           |
| `missing-hsts`: an https page has no `Strict-Transport-Security` header, or one with `max-age=0`                                                                         | warning  | best-practice |
| `missing-x-content-type-options`: no `X-Content-Type-Options: nosniff`                                                                                                   | info     | best-practice |
| `missing-clickjacking-protection`: neither `X-Frame-Options` (`DENY` or `SAMEORIGIN`) nor an enforced CSP `frame-ancestors`, or a `frame-ancestors` that allows any site | info     | best-practice |
| `weak-csp`: the enforced `Content-Security-Policy` allows inline scripts (`'unsafe-inline'` without a nonce, hash or `'strict-dynamic'`) or `'unsafe-eval'`              | info     | best-practice |
| `no-compression`: the HTML is 1.4 KB or more and sent without `Content-Encoding`                                                                                         | info     | performance   |
| `broken-link` (with `--check-links`): an internal link leads to a 404, 410 or another 4xx (not 401, 403 or 407)                                                          | warning  | seo           |
| `link-target-unreachable` (with `--check-links`): an internal link target answers 5xx or 429, or does not load (timeout, network error)                                  | info     | seo           |
| `link-to-redirect` (with `--check-links`): an internal link points to an address that redirects                                                                          | info     | seo           |
| `orphan-page` (with `--check-links` and a whole `--sitemap`): a sitemap page that no other audited page links to                                                         | info     | seo           |

The `robots.txt` of every audited origin is read once and tested for `Googlebot`, following Google's rules: a missing file (any 4xx except 429) allows everything, the most specific user agent group and the longest matching rule win, `Allow` wins a tie, and only the first 500 KiB are read. The `sitemap-url-*` checks only look at audited pages that were listed in a `--sitemap`, so `--limit` narrows them. The file checks (size, entries, addresses, dates) look at every sitemap file that was read, a sitemap index and each child it points to, before duplicates are removed or `--limit` is applied. pageaudit does not obey `robots.txt` itself: blocked pages are fetched and audited, and then listed.

The hreflang checks read only `<link rel="alternate" hreflang>` tags in `<head>`. Google also accepts hreflang in a `Link` HTTP header and in a sitemap (`xhtml:link`), and those are out of scope: a site that declares its alternates only there gets no hreflang issues, and a header or sitemap that supplies a missing return link is not seen. The page checks only run on pages that declare alternates, so a site with one language is never asked for them. The site checks only judge alternates that were themselves audited and returned HTML: an alternate outside the audit, or one that failed, is not reported, so audit every language version together to check the whole set. An input that redirects is matched under both its own URL and its final one.

The response header checks look at the final response of every page that returned HTML. Headers are nearly always set for a whole site, so the pages of one origin with the same finding are one issue, listed in `urls`, with the first page's header as the evidence. The finding decides the group, not the exact header, so a CSP nonce that changes on every response does not split it. A missing `Content-Security-Policy` is not a finding, and neither is a policy that does not govern scripts (a common `frame-ancestors`-only policy). Script rules follow the CSP fallback order (`script-src-elem` or `script-src-attr`, then `script-src`, then `default-src`). An enforced `frame-ancestors` replaces `X-Frame-Options` in browsers, so one that allows any site (`*`, `https:`) is reported even next to `X-Frame-Options: DENY`. Repeated headers are read like a browser does: the first `Strict-Transport-Security` and `X-Content-Type-Options` value counts, an HSTS header with a repeated directive or a malformed `max-age` is ignored, and several different `X-Frame-Options` values block framing when one of them is `DENY`, `SAMEORIGIN` or `ALLOWALL`, as the HTML standard says. A `Content-Security-Policy-Report-Only` policy blocks nothing, so it is never counted as protection, and the clickjacking message says when it is the only place `frame-ancestors` appears. Pages are fetched with `Accept-Encoding: gzip, deflate, br`, like Googlebot. `Cache-Control` and `Referrer-Policy` are not checked: the right value depends too much on the site.

With `--check-links`, every internal link of the audited pages is followed to see where it leads. Internal means the same host, with `www.` treated as the same site, and the fragment is dropped. A link to a page that was audited reuses that page's result, and every other target is requested once, with the same `--concurrency` as the pages and the same `--delay`, which applies before every request of the run, redirect hops included. Waiting for the delay does not count toward the 15 second timeout. The request is a GET whose body is not read, not a HEAD, because many servers answer HEAD with 404 or 405 for pages that work. Each target is one issue, listing the pages that link to it in `urls`, and a redirect that ends on an error is reported as the error only. At most 500 targets are requested, the ones linked from the most pages first, so shared navigation is always checked, and the number left unchecked is printed. External links are not checked, many sites answer automated requests with 403 or 999 whatever the link. `orphan-page` only runs when a `--sitemap` was given, every file of a sitemap index was read, `--limit` cut nothing, and every page and link target was followed to a known destination (none left unchecked, none that failed or answered 429 or a server error) and every page's links were read (none whose checks failed or whose HTML was cut at 2 MB): otherwise the audit may miss the pages that link in, and linked pages would look orphaned. A link counts for the page its request ended on, so a link to an address that redirects counts for the final page and a broken `/x/` is no link to `/x`. The home page is never an orphan.

Pages count as one page when they end up at the same final URL or declare the same canonical, so `/list` and `/list?sort=asc` with a canonical of `/list` are not duplicates of each other. Missing or empty values are never duplicates, they are already reported per page.

The length limits (60, 160, 70) are heuristics, not official rules: Google states there is no limit and truncates by pixel width. Empty alt is only an error when it leaves a link or button without any accessible name.

Before checking, `<template>` elements are removed because their content is inert. Elements nested deeper than 513 levels are moved up to their parent's parent, as Chrome's parser does, so a deeply nested page is checked as Google renders it. Whitespace runs in the title, description and heading text are collapsed before measuring, like browsers do, and issue contexts are capped at 120 characters. The link checks are the exception: their context is made of addresses, and the final address of a redirect is what the link should be changed to, so each address is kept whole up to 2000 characters.

`fetchPage` decodes the body the way browsers do: a BOM wins, then the `Content-Type` charset, then a `<meta charset>` or `http-equiv` prescan of the first 1024 bytes, then UTF-8. Fetch failures report the underlying cause (error code or message), for example `Could not fetch the page: ENOTFOUND`.

## Where the rules come from

The rules were researched in September 2026 (with the same AI agent that wrote the code) from Google Search Central, web.dev and the W3C Web Accessibility Initiative. The URLs live in `src/sources.js` and every issue links to its source in the JSON output.

| Source                                                                                                                                                                                                                                                                                                                                                                             | What it says                                                                                                                                                                                                                                                                                                                                     | Rules based on it                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [Google: title links](https://developers.google.com/search/docs/appearance/title-link)                                                                                                                                                                                                                                                                                             | Every page should have a `<title>`, and each page's title should be distinct. "No limit" on length, but it is truncated "typically to fit the device width". No numeric guidance.                                                                                                                                                                | `missing-title`, `empty-title`, `long-title`, `duplicate-title`                                                                  |
| [Google: snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet)                                                                                                                                                                                                                                                                             | No length limit, truncated to fit the device width. The meta description is only "sometimes" used, snippets mostly come from page content. Descriptions should be unique and specific, and too-short or generic ones are given as bad examples.                                                                                                  | `missing-description`, `long-description`, `short-description`, `duplicate-description`                                          |
| [Google: canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)                                                                                                                                                                                                                                                                   | Use absolute URLs, add a self-referencing canonical, only `<head>` is accepted, do not send conflicting signals, fragments are generally not supported.                                                                                                                                                                                          | `missing-canonical`, `multiple-canonicals`, `relative-canonical`, `canonical-fragment`, `empty-canonical`, `canonical-elsewhere` |
| [Google: localized versions (hreflang)](https://developers.google.com/search/docs/specialty/international/localized-versions)                                                                                                                                                                                                                                                      | Language in ISO 639-1, optional script in ISO 15924 and region in ISO 3166-1 alpha-2. Use fully-qualified URLs. Each version lists itself and every other version, and if two pages do not both point to each other the tags are ignored. `x-default` is recommended for unmatched languages. HTML, HTTP headers and sitemaps are all supported. | `invalid-hreflang`, `relative-hreflang`, `missing-self-hreflang`, `missing-x-default`, `hreflang-missing-return`                 |
| [Google: image SEO](https://developers.google.com/search/docs/appearance/google-images)                                                                                                                                                                                                                                                                                            | Google finds images in the `src` of `<img>` (not CSS backgrounds). Use short descriptive file names, not `IMG00023.JPG` or `image1.jpg`. Avoid keyword-stuffed alt text.                                                                                                                                                                         | `missing-src`, `generic-filename`, `alt-is-filename`                                                                             |
| [Google: redirects](https://developers.google.com/search/docs/crawling-indexing/301-redirects)                                                                                                                                                                                                                                                                                     | Explains permanent and temporary redirects and recommends server-side redirects.                                                                                                                                                                                                                                                                 | `redirect`, `redirect-chain`, `link-to-redirect`                                                                                 |
| [Google: link best practices](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)                                                                                                                                                                                                                                                                         | Google uses links to find new pages to crawl and as a signal of relevance. "Every page you care about should have a link from at least one other page on your site."                                                                                                                                                                             | `broken-link`, `link-target-unreachable`, `orphan-page`                                                                          |
| [Open Graph protocol](https://ogp.me/)                                                                                                                                                                                                                                                                                                                                             | The tags that control link previews on social and chat apps. Google Search does not use them.                                                                                                                                                                                                                                                    | `missing-open-graph`, `incomplete-open-graph`, `missing-twitter-card`                                                            |
| [Lighthouse: viewport](https://developer.chrome.com/docs/lighthouse/pwa/viewport) and [WCAG 3.1.1](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html)                                                                                                                                                                                                              | Without a viewport tag mobile browsers render at desktop width. The page language must be programmatically set.                                                                                                                                                                                                                                  | `missing-viewport`, `missing-lang`                                                                                               |
| Google structured data: [search gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery), [Product](https://developers.google.com/search/docs/appearance/structured-data/product-snippet), [breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)                                                      | The gallery lists the types with a rich result (HowTo, FAQ and others are not in it). Product needs `name` and one of `offers`, `review`, `aggregateRating`, BreadcrumbList needs `itemListElement`.                                                                                                                                             | `unsupported-schema-type`, `missing-schema-property`, `invalid-json-ld`, `json-ld-missing-context`, `json-ld-relative-url`       |
| Google: [URL structure](https://developers.google.com/search/docs/crawling-indexing/url-structure), [Googlebot](https://developers.google.com/search/docs/crawling-indexing/googlebot), [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) and [web.dev mixed content](https://web.dev/articles/what-is-mixed-content) | Hyphens over underscores, URLs are case sensitive, no length limit. Googlebot reads the first 2 MB of an HTML file. Pages built in the browser are rendered later. Active mixed content is blocked.                                                                                                                                              | `long-url`, `url-underscores`, `url-uppercase`, `html-too-large`, `client-side-rendered`, `mixed-content`                        |
| [Google: robots meta tag and X-Robots-Tag](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)                                                                                                                                                                                                                                                            | `noindex` keeps a page out of search results, `nofollow` stops link following. The same rules can be sent in an `X-Robots-Tag` header, comma separated, with an optional user agent prefix such as `googlebot: noindex`.                                                                                                                         | `noindex`, `nofollow`                                                                                                            |
| [Google: robots.txt](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt)                                                                                                                                                                                                                                                                                | 4xx (except 429) means no robots.txt, 5xx pauses crawling and Google falls back to a cached copy for up to 30 days. The most specific user agent group and the longest matching rule win, `allow` wins a tie, content after 500 KiB is ignored.                                                                                                  | `blocked-by-robots`, `robots-txt-unreachable`                                                                                    |
| [Google: build a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)                                                                                                                                                                                                                                                                      | List the canonical URLs you want in search results.                                                                                                                                                                                                                                                                                              | `sitemap-url-not-canonical` (and, as judgment calls, `sitemap-url-noindex`, `sitemap-url-redirects`)                             |
| [web.dev: security headers quick reference](https://web.dev/articles/security-headers)                                                                                                                                                                                                                                                                                             | HSTS, `X-Content-Type-Options: nosniff` and `X-Frame-Options` (or CSP `frame-ancestors` for finer control) are recommended for all sites. A strict CSP uses nonces or hashes, and browsers that support them ignore `'unsafe-inline'`.                                                                                                           | `missing-hsts`, `missing-x-content-type-options`, `missing-clickjacking-protection`, `weak-csp`                                  |
| [Lighthouse: enable text compression](https://developer.chrome.com/docs/lighthouse/performance/uses-text-compression)                                                                                                                                                                                                                                                              | Text responses should be sent with `br`, `gzip` or `deflate`. Responses under 1.4 KiB are skipped.                                                                                                                                                                                                                                               | `no-compression`                                                                                                                 |
| [Google: HTTP status codes and network errors](https://developers.google.com/search/docs/crawling-indexing/http-network-errors)                                                                                                                                                                                                                                                    | Google's crawlers follow up to 10 redirect hops. Content from URLs that return a 4xx status is not used, and even a 2xx does not guarantee indexing.                                                                                                                                                                                             | `http-status`, `fetch-failed`, the 10-redirect limit                                                                             |
| [Google: indexable file types](https://developers.google.com/search/docs/crawling-indexing/indexable-file-types)                                                                                                                                                                                                                                                                   | Lists the non-HTML file types Google can index, such as PDF, so a non-HTML URL is not a problem in itself.                                                                                                                                                                                                                                       | `not-html`                                                                                                                       |
| [Google: SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)                                                                                                                                                                                                                                                                              | Heading order and count do not matter for Search. Good titles and descriptions are unique and concise. Good alt text is "quite important".                                                                                                                                                                                                       | `missing-h1`, `multiple-h1`, `duplicate-h1` (as best practice only)                                                              |
| [web.dev: optimize CLS](https://web.dev/articles/optimize-cls)                                                                                                                                                                                                                                                                                                                     | Set `width` and `height` on images so the browser reserves space. Good CLS is 0.1 or less.                                                                                                                                                                                                                                                       | `missing-dimensions`                                                                                                             |
| [W3C WAI: decorative images](https://www.w3.org/WAI/tutorials/images/decorative/)                                                                                                                                                                                                                                                                                                  | Purely decorative images should have `alt=""`. Omitting `alt` makes some screen readers read out the file name. Only the author can tell if an image is decorative.                                                                                                                                                                              | `missing-alt`, `empty-alt`, `empty-alt-in-link`                                                                                  |
| [W3C WAI: headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)                                                                                                                                                                                                                                                                                                     | Nest headings by rank, and avoid skipping ranks (an `<h2>` directly followed by an `<h4>`).                                                                                                                                                                                                                                                      | `skipped-heading-level`, `empty-heading`                                                                                         |

Judgment calls that are not straight from those pages:

- **robots.txt, X-Robots-Tag and sitemap checks:** `blocked-by-robots` is a warning because blocking is often intentional, `robots-txt-unreachable` only an info because Google keeps using its cached copy for up to 30 days, and `robots-txt-failed` (the request itself failed while the page loaded) is an info too, so a flaky `robots.txt` is reported instead of passing as "no rules". Google's sitemap page says to list the canonical URLs you want in results but does not say anything about `noindex` or redirects, so `sitemap-url-noindex` (warning) and `sitemap-url-redirects` (info) follow from that sentence rather than from a stated rule. Repeated `X-Robots-Tag` headers arrive joined with a comma and `fetch` cannot return them separately, so a user agent prefix is taken to apply to every rule after it. A `noindex` header that follows one for another crawler (`bingbot: nofollow`) is therefore missed. The header is only checked on 200 responses, because error pages are often `noindex` on purpose. A page that says `noindex` in both its meta tag and its header is one issue with both sources. Only the `robots.txt` of the origin a page ended up on is read, a `Disallow` on the origin it was redirected from is not checked, and more than five redirects on the `robots.txt` count as no file, like Google. Two rare differences from Google remain in `robots-parser`: `/%7Ex` and `/~x` are not treated as equal, and `User-agent: Googlebot*` does not match Googlebot. A sitemap on one host that lists URLs on another is common and allowed when the other host names the sitemap in its `robots.txt` or it was submitted in Search Console, so `sitemap-off-host` is only an info, looks at the first 20 hosts of each file and cannot see Search Console. `no-sitemap-declared` is also an info, and discovered sitemaps are not audited. A sitemap is only blamed for a redirect when it lists the same spelling of the URL that was fetched (`/blog/` and `/blog` are the same page, so a sitemap listing one may already list the final URL).
- **Social, indexing and hygiene checks:** Open Graph and Twitter tags are info only, Google Search does not use them. `noindex` is a warning, not an error, because it is often intentional. The 100 character URL limit is a heuristic, Google gives no limit. The `unsupported-schema-type` list and the required properties for Product and BreadcrumbList come from Google's search gallery and structured data docs. The `client-side-rendered` check is a heuristic on empty `#root`, `#app`, `#__next`, `#__nuxt` or `#svelte` containers and a `noscript` message.

- **Severity of `missing-h1` and `multiple-h1`:** Google's John Mueller has said several times that pages rank fine with no h1 or with several, for example "Your site is going to rank perfectly fine with no H1 tags or with five". These quotes were found through search-result summaries of secondary blogs, not a Google page, so they are the weakest-sourced part. The W3C headings page does not address a single h1.
- **Length limits (60 and 160 characters, minimum 70):** common SEO heuristics, not Google rules. Real truncation depends on pixel width (roughly 580 to 600px for titles on desktop), so characters are only a proxy.
- **`empty-alt-in-link` as an error:** derived from the W3C decorative-image guidance. An image that is the only content of a link needs an accessible name, so an empty alt there leaves the link unnamed.
- **`missing-src` and `generic-filename`:** based on Google's statement that images are found via `src` and its file name advice, but the exact patterns (`IMG`, `DSC`, `image1` and so on) are my own list.
- **Response and site severities:** `redirect-chain` and the duplicate rules as warnings, `redirect`, `not-html` and `canonical-elsewhere` as infos, and every non-200 status as an error are my own calls. Google's redirect page does not warn against chains, flagging them follows from the hop limit and from each hop being an extra request.
- **Response header checks:** the severities are my own calls. `missing-hsts` is a warning because it is the one header web.dev recommends for every https site with no trade-off, and it is never reported over plain http, where browsers ignore it. The rest are infos: they are defences in depth, and sites that are meant to be embedded legitimately allow framing. `weak-csp` only judges scripts, the part of a policy that stops injected code, and with several policies a weakness counts only when every policy has it. Grouping per origin is a choice for a short report: a page whose headers differ from the rest of its origin still gets its own issue. With `--lighthouse` the same topics can also appear among the Lighthouse audits, which measure them in Chrome; these checks run without Chrome.
- **Link checks:** the severities are my own calls. `broken-link` is a warning because a visitor lands on an error page. 401, 403 and 407 are not counted as broken, they usually mean a login area. 429 and 5xx are only `link-target-unreachable` infos, because they can be temporary or caused by the audit itself. `link-to-redirect` is an info: Google follows redirects, the fix only saves a hop. `orphan-page` is an info and one issue for all such pages, because a page found only through the sitemap is still indexed. Link checking is opt-in because it can add hundreds of requests to an audit.
- **Hreflang checks:** codes are judged leniently, so only clear mistakes are flagged. Google's page asks for ISO 639-1 languages and ISO 3166-1 regions, but three-letter languages without a two-letter code (`fil`) and numeric regions (`es-419`) are valid language tags and are accepted. Flagged are a wrong separator (`fi_FI`), a three-letter form of a two-letter language (`fin`, `eng`), codes that are reserved or not a region (`UK`, `EU`, `UN`), and codes Node's `Intl` does not know, such as `xx` or `en-XX`. `duplicate-hreflang`, `hreflang-target-noindex` and `hreflang-target-canonicalised` are my own calls: Google does not mention them, but a duplicate leaves Google to pick one URL, and a noindex or canonicalised alternate cannot be shown as itself. `missing-x-default` is only an info because `x-default` is recommended, not required.
- **Summaries, not full reads:** the pages were read through an AI summarizer, so exact wording should be checked against the linked page before quoting it.

## Architecture

```
bin/pageaudit.js        entry point, calls run() (or with no arguments asks for the setup) and sets the exit code
src/
  cli.js                arg parsing, spinner, wires the pipeline together
  wizard.js             askArgs(): the questions asked when run with no arguments in a terminal, turned into arguments
  input/
    args.js             URLs from CLI arguments
    file.js             URLs from --urls-file (or stdin), with the optional lighthouse marker
    sitemap.js          URLs from --sitemap, following a sitemap index one level deep
    resolve.js          merge, normalize, dedupe, apply --limit
  lighthouse.js         runLighthouse(urls): optional Lighthouse run, trimmed to scores, metrics and failing audits
  lighthouse-detail.js  the affected items, descriptions and savings of a failing audit
  lighthouse-issues.js  lighthouseIssues(): slow LCP, CLS, TBT and low scores as issues
  advice.js             plain-language title, why and fix for every issue type, for the HTML and JSON reports
  issue-id.js           issueId(): a stable short id per issue
  concurrency.js        mapLimited() and hostThrottle(): a concurrency limit and a per-host delay
  lighthouse-limits.js  the good and poor bands of the Lighthouse metrics
  output.js             writeReportFile(): writes a report file without throwing
  html/                 the customer-facing HTML report
    render.js           renderHtml(): the whole document
    sections.js         cover, summary, what to fix, pages and method sections
    model.js            grouping issues, page health, average scores, metric bands
    detail.js           collapsed evidence: the element behind an issue, Lighthouse items and the less visible facts
    format.js           category names, plurals and links shared by the sections
    styles.js           the stylesheet (light, dark and print)
    escape.js           the markup tag that escapes everything it is given
    logo.js             reads a logo file into a data URI
  fetch.js              fetchPage(url): redirects, timeout, User-Agent, encoding sniffing, X-Robots-Tag
  robots.js             loadRobots(origin): reads and parses a robots.txt the way Google treats the answer
  links.js              checkLinkTargets(): where the internal links lead, for --check-links
  parse.js              parse(html): Cheerio DOM, with inert <template> content removed and the depth capped like Chrome
  runner.js             runs the page checks over all URLs with concurrency and a per-host delay
  text.js               collapseWhitespace() and charCount() shared by the checks
  checks/
    page/               checks on one page, each returns an array of issues
      images.js
      meta.js
      headings.js
      response.js       status, redirects, content type and fetch failures
      social.js         Open Graph and Twitter card
      indexing.js       noindex, nofollow, viewport and lang
      structured-data.js  JSON-LD validation
      hreflang.js       hreflang codes, URLs, duplicates, self link and x-default
      links.js          link names, generic link text and empty hrefs
      a11y.js           form labels, duplicate ids and the main landmark
      accname.js        accessibleName(): a simplified accessible name for links and form controls
      hygiene.js        URL, HTML size, mixed content and client-side rendered pages
      robots-header.js  the X-Robots-Tag header
      signals.js        extractSignals() and jsonLdBlocks(): content and metadata signals stored in the facts
      content.js        mainText(), headingExcerpts() and imageSamples(): page text, section excerpts and image context for the facts
      index.js          checkHtml() and extractFacts(): facts for the site checks and the report
    site/               checks across pages, run after every page is done
      duplicates.js
      canonical.js
      hreflang.js       checkHreflangTargets(): return links, noindex and canonicalised alternates
      headers.js        checkResponseHeaders(): security headers and compression, one issue per origin
      links.js          checkLinks(): broken, unreachable and redirecting link targets, and orphan pages
      robots.js         checkRobotsTxt(): pages the robots.txt blocks
      sitemap.js        checkSitemapEntries(): pages a sitemap lists that send mixed signals
      index.js          checkSite()
    evidence.js         the selector, html and parentHtml of the element behind an issue
    snippet.js          truncate()/snippet(): caps issue contexts at 120 characters
  severity.js           countSeverities(), worstFirst() and severity ordering, shared by every report
  sources.js            documentation URLs referenced by each issue's `source` field
  report.js             buildReport(): the JSON report (with SCHEMA_VERSION)
  terminal.js           formatReport(): the report as tables for the terminal
schema/
  report.schema.json    JSON Schema of the JSON report
test/
  schema.test.js        reports from the fixtures against the schema, and drift checks
  input.test.js         URL files, sitemaps and normalization, against fixtures
  runner.test.js        runner with a mocked fetchPage: concurrency, delay, failures
  site.test.js          site checks over runner results
  checks.test.js        unit tests for each page check
  a11y.test.js          form labels, duplicate ids, the main landmark and link names
  parse.test.js         template removal and the DOM depth cap
  fetch.test.js         fetchPage: redirects, User-Agent, encoding sniffing, errors
  robots.test.js        robots.txt loading and Googlebot matching, and the X-Robots-Tag header
  lighthouse.test.js    trimming a Lighthouse result and running Chrome, with its failures
  lighthouse-issues.test.js  Lighthouse metrics and scores as issues
  report.test.js        the JSON report: summary, rules, ids and capped facts
  terminal.test.js      terminal tables and wrapping
  severity.test.js      severity counting and ordering
  html.test.js          HTML report: sections, escaping, self-containment, advice coverage
  signals.test.js       content and metadata signals of a page
  headers.test.js       response header checks and the Content-Security-Policy parser
  links.test.js         link targets, the per-host throttle and the link checks
  cli.test.js           run() end to end with --json against the fixtures
  fixtures/             HTML pages, sitemap.xml, sitemap-index.xml and urls.txt
  helpers/fixture-fetch.js   mocked fetch that serves the fixtures
  helpers/report-pages.js    audited pages and site issues for the report and terminal tests
docs/seo-harness-plan.md     the original v1 plan
docs/pageaudit-v2-plan.md    the v2 (multi-page) plan
docs/pageaudit-v3-lighthouse-plan.md          the v3 (Lighthouse) plan
docs/pageaudit-v4-page-data-html-report.md    the v4 (page data and HTML report) plan
```

Pipeline: inputs -> `resolveUrls` -> `runAudit` (`fetchPage` -> `checkResponse` -> `parse` -> `checkHtml` per page) -> `checkSite`, `checkRobotsTxt`, `checkSitemapEntries` and, with `--check-links`, `checkLinkTargets` -> `checkLinks` -> `buildReport` -> table or JSON.

`fetchPage(url, { timeout, beforeHop })` returns `{ url, finalUrl, status, redirects, contentType, html, truncated, robotsHeader, headers, bodyBytes }` and only throws for network failures. `html` holds at most the first 2 MiB of the body (`HTML_MAX_BYTES`), and `truncated` is true when there was more. `beforeHop(url)` is awaited before every request of the redirect chain, so the per-host `--delay` also spaces redirect hops. It is the only thing the runner needs from the network layer, so a headless browser can replace it without touching the checks or the runner, as long as it returns the same shape and calls `beforeHop` the same way.

Every page issue has the same shape, so `report.js` has no per-check special cases:

```js
{
  id: 'missing-alt-3f2a9c1e',     // type plus a hash of the page and the element, see src/issue-id.js
  url: 'https://example.com/',    // the page, as given in the input
  type: 'missing-alt',            // machine-readable identifier
  severity: 'error',              // 'error' | 'warning' | 'info'
  category: 'accessibility',      // 'seo' | 'accessibility' | 'performance' | 'best-practice'
  source: 'https://www.w3.org/WAI/tutorials/images/decorative/',
  message: 'Image missing alt attribute',
  context: '<img src="/a.jpg">'   // snippet for locating the problem
  // optional: selector, html, parentHtml (the element behind the issue), actual and expected (length checks)
}
```

Site issues have the same fields except that `url` is replaced by `urls`, the list of pages involved.

The JSON report is meant to be handed to a human or an LLM for prioritizing fixes, so its shape is kept stable (`schema/report.schema.json` has the details):

```js
{
  schemaVersion: 1,
  generatedAt: '2026-10-15T08:00:00.000Z',
  pages: [{ url, finalUrl, status, redirects: [{ url, status, location }], issues: [...], facts, lighthouse }],
  site: [...],                    // site issues
  skipped: [{ input, source, reason }],
  rules: { [type]: { title, why, fix } },
  lighthouseAudits: { [id]: { description, learnMore } },
  summary: { pages, errors, warnings, infos }
}
```

`lighthouse` is only present on pages Lighthouse ran for, and `lighthouseAudits` only when an audit is described.

`status` and `finalUrl` are `null` when the page could not be fetched at all.

## Testing

Tests use the built-in `node:test` runner with no extra dependencies. `npm test` runs `node --test test/*.test.js`, so helpers in `test/helpers/` are not run as tests. Nothing touches the network.

- Unit tests cover each rule firing, not firing and the length boundaries.
- HTML fixtures cover the positive and negative cases: `good.html` has no issues, `duplicate.html` shares its title, description and h1 with `good.html`, the `bad-*.html` files (`overlong`, `missing`, `canonical`, `images`, `empty`, `markup`, `hreflang`) trigger the remaining rules, and `hreflang.html` and `hreflang-fi.html` are a language pair with a missing return link and a `noindex` alternate. `noindex.html`, `noindex-header.html` and `blocked.html` feed the indexing, robots.txt and sitemap checks, `sitemap-quality.xml` lists them for the sitemap checks, and `rich.html` carries every kind of metadata for the signals tests. Several bad files are needed because some rules are mutually exclusive, for example a title cannot be both missing and too long.
- Input tests read `urls.txt` (comments, duplicates, invalid lines), `sitemap.xml` and `sitemap-index.xml` (which lists `sitemap.xml`, a nested index that is not followed and a missing child sitemap).
- Runner and site check tests pass a mocked `fetchPage` to `runAudit`, so concurrency, the per-host delay and failures are tested without HTTP.
- CLI tests call `run()` with `--json` and `globalThis.fetch` mocked (`test/helpers/fixture-fetch.js`). Requests to `https://fixtures.test/<name>` are served from `test/fixtures/<name>`, `/timeout`, `/not-html`, `/server-error`, `/redirect-once` and `/redirect-twice` simulate other responses, and `links.html` links to each kind of target for the link checks. Every fixture page is served with a secure set of response headers, except `weak-headers.html`, which tests the header checks, and unknown names and other hosts fail with a 404 or a network error. This exercises the real input, fetch, parse, check, report and exit-code path. The terminal output is not run through `run()`; it is covered by the `test/terminal.test.js` unit tests.

## Limitations and out of scope

- Only the raw HTML from the initial fetch is inspected (Cheerio, no JavaScript execution), so client-side rendered content is not seen. The fix would be swapping `fetchPage` for a headless browser.
- Pages are only discovered from arguments, URL files and sitemaps. `--check-links` checks where internal links lead, but the pages it finds are not audited.
- `robots.txt` is read only to report blocked pages (`blocked-by-robots`), it is not obeyed: pages it disallows are audited like any other.
- Not included: any LLM calls, config files or plugins. Lighthouse is opt-in and the static checks still use the raw HTML only. The report is meant to be handed to a human or an LLM afterwards for judgment calls.

## Workflow

Work is done on `feature/*`, `fix/*` or `docs/*` branches and merged into `main`.
