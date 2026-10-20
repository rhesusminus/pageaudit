import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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

// The folder prepared for a writer, with the staging folder it got.
async function prepared(dir) {
  const folder = await prepareContentFolder(dir)
  return { folder, staged: () => readdir(folder.staging) }
}

test('prepareContentFolder: makes the folder, also nested, with a hidden staging folder in it', async (t) => {
  const dir = join(await tempDir(t), 'a', 'b')
  const { existing, earlier, staging } = await prepareContentFolder(dir)
  assert.deepEqual({ existing, earlier }, { existing: new Set(), earlier: [] })
  assert.equal(dirname(staging), dir)
  assert.match(basename(staging), /^\.pageaudit-/)
  assert.deepEqual(await readdir(dir), [basename(staging)])
})

test('prepareContentFolder: removes nothing, names the files an earlier run wrote and the others', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'old.md'), markdown('https://a.test/old'))
  await writeFile(join(dir, 'Notes.md'), '# My notes\n')
  await writeFile(join(dir, 'empty.md'), '')
  await writeFile(join(dir, 'old.txt'), markdown('https://a.test/txt'))
  await mkdir(join(dir, 'folder.md'))
  const { existing, earlier, staging } = await prepareContentFolder(dir)
  assert.deepEqual([...existing].sort(), ['empty.md', 'folder.md', 'notes.md', 'old.txt'])
  assert.deepEqual(earlier, ['old.md'])
  assert.deepEqual(
    (await readdir(dir)).sort(),
    [basename(staging), 'Notes.md', 'empty.md', 'folder.md', 'old.md', 'old.txt'].sort()
  )
})

test('prepareContentFolder: removes the staging folders a stopped run left', async (t) => {
  const dir = await tempDir(t)
  await mkdir(join(dir, '.pageaudit-left'))
  await writeFile(join(dir, '.pageaudit-left', 'a.test_x.md'), markdown('https://a.test/x'))
  await writeFile(join(dir, '.pageaudit-file'), 'not a folder')
  const { existing, staging } = await prepareContentFolder(dir)
  assert.deepEqual([...existing], ['.pageaudit-file'])
  assert.deepEqual((await readdir(dir)).sort(), ['.pageaudit-file', basename(staging)].sort())
})

test('prepareContentFolder: a folder that cannot be made says why', async (t) => {
  const path = join(await tempDir(t), 'content')
  await writeFile(path, 'x')
  for (const dir of [path, join(path, 'sub')]) {
    const { problem } = await prepareContentFolder(dir)
    assert.match(problem, /Could not use .* for --content: (ENOTDIR|EEXIST)/)
  }
})

test('prepareContentFolder: a folder that cannot be written says why', async (t) => {
  const dir = await tempDir(t)
  await chmod(dir, 0o555)
  const { problem } = await prepareContentFolder(dir)
  assert.match(problem, /Could not use .* for --content: EACCES/)
})

test('contentWriter: stages each page, drops the content from it and moves the files in once finished', async (t) => {
  const dir = await tempDir(t)
  const { folder, staged } = await prepared(dir)
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/z'], folder)
  const pages = [{ url: 'https://a.test/x', content: 'X' }, { url: 'https://a.test/z' }]
  for (const page of pages) await writer.write(page)
  assert.deepEqual(pages, [{ url: 'https://a.test/x' }, { url: 'https://a.test/z' }])
  assert.deepEqual(await staged(), ['a.test_x.md'])
  assert.deepEqual(await writer.finish(), {
    message: `Page content written to ${dir} (1 file)`,
    ok: true,
    files: new Map([['https://a.test/x', join(dir, 'a.test_x.md')]])
  })
  assert.deepEqual(await readdir(dir), ['a.test_x.md'])
  assert.equal(await readFile(join(dir, 'a.test_x.md'), 'utf8'), 'X')
})

test('contentWriter: the files of an earlier run are kept until finished, then replaced', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'a.test_x.md'), markdown('https://a.test/x'))
  await writeFile(join(dir, 'a.test_gone.md'), markdown('https://a.test/gone'))
  await writeFile(join(dir, 'notes.md'), '# Notes\n')
  const { folder } = await prepared(dir)
  const writer = contentWriter(dir, ['https://a.test/x'], folder)
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  assert.deepEqual(
    (await readdir(dir)).sort(),
    [basename(folder.staging), 'a.test_gone.md', 'a.test_x.md', 'notes.md'].sort()
  )
  assert.equal((await writer.finish()).ok, true)
  assert.deepEqual((await readdir(dir)).sort(), ['a.test_x.md', 'notes.md'])
  assert.equal(await readFile(join(dir, 'a.test_x.md'), 'utf8'), 'X')
})

test('contentWriter: an earlier file another file took the place of during the audit is not removed', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'a.test_old.md'), markdown('https://a.test/old'))
  const { folder } = await prepared(dir)
  const writer = contentWriter(dir, ['https://a.test/x'], folder)
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await writeFile(join(dir, 'a.test_old.md'), 'mine now')
  assert.equal((await writer.finish()).ok, true)
  assert.deepEqual((await readdir(dir)).sort(), ['a.test_old.md', 'a.test_x.md'])
  assert.equal(await readFile(join(dir, 'a.test_old.md'), 'utf8'), 'mine now')
})

test('contentWriter: a file that is not an earlier page is never replaced, also one from during the audit', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'a.test_x.md'), 'mine')
  await writeFile(join(dir, 'a.test_old.md'), markdown('https://a.test/old'))
  const { folder } = await prepared(dir)
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'], folder)
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await writer.write({ url: 'https://a.test/y', content: 'Y' })
  await writeFile(join(dir, 'a.test_y.md'), 'appeared')
  const { message, ok, files } = await writer.finish()
  assert.equal(ok, false)
  assert.match(message, /Could not write .*a\.test_y\.md: EEXIST\nNo page content was written to .*, the files in it/)
  assert.deepEqual(files, new Map())
  assert.deepEqual((await readdir(dir)).sort(), ['a.test_old.md', 'a.test_x.md', 'a.test_y.md'])
  assert.equal(await readFile(join(dir, 'a.test_x.md'), 'utf8'), 'mine')
  assert.equal(await readFile(join(dir, 'a.test_y.md'), 'utf8'), 'appeared')
})

test('contentWriter: after a failed write nothing is moved in and the earlier files are kept', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'a.test_old.md'), markdown('https://a.test/old'))
  const { folder } = await prepared(dir)
  await mkdir(join(folder.staging, 'a.test_x.md'))
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'], folder)
  await Promise.all([
    writer.write({ url: 'https://a.test/x', content: 'X' }),
    writer.write({ url: 'https://a.test/y', content: 'Y' })
  ])
  const { message, ok, files } = await writer.finish()
  assert.equal(ok, false)
  // The first failure is kept when writes running beside it succeed, and names the file in the folder.
  assert.match(message, new RegExp(`^Could not write ${join(dir, 'a.test_x.md')}: EEXIST\n`))
  assert.deepEqual(files, new Map())
  assert.deepEqual(await readdir(dir), ['a.test_old.md'])
})

test('contentWriter: when the files cannot be moved in, the earlier files are kept', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'a.test_old.md'), markdown('https://a.test/old'))
  const { folder } = await prepared(dir)
  const writer = contentWriter(dir, ['https://a.test/x'], folder)
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await rm(join(folder.staging, 'a.test_x.md'))
  const outcome = await writer.finish()
  assert.equal(outcome.ok, false)
  assert.match(outcome.message, /^Could not move the page content into .*: ENOENT\nNo page content was written/)
  assert.deepEqual(outcome.files, new Map())
  assert.deepEqual(
    (await readdir(dir)).filter((name) => !name.startsWith('.')),
    ['a.test_old.md']
  )
})

test('contentWriter: after a write fails no new one is started', async (t) => {
  const dir = await tempDir(t)
  const { folder, staged } = await prepared(dir)
  await mkdir(join(folder.staging, 'a.test_x.md'))
  const writer = contentWriter(dir, ['https://a.test/x', 'https://a.test/y'], folder)
  const y = { url: 'https://a.test/y', content: 'Y' }
  await writer.write({ url: 'https://a.test/x', content: 'X' })
  await writer.write(y)
  assert.deepEqual(y, { url: 'https://a.test/y' })
  assert.deepEqual(await staged(), ['a.test_x.md'])
})

test('contentWriter: pages the Markdown failed on are named, the first five and how many more', async (t) => {
  const dir = await tempDir(t)
  const urls = Array.from({ length: 7 }, (_, i) => `https://a.test/${i}`)
  const writer = contentWriter(dir, urls, (await prepared(dir)).folder)
  for (const url of urls) await writer.write({ url, content: null })
  const { message, ok } = await writer.finish()
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
