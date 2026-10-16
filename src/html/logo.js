import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
}
export const MAX_LOGO_BYTES = 512 * 1024

// The media type of a logo file, by its extension, or undefined when the file type cannot be a logo.
export const logoType = (path) => MIME_TYPES[extname(path).toLowerCase()]

// Reads a logo file into a data URI so the report stays a single file. Throws an Error
// with a message fit to print when the file cannot be used.
export async function readLogo(path) {
  const type = logoType(path)
  if (!type) throw new Error(`--logo must be a png, jpg, gif, webp or svg file, got "${path}"`)
  let data
  try {
    data = await readFile(path)
  } catch (err) {
    throw new Error(`Could not read the logo ${path}: ${err.code ?? err.message}`, { cause: err })
  }
  if (data.length > MAX_LOGO_BYTES) throw new Error(`The logo ${path} is larger than ${MAX_LOGO_BYTES / 1024} KB`)
  return `data:${type};base64,${data.toString('base64')}`
}
