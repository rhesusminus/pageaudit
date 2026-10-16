import { realpathSync } from 'node:fs'
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

// True when both report paths end up in the same file, where only the report written last would be left.
export const sameFile = (a, b) => destination(a) === destination(b)

// Returns a message for each report option whose path is a directory, or an empty list. A directory can only fail at
// the very end of the audit, so this is checked before it starts.
export async function directoryOutputs(outputs) {
  const found = []
  for (const [option, path] of outputs) {
    if (!path) continue
    const info = await stat(path).catch(() => null)
    if (info?.isDirectory())
      found.push(
        `${option} needs a file path, but "${path}" is a directory (for example ${path.replace(/\/+$/, '') || '.'}/report${option === '--html' ? '.html' : '.json'})`
      )
  }
  return found
}
