import { mkdir, open, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HEAD_LENGTH, writtenByPageaudit } from './markdown.js'
import { writeReportFile } from './output.js'

const MAX_NAME = 100

// A file name from the host, path and query of a URL, such as web.dev_articles_inp for
// https://web.dev/articles/inp. Characters that are not safe in a file name become "_".
function baseName(url) {
  const { host, pathname, search } = new URL(url)
  const flat = `${host}${pathname}${search}`
    .replace(/[^A-Za-z0-9.-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, MAX_NAME)
  return flat || 'page'
}

// The --content file name of each URL, in input order, so the same input gives the same names. File systems that
// ignore case would put /A and /a in one file, so names are unique ignoring case: a clash gets -2, -3 and so on.
// `existing` holds the names of files already in the folder, lowercased, which are never used.
export function contentNames(urls, existing = new Set()) {
  const taken = new Set(existing)
  // The next number to try for each name, so many URLs with one name do not each count up from 2.
  const next = new Map()
  return new Map(
    urls.map((url) => {
      const base = baseName(url)
      let name = `${base}.md`
      let n = next.get(base.toLowerCase()) ?? 2
      while (taken.has(name.toLowerCase())) name = `${base}-${n++}.md`
      next.set(base.toLowerCase(), n)
      taken.add(name.toLowerCase())
      return [url, name]
    })
  )
}

// True for a Markdown file an earlier run wrote. Only the start is read, a folder or unreadable file is not one.
async function earlierPage(path) {
  let file
  try {
    file = await open(path)
    const { bytesRead, buffer } = await file.read({ buffer: Buffer.alloc(HEAD_LENGTH), position: 0 })
    return writtenByPageaudit(buffer.toString('utf8', 0, bytesRead))
  } catch {
    return false
  } finally {
    await file?.close()
  }
}

// Makes the --content folder and removes the Markdown files an earlier run wrote there, so the folder holds only the
// pages of this audit. Every other file is left alone. Returns `existing`, the lowercased names of the files left,
// or `problem`, why the folder cannot be used.
export async function prepareContentFolder(dir) {
  try {
    await mkdir(dir, { recursive: true })
    const existing = new Set()
    for (const name of await readdir(dir)) {
      const path = join(dir, name)
      if (name.endsWith('.md') && (await earlierPage(path))) await rm(path)
      else existing.add(name.toLowerCase())
    }
    return { existing }
  } catch (err) {
    return { problem: `Could not use ${dir} for --content: ${err.code ?? err.message}` }
  }
}

// Writes the content of each page as it is audited, to the file contentNames() gave its URL, and drops it from the
// page, so the Markdown of a large audit is never all in memory. `existing` is what prepareContentFolder() found.
// A file is only ever created, never replaced, so a file that appeared in the folder meanwhile is left alone. After
// a write fails no new one is started: the folder is the same for all of them.
export function contentWriter(dir, urls, existing) {
  const names = contentNames(urls, existing)
  const files = new Map()
  const unconverted = []
  let failure = null
  return {
    async write(page) {
      const { content } = page
      delete page.content
      // A page that returned no HTML has no content, one the Markdown failed on has null.
      if (content === null) unconverted.push(page.url)
      if (typeof content !== 'string' || failure) return
      const path = join(dir, names.get(page.url))
      // Writes run side by side, so the first failure is kept whatever finishes after it.
      const problem = await writeReportFile(path, content, { flag: 'wx' })
      if (problem) failure ??= problem
      else files.set(page.url, path)
    },
    // What happened, to print once the audit is done, whether every file was written, and the file of each page
    // by URL.
    outcome: () => ({
      message: [
        failure ?? `Page content written to ${dir} (${files.size} ${files.size === 1 ? 'file' : 'files'})`,
        ...unconvertedLines(unconverted)
      ].join('\n'),
      ok: !failure,
      files
    })
  }
}

const MAX_LISTED = 5

// Pages whose content could not be turned into Markdown, a bug in pageaudit: their checks are in the report, only the
// file is missing.
function unconvertedLines(urls) {
  if (!urls.length) return []
  const more = urls.length > MAX_LISTED ? [`and ${urls.length - MAX_LISTED} more`] : []
  return [
    `The content of ${urls.length} ${urls.length === 1 ? 'page' : 'pages'} could not be converted to Markdown:`,
    ...urls.slice(0, MAX_LISTED),
    ...more
  ]
}
