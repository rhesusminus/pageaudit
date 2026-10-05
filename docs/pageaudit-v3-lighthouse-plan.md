# Next step: Lighthouse data in pageaudit

## Context
pageaudit v2 fetches static HTML (`src/fetch.js`), runs cheap HTML checks (`src/checks/page/*`) and cross-page checks (`src/checks/site/*`). The end goal is to collect lots of page data and hand it to an AI model for summaries and SEO/usability suggestions. Static HTML misses rendered DOM, performance, accessibility and best-practice signals. Lighthouse covers those. `docs/pageaudit-v2-plan.md` lists Lighthouse as out of scope for v2, so this is the natural v3 step.

## Answer: Node library
Yes. `lighthouse` (npm) is a Node module (ESM, fits `"type": "module"` and Node 24). Programmatic use:

```js
import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'
const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] })
const { lhr } = await lighthouse(url, { port: chrome.port, output: 'json', onlyCategories: ['performance','accessibility','best-practices','seo'] })
await chrome.kill()
```

`lhr` is the full JSON result: category scores, per-audit results with details, Core Web Vitals metrics (LCP, CLS, TBT). Needs a local Chrome/Chromium. Alternative: PageSpeed Insights API (hosted Lighthouse, no local Chrome, rate limited, needs API key) - worth a later optional backend, not the first step.

## Approach (as built)
1. Deps: `lighthouse`, `chrome-launcher`. Lighthouse 13 needs Node 22.19 or newer, the repo requires Node 24.
2. `src/lighthouse.js`: `runLighthouse(urls, { launch, lighthouse, load, onProgress })` returns one `{ summary }` or `{ error }` per URL and never throws. `summarize(lhr)` trims the result to category scores, core metrics (FCP, LCP, TBT, CLS, speed index) and the audits scoring below 90 (binary, numeric and metricSavings audits, worst first, up to three affected items each). The full `lhr` is not kept, it is huge and wasteful for LLM input. Chrome and Lighthouse are injectable so tests do not need Chrome, like `fetchPage` in `src/runner.js`.
3. Pages run sequentially in one shared Chrome, because Lighthouse is CPU heavy and parallel runs skew each other. This is separate from the HTTP-fetch concurrency in `runner.js`. Pages that redirect to the same final URL are audited once.
4. Opt-in `--lighthouse` flag in `src/cli.js`, off by default so the fast static path is unchanged. A failed run becomes an `info` issue `lighthouse-failed` on the page and never aborts the run or changes the exit code.
5. The result is attached to each page as `page.lighthouse` in the JSON report (`src/report.js`), and the human report gets a section with scores, metrics and the worst audits.
6. Tests: `test/lighthouse.test.js` with an inline `lhr` and injected fakes, plus CLI and report tests. README updated.

## Afterwards (separate steps)
- Define one combined "page data" JSON (facts + issues + Lighthouse summary) as the AI input contract.
- No LLM API call for now (no API key). Claude reads the output instead: the combined JSON is written to a file (`--json > report.json`, or an `--out <path>` flag) that Claude Code can read and summarize in a session. Keep the JSON compact so it fits in context.

## Verification
- `npm test` and `npm run lint` pass.
- Real run: `node bin/pageaudit.js https://example.com --lighthouse --json` shows scores/metrics for the page; compare against Chrome DevTools Lighthouse for the same URL (scores within normal variance).
- Run with Chrome missing/blocked to confirm graceful per-page failure and exit code behavior.
