// writeReportFile(): writes a report file without throwing.
import { randomBytes } from 'node:crypto'
import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { chmod, lstat, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

// Writes a report file. Returns an error message instead of throwing, so a bad path
// never loses the report that was already printed. The report goes to a hidden file beside the one it replaces first,
// so a run that fails or is stopped while writing leaves the earlier report whole. A link is followed, as it stays.
export async function writeReportFile(path, content) {
  const target = destination(path)
  // Still a link once links are followed means a loop of them, which the report must not replace.
  if ((await lstat(target).catch(() => null))?.isSymbolicLink()) return `Could not write ${path}: ELOOP`
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    // A new file gets the default permissions, so the report keeps those of the one it replaces, such as 0600.
    const mode = (await stat(target).catch(() => null))?.mode
    await writeFile(temp, content, { flag: 'wx', mode: mode === undefined ? undefined : mode & 0o777 })
    if (mode !== undefined) await chmod(temp, mode & 0o7777)
    await rename(temp, target)
    return null
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {})
    return `Could not write ${path}: ${err.code ?? err.message}`
  }
}

// Links followed at most, like the system does, so a loop of links ends.
const MAX_LINKS = 40

// The path a link points to, resolved from the real folder of the link as the system does, so a ".." in it leaves
// that folder and not a linked one. Null when the path is not a link.
function linkTarget(path) {
  try {
    return resolve(realpathSync(dirname(path)), readlinkSync(path))
  } catch {
    return null
  }
}

// The file a report path ends up in once links are followed, so two spellings of one file compare equal. The file
// itself may not exist yet, nor its folder, also when a link names it.
function destination(path, links = 0) {
  const full = resolve(path)
  try {
    return realpathSync(full)
  } catch {
    const target = links < MAX_LINKS ? linkTarget(full) : null
    if (target !== null) return destination(target, links + 1)
    return join(canonical(dirname(full)), basename(full))
  }
}

// The full path with the links in the part of it that exists followed, so a folder not made yet compares equal
// however the folders above it are spelled.
function canonical(full) {
  try {
    return realpathSync(full)
  } catch {
    const parent = dirname(full)
    return parent === full ? full : join(canonical(parent), basename(full))
  }
}

// The file system entry at a path, or undefined when it cannot be read, such as a file that does not exist yet.
function entry(path) {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

// True when both report paths end up in the same file, where only the report written last would be left. Files that
// exist are compared as files, so two hard links to one file are the same too.
export function sameFile(a, b) {
  const [first, second] = [entry(a), entry(b)]
  if (first && second) return first.dev === second.dev && first.ino === second.ino
  return destination(a) === destination(b)
}

// True when making the --content folder `content`, which makes every missing folder above it too, makes `folder`.
function madeByContent(folder, content) {
  const path = relative(folder, destination(content))
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

// Why a report cannot be written to `path`, or null when nothing stops it that can be seen before the audit:
// `{ directory: true }` when the path is a folder, `{ missingFolder }` naming the folder the file would go in, after
// a link, when that does not exist, or `{ code }` when the file system refuses to look, such as a folder that cannot
// be opened (EACCES), a name that is too long or a file in place of a folder (ENOTDIR). These only fail when the
// report is written at the end of the audit, so the CLI and the wizard check them before it starts. `content` is the
// --content folder: the audit makes it and the folders above it before any report is written, so those may be missing.
export function reportPathProblem(path, { content } = {}) {
  try {
    if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) return { directory: true }
    const target = destination(path)
    const folder = statSync(dirname(target), { throwIfNoEntry: false })
    // A path under a file, such as file/r.json, gets here: throwIfNoEntry treats its ENOTDIR as no entry too.
    if (folder) return folder.isDirectory() ? null : { code: 'ENOTDIR' }
    if (content && madeByContent(dirname(target), content)) return null
    // Named as typed, unless a link sends the file elsewhere.
    const link = lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()
    return { missingFolder: link ? dirname(target) : dirname(path) }
  } catch (err) {
    return { code: err.code ?? err.message }
  }
}

// Why `path` cannot be the --content folder, or null when nothing stops it that can be seen before the audit:
// `{ file: true }` when the path is a file, or `{ code }` when the file system refuses to look, such as a folder that
// cannot be opened (EACCES) or a name that is too long. The folder may not exist yet, the audit makes it.
export function contentPathProblem(path) {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ? { file: true } : null
  } catch (err) {
    return { code: err.code ?? err.message }
  }
}

// A file name to suggest when a report option names a directory.
const EXAMPLE_NAMES = { '--out': 'report.json', '--digest': 'report.digest.json', '--html': 'report.html' }

// The message for a problem reportPathProblem() found with the path of a report option.
function optionPathMessage(option, path, { directory, missingFolder, code }) {
  if (directory) {
    return `${option} needs a file path, but "${path}" is a directory (for example ${path.replace(/\/+$/, '') || '.'}/${EXAMPLE_NAMES[option]})`
  }
  if (missingFolder) return `${option} needs a folder that exists, but "${missingFolder}" does not exist`
  return `Could not use ${path} for ${option}: ${code}`
}

// The message for a problem contentPathProblem() found with the --content folder.
function contentPathMessage(content, { file, code }) {
  if (file) return `--content needs a folder, but "${content}" is a file`
  return `Could not use ${content} for --content: ${code}`
}

// Returns a message for each problem with the report options, or an empty list: a path reportPathProblem() refuses,
// two reports that would go to the same file, or a `content` folder (--content) that contentPathProblem() refuses or
// that is a report's path. These can only fail at the very end of the audit, so this is checked before it starts.
export function reportPathProblems(outputs, { content } = {}) {
  const found = []
  const files = []
  for (const [option, path] of outputs) {
    if (!path) continue
    const problem = reportPathProblem(path, { content })
    if (problem) found.push(optionPathMessage(option, path, problem))
    else files.push([option, path])
  }
  for (const [i, [option, path]] of files.entries()) {
    for (const [other, otherPath] of files.slice(i + 1)) {
      if (sameFile(path, otherPath)) found.push(`${option} and ${other} name the same file, give each report its own`)
    }
    if (content && sameFile(path, content)) found.push(`${option} and --content name the same path, give each its own`)
  }
  const contentProblem = content && contentPathProblem(content)
  if (contentProblem) found.push(contentPathMessage(content, contentProblem))
  return found
}
