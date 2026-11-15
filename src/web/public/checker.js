// Enhancements for the pageaudit pages. Every page works without this file: the form posts, a check in progress
// reloads itself and Delete results opens a page that asks first. Copy for Claude needs it, so it is hidden without it.

const DONE = new Set(['completed', 'failed'])
const POLL_MS = 1000
const MAX_POLL_MS = 8000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Resolves once the tab is visible, so a check left open in a background tab does not keep polling.
const visible = () =>
  document.visibilityState === 'visible'
    ? Promise.resolve()
    : new Promise((resolve) => document.addEventListener('visibilitychange', resolve, { once: true }))

async function fetchStatus(id) {
  try {
    const response = await fetch(`/audits/${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    })
    if (response.status === 404) return 'missing'
    return response.ok ? (await response.json()).status : null
  } catch {
    return null
  }
}

// Moves the page to a new state in place: the steps, and the status line, which is a live region and is announced.
function showStatus(section, status) {
  section.dataset.auditStatus = status
  for (const step of section.querySelectorAll('[data-step]')) {
    if (step.dataset.step === status) step.setAttribute('aria-current', 'step')
    else step.removeAttribute('aria-current')
  }
  const text = section.dataset[`text${status[0].toUpperCase()}${status.slice(1)}`]
  const line = section.querySelector('[role="status"]')
  if (text && line) line.textContent = text
}

// Polls the audit until it finishes, then loads its results. Failed requests back off up to MAX_POLL_MS.
async function followAudit(section) {
  let wait = POLL_MS
  for (;;) {
    await sleep(wait)
    await visible()
    const status = await fetchStatus(section.dataset.auditId)
    if (status === null) {
      wait = Math.min(wait * 2, MAX_POLL_MS)
      continue
    }
    wait = POLL_MS
    if (status === 'missing' || DONE.has(status)) return location.reload()
    if (status !== section.dataset.auditStatus) showStatus(section, status)
  }
}

const progress = document.querySelector('[data-audit-id][data-audit-status]')
if (progress && !DONE.has(progress.dataset.auditStatus)) followAudit(progress)

// ---- the address field ----

// aria-invalid follows :user-invalid, and the field's error is in aria-describedby only while it shows: text that
// aria-describedby points at is read out even when hidden. A problem the server found is dropped once the reader
// edits the address.
function linkError(field, errorId, shown) {
  const ids = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== errorId)
  if (shown) ids.push(errorId)
  field.setAttribute('aria-describedby', ids.join(' '))
}

// One polite live region announces an error that appears when the reader leaves the field. It waits a moment so it
// does not talk over the control that takes focus next. A shown error is not a live region of its own, since one
// that appears rather than changes is not announced reliably.
function announcer() {
  const region = document.createElement('div')
  region.setAttribute('aria-live', 'polite')
  region.className = 'visually-hidden'
  document.body.append(region)
  let timer
  return {
    say(text) {
      clearTimeout(timer)
      region.textContent = ''
      timer = setTimeout(() => {
        region.textContent = text
      }, 500)
    },
    clear() {
      clearTimeout(timer)
      region.textContent = ''
    }
  }
}

// Text as a screen reader reads it: the error mark is an image whose text alternative is "Error".
const spoken = (node) => {
  const mark = node.querySelector('[role="img"][aria-label]')
  return `${mark ? `${mark.getAttribute('aria-label')}: ` : ''}${node.textContent.trim()}`
}

function followField(field) {
  const live = announcer()
  const error = document.getElementById(field.dataset.error)
  let announced = false

  const sync = (announce) => {
    // While the server's problem is shown, it owns aria-invalid.
    if (document.getElementById('url-problem')) return
    const invalid = field.matches(':user-invalid')
    field.setAttribute('aria-invalid', String(invalid))
    linkError(field, field.dataset.error, invalid)
    if (invalid && announce && !announced) live.say(`${field.labels[0].textContent}: ${spoken(error)}`)
    if (!invalid) live.clear()
    announced = invalid && (announced || announce)
  }

  field.addEventListener('blur', () => sync(true))
  field.addEventListener('input', () => {
    dropServerProblem(field)
    if (field.getAttribute('aria-invalid') === 'true') sync(false)
  })
  // A failed submit marks the field. The page shows its own error next to it, so the browser's bubble is cancelled,
  // which also stops the browser moving focus: focus goes to the field here, and that reads its error out.
  field.addEventListener('invalid', (event) => {
    event.preventDefault()
    announced = true
    sync(false)
    field.focus()
  })
}

function dropServerProblem(field) {
  const problem = document.getElementById('url-problem')
  if (!problem) return
  problem.remove()
  linkError(field, 'url-problem', false)
  field.setAttribute('aria-invalid', 'false')
}

const field = document.querySelector('input[data-error]')
if (field) followField(field)

// ---- copy for Claude ----

// The button copies the text of the element its commandfor names. Messages show in the button's status bubble, which
// is also the live region, so everyone gets the same message. VoiceOver skips a message equal to the last one, so a
// repeat gets a no-break space it does not read out.
const copyTimers = new WeakMap()
let lastCopyMessage = ''

function reportCopy(button, ok) {
  const status = button.nextElementSibling
  const clear = () => {
    button.removeAttribute('data-copied')
    button.removeAttribute('data-failed')
    status.textContent = ''
  }
  clearTimeout(copyTimers.get(button))
  clear()
  void button.offsetWidth // restarts the animation
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '')
  let message = ok ? 'Copied' : 'Copy failed'
  if (message === lastCopyMessage) message += '\u00a0'
  lastCopyMessage = message
  requestAnimationFrame(() => {
    status.textContent = message
  })
  copyTimers.set(button, setTimeout(clear, 2000))
}

// When the browser will not write to the clipboard, the text is shown and selected instead, so the keyboard shortcut
// for copy still works.
function selectForCopy(target) {
  const details = target.closest('details')
  if (details) details.open = true
  getSelection().selectAllChildren(target)
}

async function copy(button, target) {
  try {
    // navigator.clipboard is missing outside secure contexts (https: and localhost), which lands here too.
    await navigator.clipboard.writeText(target.textContent)
    reportCopy(button, true)
  } catch {
    selectForCopy(target)
    reportCopy(button, false)
  }
}

// The button does nothing without this script, so it is hidden until now.
for (const wrapper of document.querySelectorAll('.copy[hidden]')) wrapper.hidden = false

// ---- the delete dialog ----

// Without this script the button submits its form, which opens a page that asks first. Here it asks in the dialog.
for (const button of document.querySelectorAll('button[data-opens]')) {
  const dialog = document.getElementById(button.dataset.opens)
  if (!(dialog instanceof HTMLDialogElement)) continue
  button.setAttribute('aria-haspopup', 'dialog')
  button.addEventListener('click', (event) => {
    event.preventDefault()
    dialog.showModal()
  })
}

// ---- invoker commands ----

const INVOKERS = 'commandForElement' in HTMLButtonElement.prototype

if (INVOKERS) {
  // command events do not bubble, so they are caught on the way down. event.source is the button.
  document.addEventListener(
    'command',
    (event) => {
      if (event.command === '--copy') copy(event.source, event.target)
    },
    true
  )
} else {
  // Browsers without invoker commands ignore command and commandfor, so the copy button is wired up here.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[commandfor][command="--copy"]')
    const target = button && document.getElementById(button.getAttribute('commandfor'))
    if (target) copy(button, target)
  })
}
