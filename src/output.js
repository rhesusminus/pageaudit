import { realpathSync, statSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

// Writes a report file. Returns an error message instead of throwing, so a bad path
// never loses the report that was already printed.
export async function writeReportFile(path, content) {
  try {
    await writeFile(path, content)
    return null
  } catch (err) {
    return `Could not write ${path}: ${err.code ?? err.message}`
  }
}

// The file a report path ends up in once links are followed, so two spellings of one file compare equal. The file
// itself may not exist yet, nor its folder.
function destination(path) {
  const full = resolve(path)
  try {
    return realpathSync(full)
  } catch {
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
// reports that would go to the same file, or a report file that is also the `content` folder (--content). These can
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
  return found
}
