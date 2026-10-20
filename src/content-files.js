import { lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HEAD_LENGTH, writtenByPageaudit } from './markdown.js'
import { sameFile } from './output.js'

const MAX_NAME = 100
// The start of the name of the hidden folder in the --content folder that holds the files of an audit until it is done.
const STAGING = '.pageaudit-'

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

// Makes the --content folder and a hidden staging folder in it for the files of this audit. They replace the
// Markdown files an earlier run wrote only once the audit is done, so a run that fails or is stopped keeps those.
// Staging folders such a run left behind are removed. Every other file is left alone. Returns `existing`, the
// lowercased names of the other files, `earlier`, the names of the files an earlier run wrote, and `staging`, or
// `problem`, why the folder cannot be used.
export async function prepareContentFolder(dir) {
  try {
    await mkdir(dir, { recursive: true })
    const existing = new Set()
    const earlier = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.name.startsWith(STAGING) && entry.isDirectory()) await rm(path, { recursive: true, force: true })
      else if (entry.name.endsWith('.md') && (await earlierPage(path))) earlier.push(entry.name)
      else existing.add(entry.name.toLowerCase())
    }
    return { existing, earlier, staging: await mkdtemp(join(dir, STAGING)) }
  } catch (err) {
    return { problem: `Could not use ${dir} for --content: ${err.code ?? err.message}` }
  }
}

const exists = (path) =>
  lstat(path).then(
    () => true,
    () => false
  )

// Moves the staged files into the folder, replacing an earlier run's file of the same name, then removes the earlier
// files no page replaced. A name taken during the audit by a file pageaudit did not write stops it before anything
// changes, as that file is never replaced. Returns the file of each page moved, by URL, and `problem`, why not all of
// them were or an earlier file is left.
async function moveIn(dir, staging, staged, earlier) {
  const files = new Map()
  for (const name of staged.values()) {
    const path = join(dir, name)
    if ((await exists(path)) && !(await earlierPage(path))) return { files, problem: `Could not write ${path}: EEXIST` }
  }
  try {
    for (const [url, name] of staged) {
      await rename(join(staging, name), join(dir, name))
      files.set(url, join(dir, name))
    }
  } catch (err) {
    return { files, problem: `Could not move the page content into ${dir}: ${err.code ?? err.message}` }
  }
  return { files, problem: await removeEarlier(dir, earlier, staged.values()) }
}

// Removes the files an earlier run wrote that no page of this audit replaced. Each is checked again, so a file that
// took the place of one during the audit stays, and on a file system that ignores case A.md is not removed when it
// is the a.md just moved in. Returns why one could not be removed, or undefined.
async function removeEarlier(dir, earlier, names) {
  const moved = new Map([...names].map((name) => [name.toLowerCase(), join(dir, name)]))
  try {
    for (const name of earlier) {
      const path = join(dir, name)
      const twin = moved.get(name.toLowerCase())
      if (!(twin && sameFile(path, twin)) && (await earlierPage(path))) await rm(path, { force: true })
    }
    return undefined
  } catch (err) {
    return `Could not remove the files of the earlier run from ${dir}: ${err.code ?? err.message}`
  }
}

// Writes the content of each page as it is audited into the staging folder, to the file contentNames() gave its
// URL, and drops it from the page, so the Markdown of a large audit is never all in memory. The last argument is
// what prepareContentFolder() returned. After a write fails no new one is started: the folder is the same for all of them.
export function contentWriter(dir, urls, { existing, earlier, staging }) {
  const names = contentNames(urls, existing)
  const staged = new Map()
  const unconverted = []
  let failure = null
  return {
    async write(page) {
      const { content } = page
      delete page.content
      // A page that returned no HTML has no content, one the Markdown failed on has null.
      if (content === null) unconverted.push(page.url)
      if (typeof content !== 'string' || failure) return
      const name = names.get(page.url)
      try {
        await writeFile(join(staging, name), content, { flag: 'wx' })
        staged.set(page.url, name)
      } catch (err) {
        // Writes run side by side, so the first failure is kept whatever finishes after it.
        failure ??= `Could not write ${join(dir, name)}: ${err.code ?? err.message}`
      }
    },
    // Called once the audit is done: moves the files into the folder, unless a write failed, and removes the staging
    // folder. Returns what happened, to print, whether every file was written, and the file of each page by URL.
    async finish() {
      const { files, problem } = failure ? { files: new Map() } : await moveIn(dir, staging, staged, earlier)
      // A staging folder left behind is removed by the next run, so this never stops the report.
      await rm(staging, { recursive: true, force: true }).catch(() => {})
      const trouble = failure ?? problem
      const kept =
        trouble && !files.size ? [`No page content was written to ${dir}, the files in it were left alone`] : []
      return {
        message: [
          trouble ?? `Page content written to ${dir} (${files.size} ${files.size === 1 ? 'file' : 'files'})`,
          ...kept,
          ...unconvertedLines(unconverted)
        ].join('\n'),
        ok: !trouble,
        files
      }
    }
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
