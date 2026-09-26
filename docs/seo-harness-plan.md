# Project: Single-page SEO/HTML checker (v1)

## Goal
A Node.js CLI tool that fetches a single URL, parses the static HTML, runs a
handful of deterministic checks (images, meta tags, heading structure), and
prints a clear, color-coded report to the terminal.

This is v1. Explicitly **out of scope** for now:
- Multi-page crawling / sitemap following (v2)
- Headless browser / JS-rendered content (v2, if needed — see notes)
- Any AI/LLM calls — this tool only produces a report; a human (or a
  separate step) can hand that report to an LLM afterward for judgment calls
- Lighthouse / performance metrics (maybe v2)
- Config files / plugin system — hardcode sensible defaults for now

## Tech stack
- **Node.js** (use native `fetch`, no need for node-fetch on modern Node)
- **Cheerio** for HTML parsing (static DOM parsing, jQuery-style selectors —
  NOT a full browser, won't see JS-rendered content)
- **ora** — spinner while fetching/parsing/checking
- **cli-table3** — table output for the report
- **chalk** — color coding by severity

## Architecture

```
seo-harness/
├── package.json
├── src/
│   ├── fetch.js        # given a URL, return raw HTML string
│   ├── parse.js         # load HTML into Cheerio, return $
│   ├── checks/
│   │   ├── images.js    # missing/empty alt, missing width/height attrs
│   │   ├── meta.js      # title, meta description, canonical tag
│   │   └── headings.js  # H1 count/presence, skipped heading levels
│   ├── report.js        # aggregate check results, format for terminal + JSON
│   └── cli.js            # entry point, wires everything together
└── bin/
    └── seo-check.js      # shebang entry, calls src/cli.js
```

## Issue object shape (used by every check module)

Every check module returns an array of issue objects with this shape —
keep this consistent across all checks so report.js doesn't need
special-casing per check type:

```js
{
  type: 'missing-alt',       // short machine-readable identifier
  severity: 'error',          // 'error' | 'warning'
  message: 'Image missing alt attribute',
  context: '<img src="/products/shampoo.jpg">' // selector or snippet for locating it
}
```

## Checks for v1

### Images (`checks/images.js`)
- Missing `alt` attribute → error
- Empty `alt=""` on a non-decorative image → warning (empty alt is
  actually valid for decorative images, so this is a soft warning, not
  a hard error — flag for human review)
- Missing `width`/`height` attributes → warning (causes layout shift)

### Meta (`checks/meta.js`)
- `<title>` missing → error
- `<title>` present but longer than ~60 chars → warning (soft
  threshold, SERP truncation heuristic, not an official Google rule)
- `<meta name="description">` missing → error
- Meta description longer than ~160 chars → warning
- `<link rel="canonical">` missing → warning

### Headings (`checks/headings.js`)
- No `<h1>` on the page → error
- More than one `<h1>` → warning
- Skipped heading level (e.g. `<h3>` appears before any `<h2>`) → warning

## CLI behavior
- Usage: `seo-check <url>`
- Spinner while fetching + parsing + running checks
- On completion, print a table grouped by category (Images / Meta /
  Headings), color-coded: red for errors, yellow for warnings
- Print a one-line summary at the end: `X errors, Y warnings`
- `--json` flag: skip the pretty table, print the raw report object as
  JSON instead (for piping elsewhere later)
- Exit code: `1` if any errors were found, `0` otherwise (warnings alone
  don't fail the exit code) — decide if this feels right once it's built,
  easy to flip later

## Known limitation to keep in mind
Cheerio only sees the raw HTML returned by the initial fetch — it will
not see anything rendered client-side via JavaScript. This is
Google's Web Dev docs, confirming Googlebot's initial pass has this same
limitation. If checks come back suspiciously empty on a page you know has
images, this is likely why — the fix later is swapping the fetch layer
for Playwright, not something to solve now.

## Build order (suggested)
1. `fetch.js` + `parse.js` — prove the pipe works against a hardcoded URL
2. `checks/images.js` end-to-end, including report output — get the
   issue shape right here since everything else copies it
3. `checks/meta.js`, `checks/headings.js` — same shape, should be fast
   once images.js is solid
4. `report.js` + `cli.js` + spinner/table — wire it all together last,
   once there's real check data to display

## Open questions to settle while building
- Should `--json` be the default when not running in a TTY (e.g. piped)?
- Any project-specific alt-text conventions to special-case later
  (e.g. product images following a naming pattern)?
