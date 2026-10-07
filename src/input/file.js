import { readFile } from 'node:fs/promises'
import { text } from 'node:stream/consumers'

// Words that may follow a URL on its line, to mark the page.
const MARKERS = new Set(['lighthouse'])

// One URL per line. Blank lines are ignored, and # starts a comment at the start of a
// line or after whitespace, so a # inside a URL is still read as a fragment. A URL can be followed by the
// word "lighthouse" to get the detailed Lighthouse run. Any other text after a URL rejects the line, so a typo in
// the word never turns into a URL with a space in it.
export function parseUrlList(content, name) {
  return content.split(/\r?\n/).flatMap((line, i) => {
    const text = line.replace(/(^|\s)#.*$/, '').trim()
    if (!text) return []
    const [first, ...rest] = text.split(/\s+/)
    const marked = rest.length > 0 && rest.every((word) => MARKERS.has(word.toLowerCase()))
    const source = `${name}:${i + 1}`
    if (rest.length === 0) return [{ value: first, source }]
    if (marked) return [{ value: first, source, lighthouse: true }]
    const reason = `unexpected text after the URL (only "lighthouse" may follow it): ${rest.join(' ')}`
    return [{ value: text, source, rejected: reason }]
  })
}

// Reads the list from a file, or from stdin when path is "-".
export async function fromFile(path, { stdin = process.stdin } = {}) {
  if (path === '-') return parseUrlList(await text(stdin), 'stdin')
  let content
  try {
    content = await readFile(path, 'utf8')
  } catch (err) {
    throw new Error(`Could not read ${path}: ${err.code ?? err.message}`, { cause: err })
  }
  return parseUrlList(content, path)
}
