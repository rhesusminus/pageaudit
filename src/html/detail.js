// The evidence behind a finding: the element an issue is about, what Lighthouse found on a page and the
// less visible facts of a page. All of it sits in collapsed sections, so the report still reads top down.
import { markup } from './escape.js'
import { CATEGORY_NAMES, formatBytes, formatMetric, link, plural } from './format.js'

const EVIDENCE_LABEL = { element: 'Show the element', measurement: 'Show the measurement' }

// ---- issues ----

// The element an issue is about and, for length checks, what was measured against what was expected.
// Takes an issue or a group hit, both carry the same optional fields.
const hasElementOf = ({ selector, html }) => Boolean(selector || html)
const hasMeasurementOf = ({ actual, expected }) => actual !== undefined || Boolean(expected)

// Whether evidence() has anything to show for the issue or hit.
export const hasEvidence = (issue) => hasElementOf(issue) || hasMeasurementOf(issue)

export function evidence(issue) {
  if (!hasEvidence(issue)) return ''
  const { selector, html, parentHtml, actual, expected } = issue
  const hasElement = hasElementOf(issue)
  const hasMeasurement = hasMeasurementOf(issue)
  return markup`<details class="evidence">
    <summary>${hasElement ? EVIDENCE_LABEL.element : EVIDENCE_LABEL.measurement}</summary>
    ${selector ? markup`<p class="note">Selector</p><code>${selector}</code>` : ''}
    ${html ? markup`<p class="note">Markup</p><pre><code>${html}</code></pre>` : ''}
    ${parentHtml ? markup`<p class="note">Inside</p><pre><code>${parentHtml}</code></pre>` : ''}
    ${hasMeasurement ? markup`<p class="note">${measurement(actual, expected)}</p>` : ''}
  </details>`
}

function measurement(actual, expected) {
  const found = actual === undefined ? '' : `Found ${actual}.`
  return [found, expected ? `Expected ${expected}.` : ''].filter(Boolean).join(' ')
}

// ---- Lighthouse ----

function savingsText({ ms, bytes, metrics } = {}) {
  const saved = [ms && formatMetric('lcp', ms), bytes && formatBytes(bytes)].filter(Boolean)
  const gains = Object.entries(metrics ?? {}).map(([key, value]) => `${key.toUpperCase()} ${formatMetric(key, value)}`)
  return [
    saved.length ? `Could save about ${saved.join(' and ')}.` : '',
    gains.length ? `Improves ${gains.join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function itemCost({ wastedMs, wastedBytes, totalBytes }) {
  return [
    wastedMs && `wastes ${formatMetric('lcp', wastedMs)}`,
    wastedBytes && `wastes ${formatBytes(wastedBytes)}`,
    totalBytes && `${formatBytes(totalBytes)} in total`
  ]
    .filter(Boolean)
    .join(', ')
}

function auditItem(item) {
  const where = item.url ? markup`${link(item.url)}${item.line ? `:${item.line}` : ''}` : ''
  const cost = itemCost(item)
  return markup`<li>
    ${where ? markup`<span class="urls">${where}</span>` : ''}
    ${item.label ? markup`<span>${item.label}</span>` : ''}
    ${item.nodeLabel ? markup`<span>${item.nodeLabel}</span>` : ''}
    ${item.selector ? markup`<code>${item.selector}</code>` : ''}
    ${item.snippet ? markup`<pre><code>${item.snippet}</code></pre>` : ''}
    ${item.explanation ? markup`<span class="note">${item.explanation}</span>` : ''}
    ${cost ? markup`<span class="note">${cost}</span>` : ''}
  </li>`
}

// What the audit means, what fixing it would save and the things it found.
function auditDetail(audit, note) {
  const saving = savingsText(audit.savings)
  const items = audit.items ?? []
  if (!note?.description && !saving && !items.length) return ''
  return markup`<details class="evidence">
    <summary>Show details</summary>
    ${note?.description ? markup`<p class="note">${note.description} ${note.learnMore ? link(note.learnMore, 'Learn more') : ''}</p>` : ''}
    ${saving ? markup`<p class="note">${saving}</p>` : ''}
    ${items.length ? markup`<ul class="audit-items">${items.map(auditItem)}</ul>` : ''}
  </details>`
}

export function auditRow(audit, notes) {
  return markup`<li>
    <span class="audit-score">${audit.score}/100</span> ${audit.title}
    ${audit.displayValue ? markup`<span class="note">${audit.displayValue}</span>` : ''}
    <span class="note audit-category">${CATEGORY_NAMES[audit.category] ?? audit.category}</span>
    ${auditDetail(audit, notes?.[audit.id])}
  </li>`
}

// The element behind the largest contentful paint, when Lighthouse found it.
export function lcpElement(element) {
  if (!element) return ''
  return markup`<p class="note">Largest element on screen:</p>
    <code>${element.selector}</code>
    ${element.snippet ? markup`<pre><code>${element.snippet}</code></pre>` : ''}`
}

const SPREAD_NAMES = {
  performance: 'speed',
  accessibility: 'accessibility',
  'best-practices': 'best practices',
  seo: 'search'
}

// Which Lighthouse version and device the numbers come from, and how much they moved over several runs.
export function lighthouseNote({ lighthouseVersion, formFactor, runs, scoreSpread }) {
  const device = [lighthouseVersion && `Lighthouse ${lighthouseVersion}`, formFactor].filter(Boolean).join(', ')
  const spread = Object.entries(scoreSpread ?? {})
    .filter(([, range]) => range)
    .map(([id, [low, high]]) => `${SPREAD_NAMES[id] ?? id} ${low === high ? low : `${low} to ${high}`}`)
  const text = [
    device && `${device}.`,
    runs > 1 ? `The middle of ${plural(runs, 'run')}; scores ranged: ${spread.join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join(' ')
  return text ? markup`<p class="note">${text}</p>` : ''
}

// ---- page facts ----

const orMissing = (value) => value ?? markup`<span class="missing">Missing</span>`

function headingOutline(headings) {
  if (!headings.length) return ''
  return markup`<ul class="outline">
    ${headings.map((h) => markup`<li style="margin-left:${(h.level - 1) * 1}rem"><strong>H${h.level}</strong> ${h.text}${h.excerpt ? markup` <span class="note">${h.excerpt}</span>` : ''}</li>`)}
  </ul>`
}

// The samples are only the first images of the page, so the total says how many more there are.
function missingAlt({ imageSamples, images }) {
  const bare = imageSamples.filter((image) => image.alt === null)
  const unlisted = images.missingAlt - bare.length
  if (!bare.length && unlisted <= 0) return ''
  const more = unlisted > 0 ? plural(unlisted, bare.length ? 'more image' : 'image') : ''
  return markup`<ul class="outline">
    ${bare.map((image) => markup`<li>${image.src ? link(image.src) : 'Image without address'}${image.context ? markup` <span class="note">${image.context}</span>` : ''}</li>`)}
    ${more ? markup`<li class="note">${more} without alt text not listed here.</li>` : ''}
  </ul>`
}

function linkList({ linkSamples, links }) {
  if (!linkSamples.length) return ''
  const total = links.internal + links.external
  return markup`<ul class="outline">
    ${linkSamples.map((s) => markup`<li>${link(s.href, s.text || s.href)} <span class="note">${s.internal ? 'internal' : 'external'}${s.nofollow ? ', nofollow' : ''}</span></li>`)}
    ${total > linkSamples.length ? markup`<li class="note">The first ${linkSamples.length} of ${total} links.</li>` : ''}
  </ul>`
}

// Rows of the collapsed "More about this page" block: [name, value], with empty values left out.
function moreRows(facts) {
  const { openGraph: og } = facts
  const social = [
    og.title && `title: ${og.title}`,
    og.description && `description: ${og.description}`,
    og.image && `image: ${og.image}`,
    og.type && `type: ${og.type}`
  ].filter(Boolean)
  return [
    ['Mobile viewport', orMissing(facts.viewport)],
    ['Robots', facts.robots ?? 'Not set'],
    ['Open Graph', social.length ? social.join(' / ') : orMissing(null)],
    ['Twitter card', orMissing(facts.twitterCard)],
    // No check asks for structured data, so its absence is not styled as a problem.
    ['Structured data', facts.jsonLdTypes.length ? facts.jsonLdTypes.join(', ') : 'None found'],
    ['Headings', headingOutline(facts.headings)],
    ['Images without alt text', missingAlt(facts)],
    ['Links', linkList(facts)]
  ].filter(([, value]) => value !== '')
}

// Everything else known about the page. `mainText` is left out: it is long and says little to a reader of the report.
export function moreFacts(facts) {
  if (!facts) return ''
  return markup`<details class="evidence facts-more">
    <summary>More about this page</summary>
    <dl class="facts">
      ${moreRows(facts).map(([name, value]) => markup`<div><dt>${name}</dt><dd>${value}</dd></div>`)}
    </dl>
  </details>`
}

// ---- redirects ----

export function redirectList(page) {
  if (!page.redirects?.length) {
    return page.finalUrl && page.finalUrl !== page.url
      ? markup`<p class="note">Redirects to ${link(page.finalUrl)}</p>`
      : ''
  }
  return markup`<div class="redirects">
    <p class="note">Redirects:</p>
    <ol>
      ${page.redirects.map((hop) => markup`<li><span class="note">${hop.status}</span> ${link(hop.url)} <span class="note">to</span> ${link(hop.location)}</li>`)}
    </ol>
  </div>`
}
