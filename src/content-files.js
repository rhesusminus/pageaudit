import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
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
export function contentNames(urls) {
  const taken = new Set()
  return new Map(
    urls.map((url) => {
      const base = baseName(url)
      let name = `${base}.md`
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}.md`
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
// pages of this audit. Every other file is left alone. Returns why the folder cannot be used, or null.
export async function prepareContentFolder(dir) {
  try {
    if ((await stat(dir).catch(() => null))?.isFile()) return `--content needs a folder, but "${dir}" is a file`
    await mkdir(dir, { recursive: true })
    for (const name of await readdir(dir)) {
      const path = join(dir, name)
      if (name.endsWith('.md') && (await earlierPage(path))) await rm(path)
    }
    return null
  } catch (err) {
    return `Could not use ${dir} for --content: ${err.code ?? err.message}`
  }
}

// Writes the content of each page as it is audited, to the file contentNames() gave its URL, and drops it from the
// page, so the Markdown of a large audit is never all in memory. A page that got a file has `contentFile`, its path.
// After a write fails the others are not tried: the folder is the same for all of them.
export function contentWriter(dir, urls) {
  const names = contentNames(urls)
  let written = 0
  let failure = null
  return {
    async write(page) {
      const { content } = page
      delete page.content
      if (content === null || content === undefined || failure) return
      const path = join(dir, names.get(page.url))
      failure = await writeReportFile(path, content)
      if (failure) return
      page.contentFile = path
      written++
    },
    // What happened, to print once the audit is done, and whether every file was written.
    outcome: () => ({
      message: failure ?? `Page content written to ${dir} (${written} ${written === 1 ? 'file' : 'files'})`,
      ok: !failure
    })
  }
}
