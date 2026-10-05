// Text from audited sites (titles, URLs, snippets) is untrusted, so every value that
// reaches the HTML goes through the `markup` tag, which escapes it. Only markup built by
// this code is passed through, wrapped with raw().
class Safe {
  constructor(text) {
    this.text = text
  }
  toString() {
    return this.text
  }
}

export const raw = (text) => new Safe(text)

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ENTITIES[char])

function render(value) {
  if (value instanceof Safe) return value.text
  if (Array.isArray(value)) return value.map(render).join('')
  if (value === null || value === undefined || value === false) return ''
  return escapeHtml(value)
}

// Tagged template: markup`<p>${text}</p>` returns safe markup with `text` escaped.
export function markup(strings, ...values) {
  return raw(strings.reduce((out, chunk, i) => out + chunk + (i < values.length ? render(values[i]) : ''), ''))
}
