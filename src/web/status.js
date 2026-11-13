// The pages for an audit that has not finished, or that failed.
import { adviceFor } from '../advice.js'
import { AUDIT_ERROR } from '../api/audit-errors.js'
import { markup } from '../html/escape.js'
import { addressHeading, shortAddress } from './format.js'
import { againForm, checkForm } from './home.js'
import { document } from './layout.js'

// What the status line says in each state. checker.js reads these from the page, so the wording lives in one place.
const STATUS_TEXT = {
  queued: 'Waiting for the check ahead of this one to finish.',
  running: 'Reading the page and running the checks. This usually takes a few seconds.'
}

const STEPS = [
  ['queued', 'In line'],
  ['running', 'Reading the page'],
  ['done', 'Results']
]

export function progressPage(audit) {
  const address = shortAddress(audit.url)
  const heading = addressHeading(audit.url)
  const main = markup`<section
      class="progress"
      aria-labelledby="progress-title"
      data-audit-id="${audit.id}"
      data-audit-status="${audit.status}"
      data-text-queued="${STATUS_TEXT.queued}"
      data-text-running="${STATUS_TEXT.running}"
    >
      <h1 id="progress-title" ${heading.long ? markup`class="long-address"` : ''}>Checking <span class="address reading">${heading.text}</span></h1>
      <ol class="steps">
        ${STEPS.map(([step, label]) => markup`<li data-step="${step}" ${step === audit.status ? markup`aria-current="step"` : ''}>${label}</li>`)}
      </ol>
      <p class="status-line" role="status">${STATUS_TEXT[audit.status]}</p>
      <p class="hint">This page updates by itself. You can also close it and come back to this link later.</p>
    </section>`
  // Without JavaScript the page reloads itself instead of polling.
  const head = markup`<noscript><meta http-equiv="refresh" content="3" /></noscript>`
  return document({ title: `Checking ${address}`, main, head })
}

// What a failed check means for the reader. A fetch that failed has advice of its own. Any other failure means the
// check itself broke or was interrupted, and only then is the reason the worker gave shown, since for a fetch that
// failed it would repeat the heading.
export function failure(error) {
  if (error === AUDIT_ERROR.fetchFailed) {
    const { title, why } = adviceFor('fetch-failed')
    return { title, why, fix: 'Check that the address is correct and that the site is up, then try again.' }
  }
  return {
    title: 'The check did not finish',
    why: 'Something went wrong while checking this page, so there are no results for it.',
    fix: 'Try again. If it keeps failing, the page may be built in a way the checks cannot read.',
    reason: error
  }
}

export function failedPage(audit) {
  const { title, why, fix, reason } = failure(audit.error)
  const main = markup`<section class="failed" aria-labelledby="failed-title">
      <h1 id="failed-title">${title}</h1>
      <p class="address">${shortAddress(audit.url)}</p>
      <p>${why}</p>
      <p>${fix}</p>
      ${reason ? markup`<p class="reason">Reason given: <code>${reason}</code></p>` : ''}
      ${againForm(audit.url, 'Try again')}
    </section>
    <section class="again" aria-labelledby="again-title">
      <h2 id="again-title">Check a different page</h2>
      ${checkForm()}
    </section>`
  return document({ title: `${title} - ${shortAddress(audit.url)}`, main })
}

// A page that only says why there is nothing to show here. `body` is the markup after the heading.
function messagePage({ title, heading, body }) {
  const main = markup`<section class="failed" aria-labelledby="message-title">
      <h1 id="message-title">${heading}</h1>
      ${body}
    </section>`
  return document({ title, main })
}

export const notFoundPage = () =>
  messagePage({
    title: 'No results here',
    heading: 'There are no results at this link',
    body: markup`<p>They were deleted, or the link is incomplete. Check the page again to get new results.</p>
      ${checkForm()}`
  })

// An address on this site that is not a page at all.
export const missingPage = () =>
  messagePage({
    title: 'Page not found',
    heading: 'There is no page at this address',
    body: markup`<p><a href="/">Check a page</a> instead.</p>`
  })

// A form posted from another site. The forms here change state, so only this site's own pages may send them.
export const refusedPage = () =>
  messagePage({
    title: 'Form not accepted',
    heading: 'This form was sent from another site',
    body: markup`<p>Checks and deletes are only accepted from the pages of this site, so another site cannot make them for you.</p>
      <p><a href="/">Check a page here</a> instead.</p>`
  })

// A request this site could not read, such as a form that is too large or not sent as a form.
export const requestErrorPage = () =>
  messagePage({
    title: 'Request not read',
    heading: 'This request could not be read',
    body: markup`<p>What was sent did not arrive as a form this site understands. Go back to the start and try again.</p>
      <p><a href="/">Back to the start</a></p>`
  })

export const errorPage = () =>
  messagePage({
    title: 'Something went wrong',
    heading: 'Something went wrong on our side',
    body: markup`<p>The request could not be finished. Wait a moment and try again.</p>
      <p><a href="/">Back to the start</a></p>`
  })
