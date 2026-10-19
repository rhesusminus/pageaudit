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

test('contentNames: a name already in the folder is never used', () => {
  const names = contentNames(['https://a.test/x', 'https://a.test/y'], new Set(['a.test_x.md']))
  assert.deepEqual([...names.values()], ['a.test_x-2.md', 'a.test_y.md'])
})

test('contentNames: numbers continue past the ones already used for a name', () => {
  const long = `https://a.test/${'x'.repeat(200)}`
  const base = `a.test_${'x'.repeat(93)}`
  const names = contentNames([`${long}/1`, `${long}/2`, `${long}/3`], new Set([`${base}-3.md`]))
  assert.deepEqual([...names.values()], [`${base}.md`, `${base}-2.md`, `${base}-4.md`])
})

test('prepareContentFolder: makes the folder, also nested', async (t) => {
  const dir = join(await tempDir(t), 'a', 'b')
  assert.deepEqual(await prepareContentFolder(dir), { existing: new Set() })
  assert.deepEqual(await readdir(dir), [])
})

test('prepareContentFolder: removes only the files an earlier run wrote, and names the others', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'old.md'), markdown('https://a.test/old'))
  await writeFile(join(dir, 'Notes.md'), '# My notes\n')
  await writeFile(join(dir, 'empty.md'), '')
  await writeFile(join(dir, 'old.txt'), markdown('https://a.test/txt'))
  await mkdir(join(dir, 'folder.md'))
  const { existing } = await prepareContentFolder(dir)
  assert.deepEqual([...existing].sort(), ['empty.md', 'folder.md', 'notes.md', 'old.txt'])
  assert.deepEqual((await readdir(dir)).sort(), ['Notes.md', 'empty.md', 'folder.md', 'old.txt'])
})

test('prepareContentFolder: a folder that cannot be made says why', async (t) => {
  const path = join(await tempDir(t), 'content')
  await writeFile(path, 'x')
  for (const dir of [path, join(path, 'sub')]) {
    const { problem } = await prepareContentFolder(dir)
    assert.match(problem, /Could not use .* for --content: (ENOTDIR|EEXIST)/)
  }
})

test('contentWriter: writes each page with content, drops it from the page and lists the files by URL', async (t) => {
  const dir = await tempDir(t)
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/z'], new Set())
  const pages = [{ url: 'https://a.test/x', content: 'X' }, { url: 'https://a.test/z' }]
  for (const page of pages) await writer.write(page)
  assert.deepEqual(pages, [{ url: 'https://a.test/x' }, { url: 'https://a.test/z' }])
  assert.equal(await readFile(join(dir, 'a.test_x.md'), 'utf8'), 'X')
  assert.deepEqual(writer.outcome(), {
    message: `Page content written to ${dir} (1 file)`,
    ok: true,
    files: new Map([['https://a.test/x', join(dir, 'a.test_x.md')]])
  })
})

test('contentWriter: a file of the folder is never replaced, also one that appeared during the audit', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'a.test_x.md'), 'mine')
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'], new Set(['a.test_x.md']))
  await writeFile(join(dir, 'a.test_y.md'), 'appeared')
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await writer.write({ url: 'https://a.test/y', content: 'Y' })
  assert.equal(await readFile(join(dir, 'a.test_x.md'), 'utf8'), 'mine')
  assert.equal(await readFile(join(dir, 'a.test_x-2.md'), 'utf8'), 'X')
  assert.equal(await readFile(join(dir, 'a.test_y.md'), 'utf8'), 'appeared')
  const { message, ok } = writer.outcome()
  assert.equal(ok, false)
  assert.match(message, /Could not write .*a\.test_y\.md: EEXIST/)
})

test('contentWriter: the first failure is kept when writes running beside it succeed', async (t) => {
  const dir = await tempDir(t)
  await mkdir(join(dir, 'a.test_x.md'))
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'], new Set())
  await Promise.all([
    writer.write({ url: 'https://a.test/x', content: 'X' }),
    writer.write({ url: 'https://a.test/y', content: 'Y' })
  ])
  const { message, ok, files } = writer.outcome()
  assert.equal(ok, false)
  assert.match(message, /Could not write .*a\.test_x\.md: EEXIST/)
  assert.deepEqual([...files.keys()], ['https://a.test/y'])
})

test('contentWriter: after a write fails no new one is started', async (t) => {
  const dir = await tempDir(t)
  await mkdir(join(dir, 'a.test_x.md'))
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'], new Set())
  const y = { url: 'https://a.test/y', content: 'Y' }
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await writer.write(y)
  assert.deepEqual(y, { url: 'https://a.test/y' })
  assert.deepEqual(await readdir(dir), ['a.test_x.md'])
  assert.deepEqual(writer.outcome().files, new Map())
})

test('contentWriter: pages the Markdown failed on are named, the first five and how many more', async (t) => {
  const dir = await tempDir(t)
  const urls = Array.from({ length: 7 }, (_, i) => `https://a.test/${i}`)
  const writer = contentWriter(dir, urls, new Set())
  for (const url of urls) await writer.write({ url, content: null })
  const { message, ok } = writer.outcome()
  assert.equal(ok, true)
  assert.equal(
    message,
    [
      `Page content written to ${dir} (0 files)`,
      'The content of 7 pages could not be converted to Markdown:',
      ...urls.slice(0, 5),
      'and 2 more'
    ].join('\n')
  )
})
