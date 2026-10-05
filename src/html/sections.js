import { countSeverities, worstFirst } from '../report.js'
import { adviceFor } from './advice.js'
import { markup, raw } from './escape.js'
import { METRIC_BANDS, metricBand } from './model.js'

const SEVERITY_WORDS = { error: 'Needs fixing', warning: 'Should fix', info: 'Worth a look' }
const CATEGORY_NAMES = {
  performance: 'Speed',
  accessibility: 'Accessibility',
  'best-practices': 'Best practices',
  seo: 'Search (SEO)'
}
const BAND_WORDS = { good: 'Good', average: 'Needs work', poor: 'Poor', unknown: 'Not measured' }
const MAX_AUDITS = 8
const RING_RADIUS = 52

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Only http(s) addresses become links. Everything audited is one, this is a safety net.
const link = (url, text = url) =>
  /^https?:\/\//i.test(url) ? markup`<a href="${url}" rel="noopener noreferrer">${text}</a>` : markup`${text}`

const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' })

const scoreBand = (score) => (score >= 90 ? 'good' : score >= 50 ? 'average' : 'poor')

const severityBadge = (severity) => markup`<span class="sev sev-${severity}">${SEVERITY_WORDS[severity]}</span>`

// A score from 0 to 100 drawn as an arc, with the number and its meaning also in text.
function ring(id, score) {
  const label = CATEGORY_NAMES[id] ?? id
  if (score === null) {
    return markup`<li class="ring"><span class="ring-na">n/a</span><span class="ring-label">${label}</span></li>`
  }
  const band = scoreBand(score)
  return markup`<li class="ring ring-${band}">
    <svg viewBox="0 0 120 120" role="img" aria-label="${label}: ${score} out of 100">
      <circle class="track" cx="60" cy="60" r="${RING_RADIUS}" pathLength="100" />
      <circle
        class="arc"
        cx="60"
        cy="60"
        r="${RING_RADIUS}"
        pathLength="100"
        stroke-dasharray="${score} 100"
        transform="rotate(-90 60 60)"
      />
      <text class="num" x="60" y="60" text-anchor="middle" dominant-baseline="central">${score}</text>
    </svg>
    <span class="ring-label">${label}</span>
    <span class="ring-word">${BAND_WORDS[band]}</span>
  </li>`
}

function coverScores(scores) {
  if (!scores) return ''
  const note = scores.pages > 1 ? `Average of ${plural(scores.pages, 'page')} tested for speed and quality.` : ''
  return markup`<ul class="rings" aria-label="Speed and quality scores">
      ${Object.entries(scores.scores).map(([id, score]) => ring(id, score))}
    </ul>
    ${note ? markup`<p class="rings-note">${note}</p>` : ''}`
}

export function cover({ report, title, client, logo, scores, verdict }) {
  return markup`<header class="cover">
    <div class="wrap">
      ${logo ? markup`<img class="logo" src="${logo}" alt="${client ?? title} logo" />` : ''}
      ${client ? markup`<p class="client">${client}</p>` : ''}
      <h1>${title}</h1>
      <p class="verdict">${verdict}</p>
      <dl class="facts-line">
        <div>
          <dt>Audited</dt>
          <dd>${dateFormat.format(new Date(report.generatedAt))}</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>${report.summary.pages}</dd>
        </div>
      </dl>
      ${coverScores(scores)}
    </div>
  </header>`
}

const HEALTH_LABELS = { errors: 'with problems to fix', warnings: 'that could be improved', clean: 'with no problems' }
const HEALTH_SEVERITY = { errors: 'error', warnings: 'warning', clean: 'good' }

export function healthSection(health, { pages }) {
  const segments = Object.entries(health).filter(([, n]) => n > 0)
  return markup`<section class="panel" aria-labelledby="summary">
    <h2 id="summary">Summary</h2>
    <div class="health" role="img" aria-label="${plural(pages, 'page')} audited">
      ${segments.map(([key, n]) => markup`<span class="seg seg-${key}" style="flex-grow:${n}"></span>`)}
    </div>
    <ul class="legend">
      ${Object.entries(health).map(([key, n]) => markup`<li class="sev sev-${HEALTH_SEVERITY[key]}"><strong>${plural(n, 'page')}</strong> ${HEALTH_LABELS[key]}</li>`)}
    </ul>
  </section>`
}

function affectedItem(hit, group) {
  const note = hit.message === group.message ? '' : hit.message
  return markup`<li>
    ${hit.context ? markup`<code>${hit.context}</code>` : ''}
    <span class="urls">${hit.urls.map((url) => link(url))}</span>
    ${note ? markup`<span class="note">${note}</span>` : ''}
  </li>`
}

function fixItem(group, index) {
  const advice = adviceFor(group.type)
  return markup`<li class="fix">
    <span class="fix-num" aria-hidden="true">${index + 1}</span>
    <div class="fix-body">
      <p class="fix-head">
        ${severityBadge(group.severity)}<span class="fix-count">${plural(group.urls.length, 'page')} affected</span>
      </p>
      <h3>${advice?.title ?? group.message}</h3>
      ${
        advice
          ? markup`<p>${advice.why}</p>
              <p><strong>How to fix:</strong> ${advice.fix}</p>`
          : ''
      }
      <details>
        <summary>Show where</summary>
        <ul class="affected">
          ${group.hits.map((hit) => affectedItem(hit, group))}
        </ul>
      </details>
    </div>
  </li>`
}

export function fixesSection(groups) {
  return markup`<section aria-labelledby="fixes">
    <h2 id="fixes">What to fix</h2>
    ${
      groups.length
        ? markup`<p class="lede">
              Most important first. Each item is one kind of problem, with every page it appears on.
            </p>
            <ol class="fixes">
              ${groups.map(fixItem)}
            </ol>`
        : markup`<p class="lede">Nothing to fix. The checks found no problems.</p>`
    }
  </section>`
}

// ---- pages ----

const issueCounts = ({ errors, warnings, infos }) =>
  [errors && `${errors} to fix`, warnings && `${warnings} to improve`, infos && `${plural(infos, 'note')}`]
    .filter(Boolean)
    .join(', ') || 'No problems'

function statusText(status) {
  if (status === null) return 'Not reachable'
  return status === 200 ? 'Reachable' : `Error ${status}`
}

const missing = markup`<span class="missing">Missing</span>`

function pageFacts(facts) {
  if (!facts) return ''
  const rows = [
    ['Title', facts.title ?? missing],
    ['Description', facts.description ?? missing],
    ['Main heading', facts.h1s.length ? facts.h1s.join(' / ') : missing],
    [
      'Content',
      `${plural(facts.wordCount, 'word')}, ${plural(facts.links.internal, 'internal link')}, ${plural(facts.links.external, 'external link')}, ${plural(facts.images.total, 'image')}`
    ]
  ]
  return markup`<dl class="facts">
    ${rows.map(
      ([name, value]) =>
        markup`<div>
          <dt>${name}</dt>
          <dd>${value}</dd>
        </div>`
    )}
  </dl>`
}

function issueItem(issue) {
  const advice = adviceFor(issue.type)
  return markup`<li>
    ${severityBadge(issue.severity)}
    <span class="issue-text">${advice?.title ?? issue.message}</span>
    ${issue.context ? markup`<code>${issue.context}</code>` : ''}
    <span class="note">${advice ? markup`${issue.message}. ` : ''}${link(issue.source, 'Source')}</span>
  </li>`
}

const formatMetric = (key, value) => {
  if (value === null || value === undefined) return 'n/a'
  if (key === 'cls') return String(value)
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value} ms`
}

function metricRow([key, { label }], metrics) {
  const band = metricBand(key, metrics[key])
  return markup`<tr>
    <th scope="row">${label}</th>
    <td>${formatMetric(key, metrics[key])}</td>
    <td><span class="band band-${band}">${BAND_WORDS[band]}</span></td>
  </tr>`
}

function lighthouseBlock(lighthouse) {
  if (!lighthouse) return ''
  const audits = lighthouse.audits.slice(0, MAX_AUDITS)
  const more = lighthouse.audits.length - audits.length
  return markup`<h3>Speed and quality test</h3>
    <ul class="chips">
      ${Object.entries(lighthouse.scores).map(([id, score]) => markup`<li class="chip chip-${score === null ? 'unknown' : scoreBand(score)}">${CATEGORY_NAMES[id] ?? id} <strong>${score ?? 'n/a'}</strong></li>`)}
    </ul>
    <table class="metrics">
      <tbody>
        ${Object.entries(METRIC_BANDS).map((entry) => metricRow(entry, lighthouse.metrics))}
      </tbody>
    </table>
    ${
      audits.length
        ? markup`<h3>Biggest opportunities</h3>
            <ul class="audits">
              ${audits.map((a) => markup`<li><span class="audit-score">${a.score}</span> ${a.title}${a.displayValue ? markup` <span class="note">${a.displayValue}</span>` : ''}</li>`)}
            </ul>
            ${more > 0 ? markup`<p class="note">${plural(more, 'more finding')} in the JSON report.</p>` : ''}`
        : ''
    }`
}

function pageBody(page) {
  const redirected = page.finalUrl && page.finalUrl !== page.url
  return markup`<div class="page-body">
    ${redirected ? markup`<p class="note">Redirects to ${link(page.finalUrl)}</p>` : ''} ${pageFacts(page.facts)}
    ${
      page.issues.length
        ? markup`<h3>Problems found</h3>
            <ul class="issues">
              ${page.issues.map(issueItem)}
            </ul>`
        : markup`<p class="clean">No problems found on this page.</p>`
    }
    ${lighthouseBlock(page.lighthouse)}
  </div>`
}

function pageCard(page, open) {
  return markup`<details class="page" ${open ? raw('open') : ''}>
    <summary>
      <span class="page-url">${page.url}</span>
      <span class="page-chips"
        ><span class="chip">${statusText(page.status)}</span><span class="chip">${issueCounts(page.counts)}</span></span
      >
    </summary>
    ${pageBody(page)}
  </details>`
}

export function pagesSection(pages) {
  const open = pages.length <= 3
  return markup`<section aria-labelledby="pages">
    <h2 id="pages">Pages</h2>
    <p class="lede">Worst first. Open a page to see what was found on it.</p>
    <div class="pages">
      ${worstFirst(pages).map((page) => pageCard(page, open || countSeverities(page.issues).errors > 0))}
    </div>
  </section>`
}

export function methodSection(report) {
  const sources = [...new Set([...report.pages.flatMap((p) => p.issues), ...report.site].map((i) => i.source))].filter(
    Boolean
  )
  return markup`<section aria-labelledby="method">
    <h2 id="method">How this was checked</h2>
    <p class="lede">
      Each page is fetched like a search engine would and its HTML is checked for common search, accessibility and
      quality problems.
      ${report.pages.some((p) => p.lighthouse) ? 'Pages were also run through Google Lighthouse, a speed and quality test. Its scores vary a little from run to run.' : ''}
    </p>
    <p>
      The rules follow Google, web.dev and the W3C. Where they give no hard limit, the checks use soft warnings instead
      of errors.
    </p>
    ${
      sources.length
        ? markup`<ul class="sources">
            ${sources.map((url) => markup`<li>${link(url)}</li>`)}
          </ul>`
        : ''
    }
  </section>`
}
