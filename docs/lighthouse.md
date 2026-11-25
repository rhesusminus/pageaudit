# Lighthouse

With `--lighthouse`, each page that returned HTML is also audited by [Lighthouse](https://github.com/GoogleChrome/lighthouse) (the `lighthouse` and `chrome-launcher` npm packages) in a headless Chrome. Pages run one at a time in a single Chrome, because parallel runs skew each other's performance numbers, so expect several seconds per page. In a terminal the spinner shows a rough progress bar over every run of every page, with the page, run and phase it is on. It is off by default, which keeps the plain run fast and free of any browser dependency.

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
