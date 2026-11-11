import { markup } from '../html/escape.js'
import { document } from './layout.js'

// The address form. With `problem` (the server refused the address) the field comes back filled in, marked invalid,
// described by the problem and focused, so a screen reader reads the problem first.
/** @param {{ value?: string, problem?: string | null, label?: string, button?: string }} [options] */
export function checkForm({ value = '', problem = null, label = 'Page address', button = 'Check page' } = {}) {
  const describedBy = problem ? 'url-hint url-problem' : 'url-hint'
  return markup`<form class="check-form" method="post" action="/check">
    <label for="url">${label}</label>
    <p id="url-hint" class="hint">For example example.com/products/linen-shirt</p>
    <div class="check-row">
      <input
        id="url"
        name="url"
        type="text"
        inputmode="url"
        autocomplete="url"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="go"
        maxlength="2048"
        required
        value="${value}"
        aria-describedby="${describedBy}"
        aria-invalid="${problem ? 'true' : 'false'}"
        data-error="url-error"
        ${problem ? markup`autofocus` : ''}
      />
      <button type="submit">${button}</button>
    </div>
    <p id="url-error" class="field-error"><span class="error-mark" role="img" aria-label="Error"></span>Enter the address of a page.</p>
    ${problem ? markup`<p id="url-problem" class="field-error is-shown"><span class="error-mark" role="img" aria-label="Error"></span>${problem}</p>` : ''}
  </form>`
}

const CHECKS = [
  ['Search', 'The title and description people see in results, headings, canonical address and indexing rules.'],
  ['Accessibility', 'Image text, form labels, link names and the order of headings.'],
  ['Sharing', 'The preview a link gets in chats and social feeds, and the structured data behind rich results.'],
  ['Hygiene', 'Redirects, broken markup, duplicate ids and links that go nowhere.']
]

/** @param {{ value?: string, problem?: string | null, notice?: string | null }} [options] */
export function homePage({ value = '', problem = null, notice = null } = {}) {
  const main = markup`<section class="intro" aria-labelledby="intro-title">
      ${notice ? markup`<p class="notice" role="status">${notice}</p>` : ''}
      <h1 id="intro-title">Check a page</h1>
      <p class="lede">
        Give pageaudit the address of one page. It reads the page the way search engines and screen readers do, and
        tells you what to fix first, in plain language.
      </p>
      ${checkForm({ value, problem })}
    </section>
    <section class="scope" aria-labelledby="scope-title">
      <h2 id="scope-title">What it looks at</h2>
      <dl class="scope-list">
        ${CHECKS.map(([name, text]) => markup`<div><dt>${name}</dt><dd>${text}</dd></div>`)}
      </dl>
    </section>`
  return document({ title: problem ? 'Check a page - address not accepted' : 'Check a page', main })
}
