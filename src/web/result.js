// The page for a finished audit: how bad it is, how the page can look in search results, what to fix and what the
// page holds.
import { adviceFor } from '../advice.js'
import { DESCRIPTION_MAX, TITLE_MAX } from '../checks/page/meta.js'
import { markup } from '../html/escape.js'
import { link } from '../html/format.js'
import { resultBrief } from './brief.js'
import { findingsOf, verdict } from './findings.js'
import { addressHeading, checkedAt, count, SEVERITY_LABEL, shortAddress } from './format.js'
import { document } from './layout.js'
import { facts, platformName } from './result-facts.js'

// How many places a finding lists before it says how many more there are.
const SHOWN_HITS = 3

function resultHead(audit) {
  const page = audit.result
  const when = checkedAt(audit.created_at)
  const heading = addressHeading(page.finalUrl ?? audit.url)
  return markup`<header class="result-head">
    <h1 id="result-title" class="address${heading.long ? ' long-address' : ''}">${heading.text}</h1>
    <dl class="meta">
      <div><dt>Answer</dt><dd>HTTP ${page.status}</dd></div>
      ${page.redirects.length ? markup`<div><dt>Redirects</dt><dd>${count(page.redirects.length, 'redirect')} from ${shortAddress(audit.url)}</dd></div>` : ''}
      ${page.facts?.platform ? markup`<div><dt>Built with</dt><dd>${platformName(page.facts.platform)}</dd></div>` : ''}
      <div><dt>Checked</dt><dd><time datetime="${when.iso}">${when.text}</time></dd></div>
    </dl>
    <div class="actions">
      <form class="inline-form" method="post" action="/check">
        <input type="hidden" name="url" value="${audit.url}" />
        <button type="submit" class="primary">Check again</button>
      </form>
      <span class="copy" hidden>
        <button type="button" class="copy-button" command="--copy" commandfor="claude-brief">Copy for Claude</button>
        <span class="copy-status" role="status"></span>
      </span>
      <form class="inline-form" method="get" action="/check/${audit.id}/delete">
        <button type="submit" data-opens="delete-dialog">Delete results</button>
      </form>
    </div>
  </header>`
}

// Text past `max` characters (code points, as the checks count them) is marked: that is the part results may cut off.
function marked(text, max) {
  const chars = Array.from(text)
  if (chars.length <= max) return markup`${text}`
  return markup`${chars.slice(0, max).join('')}<mark>${chars.slice(max).join('')}</mark>`
}

function crumbs(url) {
  const { host, pathname } = new URL(url)
  const parts = pathname
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  return [host, ...parts].join(' › ')
}

function snippetNotes({ title, description }) {
  const notes = []
  const titleLength = title ? Array.from(title).length : 0
  const descriptionLength = description ? Array.from(description).length : 0
  if (titleLength > TITLE_MAX) {
    notes.push(
      `The title is ${titleLength} characters. Results often cut titles after about ${TITLE_MAX}, so the marked part may not show.`
    )
  }
  if (descriptionLength > DESCRIPTION_MAX) {
    notes.push(
      `The description is ${descriptionLength} characters. Results often cut it after about ${DESCRIPTION_MAX}, so the marked part may not show.`
    )
  }
  return notes.length ? markup`<ul class="snippet-notes">${notes.map((note) => markup`<li>${note}</li>`)}</ul>` : ''
}

function snippet(page) {
  const { title, description } = page.facts
  return markup`<section class="preview" aria-labelledby="preview-title">
    <h2 id="preview-title">How it can look in search results</h2>
    <figure class="snippet">
      <p class="snippet-crumbs">${crumbs(page.finalUrl)}</p>
      <p class="snippet-title">${title ? marked(title, TITLE_MAX) : markup`<span class="missing">No title. Search engines make one up.</span>`}</p>
      <p class="snippet-text">${description ? marked(description, DESCRIPTION_MAX) : markup`<span class="missing">No description. Search engines pick text from the page instead.</span>`}</p>
    </figure>
    ${snippetNotes(page.facts)}
  </section>`
}

function where(group) {
  const hits = group.hits.filter((hit) => hit.context || hit.expected).slice(0, SHOWN_HITS)
  if (!hits.length) return ''
  const more = group.hits.length - hits.length
  return markup`<div class="where">
    <p class="where-label">Where</p>
    <ul>
      ${hits.map((hit) => markup`<li>${hit.context ? markup`<code>${hit.context}</code>` : ''}${hit.expected ? markup`<span class="measure">Found ${hit.actual}, expected ${hit.expected}.</span>` : ''}</li>`)}
    </ul>
    ${more > 0 ? markup`<p class="where-more">And ${count(more, 'more place')}.</p>` : ''}
  </div>`
}

function finding(group, open) {
  const advice = adviceFor(group.type)
  return markup`<details class="finding" data-severity="${group.severity}" ${open ? markup`open` : ''}>
    <summary>
      <span class="severity" data-severity="${group.severity}">${SEVERITY_LABEL[group.severity]}</span>
      <span class="finding-title">${advice?.title ?? group.message}</span>
      ${group.hits.length > 1 ? markup`<span class="finding-count">${count(group.hits.length, 'place')}</span>` : ''}
    </summary>
    <div class="finding-body">
      <dl class="advice">
        <dt>Why it matters</dt>
        <dd>${advice?.why ?? group.message}</dd>
        ${advice ? markup`<dt>How to fix it</dt><dd>${advice.fix}</dd>` : ''}
      </dl>
      ${where(group)}
    </div>
  </details>`
}

function findings(id, heading, groups, { openFirst = false } = {}) {
  if (!groups.length) return ''
  return markup`<section class="findings" aria-labelledby="${id}">
    <h2 id="${id}">${heading} <span class="heading-count">${groups.length}</span></h2>
    ${groups.map((group, i) => finding(group, openFirst && i === 0))}
  </section>`
}

const DELETE_WARNING = 'The link stops working for everyone you shared it with. The page itself is not touched.'

// checker.js opens this dialog from the Delete results button. Keep them closes it through the form's dialog method,
// which needs no script.
function deleteDialog(audit) {
  return markup`<dialog id="delete-dialog" class="confirm" aria-labelledby="delete-title" closedby="any">
    <h2 id="delete-title">Delete these results?</h2>
    <p>${DELETE_WARNING}</p>
    <form method="post" action="/check/${audit.id}/delete" class="confirm-actions">
      <button type="submit" formmethod="dialog" autofocus>Keep them</button>
      <button type="submit" class="danger">Delete results</button>
    </form>
  </dialog>`
}

// The same question as a page, for a browser that runs no script.
export function deletePage(audit) {
  const main = markup`<section class="failed" aria-labelledby="delete-title">
      <h1 id="delete-title">Delete these results?</h1>
      <p class="address">${shortAddress(audit.url)}</p>
      <p>${DELETE_WARNING}</p>
      <div class="actions">
        <form class="inline-form" method="get" action="/check/${audit.id}">
          <button type="submit">Keep them</button>
        </form>
        <form class="inline-form" method="post" action="/check/${audit.id}/delete">
          <button type="submit" class="danger">Delete results</button>
        </form>
      </div>
    </section>`
  return document({ title: `Delete the results for ${shortAddress(audit.url)}?`, main })
}

// The Markdown brief, shown as it is copied, and the address Claude Code can read it from. The copy button in the head
// copies the text of #claude-brief.
function claudeSection(audit, origin) {
  const address = `${origin}/check/${audit.id}.md`
  return markup`<section class="claude" aria-labelledby="claude-title">
    <h2 id="claude-title">Use these results with Claude</h2>
    <p>Copy for Claude puts the results on the clipboard as Markdown. Paste them into Claude Desktop or Claude Code and say what you want done. In Claude Code you can also give it the address of the same text:</p>
    <p class="brief-address"><a href="/check/${audit.id}.md"><code>${address}</code></a></p>
    <details class="brief">
      <summary>What gets copied</summary>
      <pre id="claude-brief" tabindex="0">${resultBrief(audit, origin)}</pre>
    </details>
  </section>`
}

// `origin` is the address this server is reached at, for the links in the brief.
export function resultPage(audit, origin) {
  const page = audit.result
  const { groups, toFix, notes } = findingsOf(page)
  const main = markup`<article class="result" aria-labelledby="result-title">
      ${resultHead(audit)}
      <p class="verdict">${verdict(groups)}</p>
      ${page.facts ? snippet(page) : ''}
      ${findings('fix-title', 'What to fix', toFix, { openFirst: true })}
      ${findings('notes-title', 'Notes', notes)}
      ${page.facts ? facts(page.facts) : ''}
      ${claudeSection(audit, origin)}
      <p class="source-link">Open the page: ${link(page.finalUrl, shortAddress(page.finalUrl))}</p>
    </article>`
  return document({ title: `Results for ${shortAddress(audit.url)}`, main, after: deleteDialog(audit) })
}
