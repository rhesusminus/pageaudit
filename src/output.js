import { stat, writeFile } from 'node:fs/promises'

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
