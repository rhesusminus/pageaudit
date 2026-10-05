# pageaudit v4: page data for Claude, and a customer-ready HTML report

## Context
v3 added opt-in Lighthouse. Two gaps remain for the original goal (collect lots of page data, get AI suggestions on SEO and usability):

1. **The JSON report lacks the data itself.** `extractFacts()` (`src/checks/page/index.js`) already collects title, description, h1s and canonical, but `buildReport()` (`src/report.js`) drops them. A model sees "title too long" but never the title, and has no content signals (heading outline, link counts, Open Graph, structured data). No LLM API key exists, so the workflow is: write one compact JSON file, then ask Claude Code to read it and summarize.
2. **The terminal report is not something to show a customer.** A polished, self-contained HTML report is needed.

Delivered as two PRs, in this order: (A) page data and `--out`, (B) HTML report.

Step 0 of implementation: save this plan as `docs/pageaudit-v4-page-data-html-report.md` (prettier formatted, no em dashes), and work on a branch per PR.

## PR A: page data and `--out`

### Data
New `src/checks/page/signals.js` with `extractSignals($, finalUrl)`, merged into the facts object returned by `extractFacts()` (kept as one object so the site checks that consume `title`, `description`, `h1s`, `canonical` are unaffected). Fields, all size-capped so the JSON stays compact:

- `lang`, `viewport`, `robots` meta
- `headings`: outline of `{ level, text }`, text truncated (reuse `truncate` from `src/checks/snippet.js`, `collapseWhitespace` from `src/text.js`), max about 40 entries
- `wordCount` of visible body text (script, style, noscript, template removed)
- `links`: `{ internal, external, nofollow }` counts, classified against the page's final host (resolve relative hrefs like `absolute()` already does in `index.js`)
- `images`: `{ total, missingAlt }`
- `openGraph` (title, description, image, type, url) and `twitterCard`
- `jsonLdTypes`: the `@type` values from valid JSON-LD blocks (invalid JSON ignored, never throws)

### Report and CLI
- `buildReport()` includes `facts` per page (and a `generatedAt` ISO timestamp at the top level, so Claude and the HTML report know when the data was taken). Pages without HTML keep `facts: null`.
- New `--out <path>` writes the JSON report to a file in addition to normal stdout. Written after the audit; a write failure prints the reason and exits 2 (the report is still printed).
- README: new "Using the output with Claude" section: `pageaudit ... --lighthouse --out report.json`, then ask Claude Code to read `report.json`. Document the `facts` fields.

### Tests
- `test/signals.test.js` against new HTML fixtures (one rich page with OG, JSON-LD, lang, mixed links; one broken JSON-LD page) plus caps.
- `test/cli.test.js`: `good.html` expected report now includes `facts`; strip `generatedAt` in the deepEqual. `--out` writes valid JSON equal to stdout JSON, and a bad path exits 2.

## PR B: HTML report

### Output
`--html <path>` writes one self-contained file: inline CSS, inline SVG, no JavaScript needed (use `<details>` for collapsing), no network requests, so it can be emailed, opened offline or printed to PDF. Works with or without `--lighthouse`. Optional branding flags: `--title <text>`, `--client <name>`, `--logo <file>` (png, jpg, svg, embedded as a data URI; unreadable or non-image files exit 2 up front, before the audit starts). Same exit-2-on-write-failure behavior as `--out`.

### Structure (new `src/html/`, kebab-case files, functions kept under the 40 line lint limit)
- `render.js`: `renderHtml(report, { title, client, logo })`, composes the sections below. All dynamic text goes through one `escapeHtml()` helper (URLs and page titles come from third-party sites, never trust them).
- `sections.js`: header, summary, priorities, pages, site issues, method.
- `styles.js`: the CSS string. Design tokens on `:root`, dark mode via `prefers-color-scheme`, print stylesheet (page breaks between pages, details forced open, no shadows), responsive down to phone width, system font stack, strong contrast, severity shown by label and icon, never color alone.
- `advice.js`: map from issue `type` to `{ why, fix }` plain-language text for customers, covering every existing rule (images, meta, headings, response, site, `lighthouse-failed`). Unknown types fall back to the technical message so nothing is ever hidden.

### Content
1. **Header:** report title, client name, logo, audit date, number of pages.
2. **Summary:** cards for pages audited, errors, warnings, infos; Lighthouse score rings (inline SVG, average per category) when present; one-sentence plain verdict.
3. **Top priorities:** issues grouped by `type` across all pages, ordered by severity then number of pages affected, each with why it matters, how to fix, and the affected URLs.
4. **Per page** (`<details>`, worst first like `worstFirst()` in `report.js`): URL, status, the key facts (title, description, h1), issues with why/fix and the technical message plus source link, Lighthouse scores and Core Web Vitals with good / needs improvement / poor bands (LCP 2.5 s and 4 s, CLS 0.1 and 0.25, TBT 200 ms and 600 ms, FCP 1.8 s and 3 s, SI 3.4 s and 5.8 s), and the worst failing audits.
5. **Site-wide issues:** duplicate titles, descriptions, h1s, canonical targets with the pages involved.
6. **Method:** what was checked, that Lighthouse scores vary run to run, and the source links from `src/sources.js`.

### Tests
- `test/html.test.js`: renders from a fixture report; asserts escaping (a title containing `<script>` and quotes is inert), every section present, no `http(s)://` resource references other than links (self-contained), branding flags applied, logo embedded as a data URI.
- Coverage test: every issue `type` literal found in `src/checks/**` and `src/lighthouse.js` has an entry in `advice.js`, so a new rule cannot ship without customer wording.
- CLI tests: `--html` writes the file, bad logo or path exits 2.
- Update the README (options table, new HTML report section, architecture tree) and `docs`.

## Verification
- `npm test` and `npm run lint` pass for each PR.
- PR A: `node bin/pageaudit.js https://example.com --lighthouse --out report.json`; open `report.json` and confirm facts and signals look right and are small; then ask Claude Code to read it and summarize, as the end-to-end check of the intended workflow.
- PR B: generate `report.html` for a multi-page run (several real URLs plus one 404 and one bad host) with `--lighthouse` and with branding flags. Open it in a real browser and check, being picky about pixels: desktop, phone width, dark mode, print preview to PDF, long URLs and titles wrapping, a page with no issues, a page with zero Lighthouse data, a failed page. Fix anything that looks off, even if unrelated.
- Open the file with the network offline to confirm it is fully self-contained.
