import { randomBytes } from 'node:crypto'
import { readlinkSync, realpathSync, statSync } from 'node:fs'
import { chmod, lstat, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

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
    try {
      return join(realpathSync(dirname(full)), basename(full))
    } catch {
      return full
    }
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

// A file name to suggest when a report option names a directory.
const EXAMPLE_NAMES = { '--out': 'report.json', '--digest': 'report.digest.json', '--html': 'report.html' }

// Returns a message for each problem with the report options, or an empty list: a path that is a directory, two
// reports that would go to the same file, or a `content` folder (--content) that is a file or a report's path. These can
// only fail at the very end of the audit, so this is checked before it starts.
export async function reportPathProblems(outputs, { content } = {}) {
  const found = []
  const files = []
  for (const [option, path] of outputs) {
    if (!path) continue
    const info = await stat(path).catch(() => null)
    if (info?.isDirectory())
      found.push(
        `${option} needs a file path, but "${path}" is a directory (for example ${path.replace(/\/+$/, '') || '.'}/${EXAMPLE_NAMES[option]})`
      )
    else files.push([option, path])
  }
  for (const [i, [option, path]] of files.entries()) {
    for (const [other, otherPath] of files.slice(i + 1)) {
      if (sameFile(path, otherPath)) found.push(`${option} and ${other} name the same file, give each report its own`)
    }
    if (content && sameFile(path, content)) found.push(`${option} and --content name the same path, give each its own`)
  }
  if (content && (await stat(content).catch(() => null))?.isFile()) {
    found.push(`--content needs a folder, but "${content}" is a file`)
  }
  return found
}
