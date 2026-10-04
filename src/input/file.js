import { readFile } from 'node:fs/promises'
import { text } from 'node:stream/consumers'

// One URL per line. Blank lines are ignored, and # starts a comment at the start of a
// line or after whitespace, so a # inside a URL is still read as a fragment.
export function parseUrlList(content, name) {
  return content.split(/\r?\n/).flatMap((line, i) => {
    const value = line.replace(/(^|\s)#.*$/, '').trim()
    return value ? [{ value, source: `${name}:${i + 1}` }] : []
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
