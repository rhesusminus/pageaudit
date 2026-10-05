import { writeFile } from 'node:fs/promises'

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
