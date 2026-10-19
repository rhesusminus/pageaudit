import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentNames, contentWriter, prepareContentFolder } from '../src/content-files.js'
import { pageMarkdown } from '../src/markdown.js'
import { parse } from '../src/parse.js'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pageaudit-content-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const markdown = (url) => pageMarkdown(parse('<main><p>Text</p></main>'), { url, finalUrl: url, title: 'T' })

test('contentNames: host, path and query flattened into one name per URL', () => {
  const names = contentNames([
    'https://web.dev/articles/inp',
    'https://a.test/',
    'https://a.test/docs/?q=1&x=ä',
    'http://localhost:8080/a b/'
  ])
  assert.deepEqual(
    [...names.values()],
    ['web.dev_articles_inp.md', 'a.test.md', 'a.test_docs_q_1_x_C3_A4.md', 'localhost_8080_a_20b.md']
  )
})

test('contentNames: a clash, also one that differs only in case, gets a number in input order', () => {
  const names = contentNames(['https://a.test/A', 'https://a.test/a', 'https://a.test/a/', 'https://a.test/b'])
  assert.deepEqual([...names.values()], ['a.test_A.md', 'a.test_a-2.md', 'a.test_a-3.md', 'a.test_b.md'])
})

test('contentNames: a very long URL gets a name of at most 100 characters before .md', () => {
  const [name] = contentNames([`https://a.test/${'x'.repeat(300)}`]).values()
  assert.equal(name.length, 103)
})

test('prepareContentFolder: makes the folder, also nested', async (t) => {
  const dir = join(await tempDir(t), 'a', 'b')
  assert.equal(await prepareContentFolder(dir), null)
  assert.deepEqual(await readdir(dir), [])
})

test('prepareContentFolder: removes only the files an earlier run wrote', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'old.md'), markdown('https://a.test/old'))
  await writeFile(join(dir, 'notes.md'), '# My notes\n')
  await writeFile(join(dir, 'empty.md'), '')
  await writeFile(join(dir, 'old.txt'), markdown('https://a.test/txt'))
  await mkdir(join(dir, 'folder.md'))
  assert.equal(await prepareContentFolder(dir), null)
  assert.deepEqual((await readdir(dir)).sort(), ['empty.md', 'folder.md', 'notes.md', 'old.txt'])
})

test('prepareContentFolder: a file in the way is refused', async (t) => {
  const path = join(await tempDir(t), 'content')
  await writeFile(path, 'x')
  assert.match(await prepareContentFolder(path), /--content needs a folder, but ".*content" is a file/)
  assert.match(await prepareContentFolder(join(path, 'sub')), /Could not use .* for --content: (ENOTDIR|EEXIST)/)
})

test('contentWriter: writes each page with content, drops it from the page and lists the files by URL', async (t) => {
  const dir = await tempDir(t)
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y', 'https://a.test/z'])
  const pages = [
    { url: 'https://a.test/x', content: 'X' },
    { url: 'https://a.test/y', content: null },
    { url: 'https://a.test/z' }
  ]
  for (const page of pages) await writer.write(page)
  assert.deepEqual(pages, [{ url: 'https://a.test/x' }, { url: 'https://a.test/y' }, { url: 'https://a.test/z' }])
  assert.equal(await readFile(join(dir, 'a.test_x.md'), 'utf8'), 'X')
  assert.deepEqual(writer.outcome(), {
    message: `Page content written to ${dir} (1 file)`,
    ok: true,
    files: new Map([['https://a.test/x', join(dir, 'a.test_x.md')]])
  })
})

test('contentWriter: after a write fails the others are not tried', async (t) => {
  const dir = await tempDir(t)
  await mkdir(join(dir, 'a.test_x.md'))
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'])
  const y = { url: 'https://a.test/y', content: 'Y' }
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await writer.write(y)
  assert.deepEqual(y, { url: 'https://a.test/y' })
  assert.deepEqual(await readdir(dir), ['a.test_x.md'])
  const { message, ok, files } = writer.outcome()
  assert.equal(ok, false)
  assert.deepEqual(files, new Map())
  assert.match(message, /Could not write .*a\.test_x\.md: EISDIR/)
})
