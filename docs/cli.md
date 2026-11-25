# Using the CLI

The details behind the Usage section of the README.

## Run with no arguments

Run with no arguments in a terminal, `pageaudit` asks what to audit: page URLs (several separated by spaces), a sitemap or a URL file, for a sitemap or file how many pages at most, which extra checks to run (Lighthouse and internal links) and which report files to write: the HTML report with its title, client and logo, the JSON report, the digest and the page content. Each report file is suggested a name of the site and the local date and time, such as `example.com-2026-10-26-1430.html`, with `example.com-2026-10-26-1430-content` for the page content: Enter takes the suggestion and Tab puts it in to be edited. A report path must be a file in a folder that exists, and an existing file is only replaced after asking. The page content folder may not exist yet, and only the files an earlier audit wrote there are replaced. Answers are checked as they are entered, so a bad URL, a file that cannot be read or a wrong limit is asked again. It then shows the command for the audit, quoted and wrapped to the terminal width with `\` so it can be pasted into a shell or a script, and asks whether to run it now. Yes runs the audit as that command would, with the same output and exit code. No exits 0 without sending a request, so the command can be run later. Ctrl+C at any question exits 130. Without a terminal on stdin and stdout, as in scripts and CI, no arguments is still a usage error.

## Inputs

Arguments, `--urls-file` and `--sitemap` can be combined, and the last two can be repeated. All URLs are merged in that order and deduplicated: the host is compared case-insensitively, fragments (`#...`) are dropped, query strings are kept and a trailing slash on the path is ignored, so `/x` and `/x/` are the same page. The first spelling seen is the one fetched.

- Inputs that are not `http` or `https` URLs are skipped with the reason and where they came from (for example `urls.txt:8`). One bad URL never aborts the run, but a URL file that cannot be read or a sitemap that cannot be fetched exits 2.
- A sitemap index is followed one level deep. Child sitemaps that fail, or that are themselves indexes, are skipped with the reason. Each sitemap file is read once in a run, also when an index lists it twice or lists itself, or when it is given twice or also listed by another `--sitemap`. Gzipped sitemap files (`.xml.gz`) are supported. A sitemap file larger than 50 MB uncompressed is skipped too, as Google rejects it whole: reading stops at 50 MB and the file is reported as `sitemap-too-large`.
- `--limit <n>` audits only the first `n` URLs after deduplication.

Link-following crawling is not supported.

## Requests

Each request has a 15 s timeout (covering redirects and the body), follows up to 10 redirects and sends `User-Agent: pageaudit/<version> (+https://github.com/rhesusminus/pageaudit)`. Googlebot sends no `Accept-Language`, so pageaudit sends an empty one: Node's `fetch` would otherwise send `*`, and some sites answer that with a redirect to a random translation.

## Output

In a terminal a spinner shows `Auditing 12/40 pages...` on stderr (skipped for JSON output and on TTYs that report 0 columns). Skipped inputs are listed on stderr before the audit starts. The report then shows:

1. A summary table of every page (URL, status, errors, warnings, infos), worst first.
2. The issues of each page that has any, worst page first. Pages with no issues are collapsed into `N pages clean`. A page run through Lighthouse also shows its scores, its metrics, the largest element on screen (its CSS selector), its worst failing audits and the warnings of the run, such as an audit that crashed. With `--lighthouse-runs`, a line names the run they come from and the scores that moved between runs, such as `Middle of 3 runs; scores ranged: performance 88-98`.
3. A `Site` section with the cross-page issues, each with the pages it concerns listed under it.
4. A `Not checked` section when a check that was asked for could not run, with the reason, such as `orphan pages: only 50 of 200 URLs were audited`. Checks that were not asked for are not listed there, but they are in `coverage.notRun` in the JSON report.
5. A final line such as `40 pages, 6 errors, 19 warnings, 3 infos`.

With `--out`, `--digest`, `--html` or `--content`, a line on stderr then says where each report file was written, such as `HTML report written to report.html` or `Page content written to content (40 files)`, in JSON output too. Each report is first written to a hidden file beside it and then renamed into place, so a run that fails or is stopped while writing leaves the earlier report whole. That takes a folder pageaudit can write to.

Tables follow the terminal width (80 to 114 columns).

## Exit codes

A page that cannot be fetched or returns an error status is an error on that page (exit 1), not a reason to stop. A sitemap that was read but lists no URL to audit is still checked, so that run exits 0 or 1. An unreadable input is a URL file, sitemap or `--logo` that cannot be read.

These report paths exit 2 before any page is fetched:

- An `--out`, `--digest` or `--html` path that is a directory.
- An `--out`, `--digest` or `--html` path in a folder that does not exist. The `--content` folder and the folders above it are the exception, since the audit makes them before writing any report.
- Two of `--out`, `--digest` and `--html` naming the same file.
- A `--content` folder that is a file, that cannot be made or written to, or that a report also names.

A report or content file that cannot be written still exits 2 after a complete audit.

## HTML report

`--html report.html` writes a report that is meant to be shown to a customer: one self-contained file with inline CSS and no network requests, so it can be emailed, opened offline or printed to PDF. It reads fine without JavaScript. A small inline script only opens the collapsed sections while printing, so in a viewer without JavaScript open them before printing. It follows the system light or dark setting and works down to phone width.

```sh
node bin/pageaudit.js --sitemap https://example.com/sitemap.xml --limit 20 --lighthouse \
  --html report.html --title "Website audit" --client "Acme Oy" --logo logo.svg
```

It has a cover with the client, the date, a one-sentence verdict and, with `--lighthouse`, the four average scores. Then a summary of how many pages have problems, a ranked **What to fix** list, a section per page and a short note on how the audit was done. Inputs that were skipped, and a `--limit` that cut the list short, are mentioned in the summary. Findings are written in plain language (`src/advice.js`: what is wrong, why it matters and how to fix it), and the technical message and documentation link stay on each page. The same problem on many pages is one line in the list, with every affected page behind **Show where**. Site-wide problems such as duplicate titles are part of the same list. Severity is shown by a word and a shape, never by color alone.

The evidence behind the findings is in collapsed sections, so the report still reads top down. **Show the element** on a problem shows its CSS selector, its markup and, for length checks, what was found against what was expected (for the first 20 pages of a problem). Each page card has **More about this page** (the platform and theme when one is recognized, canonical, viewport, robots, Open Graph, the author and the published and updated dates when the page gives them, structured data, the products of the Product markup, the heading outline, images without alt text and link samples) and the full redirect chain. In the speed and quality test, every finding has a **Show details** section with what it means, the estimated saving and the affected files and elements, and the largest element on screen is named. When some pages are picked with `--lighthouse-page`, the other pages only get the short summary, so their findings show no saving or affected files and elements. The warnings of the run, such as a redirected test URL or an audit that crashed, are listed after the findings. The Lighthouse version, the device and, with `--lighthouse-runs`, the spread of the scores are noted below it.

All text taken from audited sites is escaped, and the logo is embedded as a data URI. A logo that cannot be read, or one over the size limit, exits 2 before any page is fetched.
