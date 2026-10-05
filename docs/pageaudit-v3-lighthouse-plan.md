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

## Approach
0. Save this plan into the repo as `docs/pageaudit-v3-lighthouse-plan.md` (next to `docs/pageaudit-v2-plan.md`), formatted with prettier. Do not use an em dash.
1. Add deps: `lighthouse`, `chrome-launcher` (confirm current versions and Node engine support at install).
2. New `src/lighthouse.js`: `runLighthouse(url, { launcher, lighthouse })` returning a trimmed, stable object: category scores, key metrics, and only failing/warning audits (id, title, score, displayValue, short details). Do not store the full `lhr` - it is huge and wasteful for LLM input. Inject launcher/lighthouse so tests don't need Chrome (same pattern as `fetchPage` injection in `src/runner.js`).
3. Run sequentially with a single shared Chrome instance (Lighthouse is CPU heavy and skews if parallel), separate from the HTTP-fetch concurrency in `runner.js`.
4. Opt-in CLI flag `--lighthouse` in `src/input/args.js` / `src/cli.js`; off by default so the fast static path is unchanged. Failures become a per-page issue/note, never abort the run (matches `auditPage` behavior).
5. Attach result to each page as `page.lighthouse` in the JSON report (`src/report.js`); add a short table section to the human report (scores + top failed audits).
6. Tests: fixture `lhr` JSON in `test/fixtures/`, unit test the trimming and the report; CLI test with injected fake runner. Update README and the docs plan.

## Afterwards (separate steps)
- Define one combined "page data" JSON (facts + issues + Lighthouse summary) as the AI input contract.
- No LLM API call for now (no API key). Claude reads the output instead: the combined JSON is written to a file (`--json > report.json`, or an `--out <path>` flag) that Claude Code can read and summarize in a session. Keep the JSON compact so it fits in context.

## Verification
- `npm test` and `npm run lint` pass.
- Real run: `node bin/pageaudit.js https://example.com --lighthouse --json` shows scores/metrics for the page; compare against Chrome DevTools Lighthouse for the same URL (scores within normal variance).
- Run with Chrome missing/blocked to confirm graceful per-page failure and exit code behavior.
