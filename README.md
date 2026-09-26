# pageaudit

Fetches a single URL, parses the static HTML and reports basic SEO/HTML issues (images, meta tags, headings).

```sh
npm install
node bin/pageaudit.js <url>          # color-coded table
node bin/pageaudit.js <url> --json   # raw JSON (also the default when stdout is not a TTY)
npm test
```

Exit codes: `0` no errors (warnings allowed), `1` errors found, `2` usage or fetch failure.

## Limitation

Only the raw HTML from the initial fetch is inspected (Cheerio, no JavaScript execution). Content rendered client-side is not seen.
